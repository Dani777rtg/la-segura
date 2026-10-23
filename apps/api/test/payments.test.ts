import { createHmac } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, payments, db } = ctx
const SECRET = 'secreto-de-prueba-mp'

let ip = 0
async function signup(phone: string) {
  const remoteAddress = `10.5.0.${++ip}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress })
  await post('/api/auth/register', { name: 'Ana', phone, password: 'clave-segura-1', municipalityCode: '05001' })
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}
const as = (cookie: string) => ({ ps_session: cookie })
const credits = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/credits', cookies: as(cookie) })).json()

/** Firma igual que Mercado Pago: HMAC-SHA256 de "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". */
function signedWebhook(dataId: string, opts: { secret?: string; ts?: number } = {}) {
  const ts = opts.ts ?? Math.floor(Date.now() / 1000)
  const requestId = `req-${Math.random()}`
  const v1 = createHmac('sha256', opts.secret ?? SECRET).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex')
  return app.inject({
    method: 'POST',
    url: `/api/webhooks/mercadopago?data.id=${dataId}&type=payment`,
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    payload: { type: 'payment', data: { id: dataId } },
  })
}

async function startCheckout(cookie: string) {
  const res = await app.inject({ method: 'POST', url: '/api/credits/checkout', cookies: as(cookie) })
  const reference = payments.preferences.at(-1)!.externalReference
  return { res, reference }
}

beforeEach(async () => {
  whatsapp.reset()
  payments.preferences.length = 0
  payments.payments.clear()
  await ctx.reset()
})
afterAll(ctx.close)

describe('catálogo de créditos', () => {
  it('muestra saldo, paquete con IVA desglosado, costos e historial', async () => {
    const cookie = await signup('3001112233')
    const body = await credits(cookie)
    expect(body.balance).toBe(200)
    expect(body.pack).toEqual({ credits: 1000, baseCop: 49000, ivaCop: 9310, totalCop: 58310 })
    expect(body.pack.baseCop + body.pack.ivaCop).toBe(body.pack.totalCop)
    expect(body.costs).toEqual({ analyzeText: 1, analyzeVoiceOrImage: 2, pdfReport: 5 })
    expect(body.history[0]).toMatchObject({ delta: 200, reason: 'welcome' })
  })

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/credits' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/credits/checkout' })).statusCode).toBe(401)
  })
})

describe('checkout', () => {
  it('crea una compra pendiente por el total con IVA y devuelve la URL de pago', async () => {
    const cookie = await signup('3001112233')
    const { res, reference } = await startCheckout(cookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toContain('pago.example')
    expect(payments.preferences[0]).toMatchObject({ amountCop: 58310 })
    expect(payments.preferences[0]!.notificationUrl).toContain('/api/webhooks/mercadopago')
    expect(reference).toMatch(/^PS-PUR-\d+$/)
    expect((await db.query.purchases.findMany())[0]).toMatchObject({ status: 'pending', amountCop: 58310, baseCop: 49000, ivaCop: 9310 })
    expect((await credits(cookie)).balance).toBe(200) // todavía no se acredita nada
  })
})

describe('webhook firmado', () => {
  const approved = (id: string, reference: string, over: object = {}) =>
    payments.payments.set(id, { id, status: 'approved', externalReference: reference, amount: 58310, currency: 'COP', ...over })

  it('un pago aprobado con firma válida acredita 1.000 créditos', async () => {
    const cookie = await signup('3001112233')
    const { reference } = await startCheckout(cookie)
    approved('555', reference)
    expect((await signedWebhook('555')).statusCode).toBe(200)
    expect((await credits(cookie)).balance).toBe(1200)
    expect((await credits(cookie)).history[0]).toMatchObject({ delta: 1000, reason: 'purchase' })
  })

  it('es idempotente: el mismo pago avisado varias veces o en paralelo se acredita una sola vez', async () => {
    const cookie = await signup('3001112233')
    const { reference } = await startCheckout(cookie)
    approved('555', reference)
    const results = await Promise.all(Array.from({ length: 6 }, () => signedWebhook('555')))
    expect(results.every((r) => r.statusCode === 200)).toBe(true)
    await signedWebhook('555')
    expect((await credits(cookie)).balance).toBe(1200)
  })

  it('rechaza firmas incorrectas, clave equivocada y avisos viejos (replay)', async () => {
    const cookie = await signup('3001112233')
    const { reference } = await startCheckout(cookie)
    approved('555', reference)
    expect((await signedWebhook('555', { secret: 'otra-clave' })).statusCode).toBe(401)
    expect((await signedWebhook('555', { ts: Math.floor(Date.now() / 1000) - 3600 })).statusCode).toBe(401)
    const noHeader = await app.inject({ method: 'POST', url: '/api/webhooks/mercadopago?data.id=555&type=payment', payload: {} })
    expect(noHeader.statusCode).toBe(401)
    expect((await credits(cookie)).balance).toBe(200)
  })

  it('no acredita si el monto o la moneda no son los de la compra', async () => {
    const cookie = await signup('3001112233')
    const { reference } = await startCheckout(cookie)
    approved('1', reference, { amount: 100 })
    approved('2', reference, { currency: 'USD' })
    await signedWebhook('1')
    await signedWebhook('2')
    expect((await credits(cookie)).balance).toBe(200)
  })

  it('no acredita pagos pendientes ni de referencias desconocidas; los rechazados marcan la compra', async () => {
    const cookie = await signup('3001112233')
    const { reference } = await startCheckout(cookie)
    approved('10', reference, { status: 'in_process' })
    approved('11', 'OTRA-REFERENCIA')
    await signedWebhook('10')
    await signedWebhook('11')
    expect((await credits(cookie)).balance).toBe(200)
    approved('12', reference, { status: 'rejected' })
    await signedWebhook('12')
    expect((await db.query.purchases.findMany())[0]!.status).toBe('rejected')
  })

  it('un pago aprobado le llega a quien hizo la compra, aunque otra persona dispare el aviso', async () => {
    const a = await signup('3001112233')
    const b = await signup('3004445566')
    const { reference } = await startCheckout(a)
    approved('555', reference)
    await app.inject({ method: 'GET', url: '/api/credits/return?payment_id=555', cookies: as(b) })
    expect((await credits(a)).balance).toBe(1200)
    expect((await credits(b)).balance).toBe(200)
  })
})

describe('retorno del usuario desde Mercado Pago', () => {
  it('confirma el pago consultándolo y redirige a la pantalla de créditos', async () => {
    const cookie = await signup('3001112233')
    const { reference } = await startCheckout(cookie)
    payments.payments.set('777', { id: '777', status: 'approved', externalReference: reference, amount: 58310, currency: 'COP' })
    const res = await app.inject({ method: 'GET', url: '/api/credits/return?payment_id=777&status=approved' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('http://localhost:5173/app/creditos?status=success')
    expect((await credits(cookie)).balance).toBe(1200)
  })

  it('un parámetro status falso en la URL no acredita nada', async () => {
    const cookie = await signup('3001112233')
    await startCheckout(cookie)
    const res = await app.inject({ method: 'GET', url: '/api/credits/return?status=approved&payment_id=999' })
    expect(res.headers.location).toContain('status=pending')
    expect((await credits(cookie)).balance).toBe(200)
  })

  it('webhook y retorno juntos acreditan una sola vez', async () => {
    const cookie = await signup('3001112233')
    const { reference } = await startCheckout(cookie)
    payments.payments.set('888', { id: '888', status: 'approved', externalReference: reference, amount: 58310, currency: 'COP' })
    await Promise.all([signedWebhook('888'), app.inject({ method: 'GET', url: '/api/credits/return?payment_id=888' })])
    expect((await credits(cookie)).balance).toBe(1200)
  })
})

describe('donación al proyecto', () => {
  it('crea un pago de $500.000 sin IVA y, al aprobarse por webhook firmado, no da créditos', async () => {
    const cookie = await signup('3001112233')
    const res = await app.inject({ method: 'POST', url: '/api/donations/checkout', cookies: as(cookie) })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toContain('https://')
    const pref = payments.preferences.at(-1)!
    expect(pref).toMatchObject({ amountCop: 500000, title: 'Donación al proyecto La Segura' })
    payments.payments.set('777', { id: '777', status: 'approved', externalReference: pref.externalReference, amount: 500000, currency: 'COP' })
    expect((await signedWebhook('777')).statusCode).toBe(200)
    expect((await credits(cookie)).balance).toBe(200) // una donación no es una compra de créditos
    expect((await app.inject({ method: 'POST', url: '/api/donations/checkout' })).statusCode).toBe(401)
  })
})
