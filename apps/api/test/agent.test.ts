import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { extract, officialOwner, registrableDomain } from '../src/modules/agent/signals.ts'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, llm, checks } = ctx

let ipCounter = 0
/** Crea un usuario verificado y devuelve su cookie de sesión (cada uno desde una IP distinta). */
async function signup(phone: string) {
  const ip = `10.1.0.${++ipCounter}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress: ip })
  await post('/api/auth/register', { name: 'Ana', phone, password: 'clave-segura-1', municipalityCode: '05001' })
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}

const analyze = (cookie: string, text: string) =>
  app.inject({ method: 'POST', url: '/api/analyze', cookies: { ps_session: cookie }, payload: { text } })

const PHISHING_MSG =
  'Bancolombia: tu cuenta será bloqueada hoy. Ingresa a https://bancolombia-seguro.xyz/login y confirma tu clave dinámica.'

beforeEach(async () => {
  whatsapp.reset()
  llm.calls.length = 0
  checks.phishing.clear()
  checks.ranks.clear()
  checks.sites.clear()
  checks.companies.clear()
  checks.ages.clear()
  llm.next = {
    risk: 'bajo',
    confidence: 60,
    fraudType: 'ninguno',
    summary: 'No veo señales claras.',
    reasons: [],
    advice: ['Ten cuidado'],
  }
  await ctx.reset()
})
afterAll(ctx.close)

describe('dominios oficiales', () => {
  it('reconoce el dominio real de la empresa (también subdominios) y marca el que la imita', () => {
    expect(officialOwner('temu.com')).toBe('Temu')
    expect(extract('Temu: retiro en espera app.temu.com/t/abc').signals.map((s) => s.key)).not.toContain('dominio_imitador')
    expect(officialOwner('betplay.com.co')).toBe('BetPlay')
    expect(extract('Recarga en cobetplay.co/puntos').signals.map((s) => s.key)).toContain('dominio_imitador')
    // Marcas cortas no se confunden con palabras normales.
    expect(extract('mira contigo-tienda.com').signals.map((s) => s.key)).not.toContain('dominio_imitador')
  })
})

describe('extracción de señales', () => {
  it('saca el dominio registrable de un subdominio, incluso en .com.co', () => {
    expect(registrableDomain('login.banco.com.co')).toBe('banco.com.co')
    expect(registrableDomain('a.b.ejemplo.com')).toBe('ejemplo.com')
  })

  it('detecta un dominio que imita a Bancolombia pero no el oficial', () => {
    const fake = extract('entra a bancolombia-seguro.xyz ya')
    expect(fake.signals.map((s) => s.key)).toContain('dominio_imitador')
    const real = extract('entra a https://www.bancolombia.com/personas')
    expect(real.signals.map((s) => s.key)).not.toContain('dominio_imitador')
  })

  it('normaliza celulares escritos de varias formas', () => {
    expect(extract('llámame al 300 000 0001 o al +57 300-123-4567').phones.sort()).toEqual(['573001234567', '573000000001'])
  })

  it('detecta cuando piden códigos o claves', () => {
    expect(extract('Dame el código de verificación que te llegó').signals.map((s) => s.key)).toContain('pide_codigo')
  })

  it('un mensaje normal no genera señales', () => {
    expect(extract('Hola, ¿a qué hora nos vemos mañana para almorzar?').signals).toHaveLength(0)
  })
})

describe('POST /api/analyze', () => {
  it('exige sesión y valida el texto', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/analyze', payload: { text: 'hola' } })).statusCode).toBe(401)
    const cookie = await signup('3001112233')
    expect((await analyze(cookie, '   ')).statusCode).toBe(400)
    expect((await analyze(cookie, 'x'.repeat(4001))).statusCode).toBe(400)
  })

  it('marca riesgo alto un mensaje que imita a un banco, cobra 1 crédito y guarda el caso', async () => {
    const cookie = await signup('3001112233')
    const res = await analyze(cookie, PHISHING_MSG)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.risk).toBe('alto')
    expect(body.offerReport).toBe(true)
    expect(body.creditsLeft).toBe(199)
    expect(body.sources.some((s: { result: string }) => s.result === 'simulated')).toBe(true)
    expect(await ctx.db.query.cases.findMany()).toHaveLength(1)
  })

  it('si la IA ve que no es un mensaje para revisar (fuera de tema), rechaza, no cobra y no guarda caso', async () => {
    const cookie = await signup('3001112233')
    llm.next = { ...(llm.next as object), offTopic: true } as typeof llm.next
    const res = await analyze(cookie, '¿Qué es una silla?')
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('off_topic')
    expect(await ctx.db.query.cases.findMany()).toHaveLength(0)
    const me = await app.inject({ method: 'GET', url: '/api/credits', cookies: { ps_session: cookie } })
    expect(JSON.stringify(me.json())).toContain('200')
  })

  it('un dominio fuera de la lista pero muy visitado (Tranco) no se trata como imitador', async () => {
    const cookie = await signup('3001112233')
    const msg = 'Bancolombia puntos: redime en bancolombiapuntos.com'
    const sin = (await analyze(cookie, msg)).json()
    expect(sin.risk).not.toBe('bajo') // sin pruebas, parecerse a Bancolombia sube el riesgo
    checks.ranks.set('bancolombiapuntos.com', 5000)
    const con = (await analyze(cookie, msg)).json()
    expect(con.risk).toBe('bajo')
    expect(con.sources.find((s: { name: string }) => s.name.startsWith('Popularidad'))).toMatchObject({ result: 'ok' })
  })

  it('verifica en el RUES la empresa cuyo NIT aparece en la página del enlace', async () => {
    const cookie = await signup('3001112233')
    checks.sites.set('tiendita-ejemplo.co', { finalUrl: 'https://tiendita-ejemplo.co/', finalHost: 'tiendita-ejemplo.co', title: 'Tiendita', siteName: '', nit: '900111222' })
    checks.companies.set('900111222', { name: 'TIENDITA SAS', nit: '900111222', status: 'ACTIVA', registeredYear: 2015, lastRenewal: new Date().getFullYear(), chamber: 'BOGOTA' })
    const r = (await analyze(cookie, 'Promo de temporada en tiendita-ejemplo.co')).json()
    expect(r.sources.find((s: { name: string }) => s.name === 'Empresa en el RUES')).toMatchObject({ result: 'ok' })
    expect(r.sources.find((s: { name: string }) => s.name === 'Empresa en el RUES').detail).toContain('TIENDITA SAS')
  })

  it('las reglas objetivas suben el riesgo aunque la IA diga "bajo"', async () => {
    const cookie = await signup('3001112233')
    checks.phishing.add('sitio-malo.com')
    const res = await analyze(cookie, 'Mira esto http://sitio-malo.com/oferta')
    expect(res.json().risk).toBe('alto')
    expect(res.json().level).toBe('muy_probable') // la IA decía "bajo", pero la lista de phishing lo sube
  })

  it('si la IA falla, responde con las reglas y NO cobra', async () => {
    const cookie = await signup('3001112233')
    llm.next = new Error('DeepSeek caído')
    const res = await analyze(cookie, PHISHING_MSG)
    expect(res.statusCode).toBe(200)
    expect(res.json().risk).not.toBe('bajo')
    expect(res.json().creditsLeft).toBe(200)
  })

  it('con 0 créditos responde 402 sin llamar a la IA', async () => {
    const cookie = await signup('3001112233')
    await ctx.db.execute(sql`UPDATE credit_accounts SET balance = 0`)
    const res = await analyze(cookie, PHISHING_MSG)
    expect(res.statusCode).toBe(402)
    expect(llm.calls).toHaveLength(0)
  })

  it('el mensaje llega a la IA como dato delimitado, junto con las señales', async () => {
    const cookie = await signup('3001112233')
    await analyze(cookie, PHISHING_MSG)
    expect(llm.calls[0]!.text).toBe(PHISHING_MSG)
    expect(llm.calls[0]!.signals.length).toBeGreaterThan(0)
  })
})

describe('nivel en palabras (sin porcentajes)', () => {
  it('la respuesta no trae números de confianza', async () => {
    const cookie = await signup('3001112233')
    const res = await analyze(cookie, PHISHING_MSG)
    expect(res.json()).not.toHaveProperty('confidence')
    expect(JSON.stringify(res.json())).not.toMatch(/\d+\s?%/)
  })

  it('"muy probable" solo cuando la IA y las pruebas objetivas coinciden; "probable" si es solo la IA', async () => {
    const cookie = await signup('3001112233')
    llm.next = { risk: 'alto', confidence: 99, fraudType: 'otro', summary: 'Parece estafa.', reasons: [], advice: [] }
    expect((await analyze(cookie, 'Hola, ¿me prestas plata para el almuerzo?')).json().level).toBe('probable') // sin evidencia objetiva
    expect((await analyze(cookie, PHISHING_MSG)).json().level).toBe('muy_probable') // dominio imitador + clave dinámica
  })

  it('riesgo medio = "posible" y riesgo bajo = "poco probable" (nunca "seguro")', async () => {
    const cookie = await signup('3001112233')
    llm.next = { risk: 'medio', confidence: 60, fraudType: 'otro', summary: 'Ten cuidado.', reasons: [], advice: [] }
    expect((await analyze(cookie, 'mensaje dudoso')).json().level).toBe('posible')
    llm.next = { risk: 'bajo', confidence: 70, fraudType: 'ninguno', summary: 'Se ve normal.', reasons: [], advice: [] }
    expect((await analyze(cookie, 'nos vemos mañana')).json().level).toBe('poco_probable')
  })

  it('detecta señales de SIM swapping', () => {
    expect(extract('Tu línea será portada: autoriza el duplicado de SIM con el código que te llegará').signals.map((s) => s.key)).toContain('sim')
    expect(extract('Hola, ¿cómo vas con el almuerzo?').signals.map((s) => s.key)).not.toContain('sim')
  })
})

describe('reputación comunitaria', () => {
  const SCAM = 'Soy tu hijo, este es mi nuevo número 300 000 0001, necesito plata urgente por favor'

  it('un número reportado como riesgoso aparece como alerta para otra persona', async () => {
    llm.next = { ...llm.next as object, risk: 'alto', confidence: 80, fraudType: 'otro' } as never
    const a = await signup('3001112233')
    await analyze(a, SCAM)

    const b = await signup('3004445566')
    const res = await analyze(b, SCAM)
    const community = res.json().sources.find((s: { name: string }) => s.name === 'Reportes de la comunidad')
    expect(community.result).toBe('flag')
    expect(community.detail).toContain('1')
  })

  it('tu propio reporte no cuenta como "la comunidad"', async () => {
    llm.next = { ...llm.next as object, risk: 'alto', confidence: 80, fraudType: 'otro' } as never
    const a = await signup('3001112233')
    await analyze(a, SCAM)
    const again = await analyze(a, SCAM)
    const community = again.json().sources.find((s: { name: string }) => s.name === 'Reportes de la comunidad')
    expect(community.result).toBe('ok')
  })

  it('los números no se guardan en claro', async () => {
    llm.next = { ...llm.next as object, risk: 'alto', confidence: 80, fraudType: 'otro' } as never
    const a = await signup('3001112233')
    await analyze(a, SCAM)
    const rows = await ctx.db.query.indicators.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.valueHash).not.toContain('3000000001')
    expect(rows[0]!.display).toBe('5731•••••719')
  })
})
