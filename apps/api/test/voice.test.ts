import { createHmac } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { buildServer } from '../src/server.ts'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, llm, db } = ctx
const KEY = 'clave-interna-de-prueba-123456'

let ip = 0
async function signup(phone = '3001112233') {
  const remoteAddress = `10.9.0.${++ip}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress })
  await post('/api/auth/register', { name: 'María Pérez', phone, password: 'clave-segura-1', municipalityCode: '05001' })
  await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  whatsapp.reset()
}
const get = (url: string, key: string | null = KEY) => app.inject({ method: 'GET', url, headers: key ? { 'x-internal-key': key } : {} })
const analyze = (payload: object, key: string | null = KEY) => app.inject({ method: 'POST', url: '/api/internal/voice/analyze', payload, headers: key ? { 'x-internal-key': key } : {} })

beforeEach(async () => {
  whatsapp.reset()
  llm.next = { risk: 'alto', confidence: 90, fraudType: 'suplantacion_entidad', summary: 'Es un mensaje falso que imita a un banco.', reasons: [], advice: ['No entres al enlace', 'Llama a tu banco'] }
  await ctx.reset()
})
afterAll(ctx.close)

describe('puente interno de voz', () => {
  it('exige la clave interna (sin clave o con clave incorrecta: 401)', async () => {
    expect((await get('/api/internal/voice/caller?phone=3001112233', null)).statusCode).toBe(401)
    expect((await get('/api/internal/voice/caller?phone=3001112233', 'otra-clave-que-no-es-la-correcta')).statusCode).toBe(401)
    expect((await analyze({ phone: '3001112233', text: 'hola mundo' }, null)).statusCode).toBe(401)
  })

  it('identifica a quien llama: registrada (con nombre de pila y créditos) o desconocida', async () => {
    await signup()
    expect((await get('/api/internal/voice/caller?phone=573001112233')).json()).toEqual({ registered: true, name: 'María', credits: 200, recent: [], contexto: expect.stringContaining('MEMORIA') })
    expect((await get('/api/internal/voice/caller?phone=3009998877')).json()).toEqual({ registered: false })
  })

  it('analiza lo que cuenta la persona: nivel en palabras, cobra 2 créditos y deja el caso listo para "reporte" y "publicar" por WhatsApp', async () => {
    await signup()
    const res = (await analyze({ phone: '573001112233', text: 'Me llamaron del banco y me pidieron mi clave dinámica' })).json()
    expect(res).toMatchObject({ ok: true, label: 'Probablemente es una estafa', offerReport: true, creditsLeft: 198 })
    expect(res).not.toHaveProperty('confidence')
    const [state] = await db.query.botState.findMany()
    expect(state).toMatchObject({ phone: '573001112233', awaitingReport: true })
    expect(state!.lastCaseId).toBeGreaterThan(0)
  })

  it('contexto compartido: la llamada ve los casos del chat y puede publicar el último; sin caso, respuesta controlada', async () => {
    await signup()
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers: { 'x-internal-key': KEY } })
    expect((await post('/api/internal/voice/publish', { phone: '573001112233' })).json()).toEqual({ ok: false, reason: 'sin_caso' })
    // Un caso que llegó por el chat (no por la llamada)
    const { sql } = await import('drizzle-orm')
    await analyze({ phone: '573001112233', text: 'Me llegó un mensaje del banco con un enlace raro' })
    await ctx.db.execute(sql`UPDATE cases SET channel = 'web'`)
    const caller = (await get('/api/internal/voice/caller?phone=573001112233')).json()
    expect(caller.recent).toHaveLength(1)
    expect(caller.recent[0]).toMatchObject({ canal: 'chat', esElUltimo: true, texto: 'Me llegó un mensaje del banco con un enlace raro' })
    expect((await post('/api/internal/voice/publish', { phone: '573001112233' })).json()).toEqual({ ok: true, yaEstaba: false })
    expect((await post('/api/internal/voice/publish', { phone: '573001112233' })).json()).toEqual({ ok: true, yaEstaba: true })
  })

  it('arma el reporte del último caso y lo manda por WhatsApp (5 créditos)', async () => {
    await signup()
    const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, headers: { 'x-internal-key': KEY } })
    await analyze({ phone: '573001112233', text: 'Me llamaron del banco y me pidieron mi clave dinámica' }) // 2 créditos
    expect((await post('/api/internal/voice/report', { phone: '573001112233' })).json()).toEqual({ ok: true })
    expect(whatsapp.outbox.some((m) => m.kind === 'document' && m.to === '573001112233')).toBe(true)
    expect((await get('/api/internal/voice/caller?phone=573001112233')).json().credits).toBe(193)
  })

  it('número sin cuenta o sin créditos: respuesta controlada, sin errores', async () => {
    expect((await analyze({ phone: '3009998877', text: 'mensaje sospechoso' })).json()).toEqual({ ok: false, reason: 'no_registrado' })
    await signup()
    await ctx.db.execute((await import('drizzle-orm')).sql`UPDATE credit_accounts SET balance = 0`)
    expect((await analyze({ phone: '3001112233', text: 'mensaje sospechoso' })).json()).toEqual({ ok: false, reason: 'sin_creditos' })
  })
})

describe('reenvío de avisos de llamada al servicio de voz', () => {
  it('reenvía los mismos bytes, la firma de Meta y la clave interna; los mensajes de texto no se reenvían', async () => {
    const received: Array<{ body: string; headers: IncomingMessage['headers'] }> = []
    const target = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push({ body, headers: req.headers })
        res.writeHead(200).end('ok')
      })
    })
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
    const port = (target.address() as { port: number }).port

    const cfg = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET,
      WHATSAPP_APP_SECRET: 'app-secret-de-prueba', WHATSAPP_VERIFY_TOKEN: 'verify-de-prueba', WHATSAPP_PHONE_NUMBER_ID: '999',
      VOICE_INTERNAL_KEY: KEY, VOICE_SERVICE_URL: `http://127.0.0.1:${port}`,
    } as NodeJS.ProcessEnv)
    const server = await buildServer({ config: cfg, db, whatsapp, llm, checks: ctx.checks, speech: ctx.speech, ocr: ctx.ocr, payments: ctx.payments })
    const send = (payload: object) => {
      const body = JSON.stringify(payload)
      const sig = createHmac('sha256', 'app-secret-de-prueba').update(body).digest('hex')
      return server.inject({ method: 'POST', url: '/api/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${sig}` }, payload: body }).then((r) => ({ r, body, sig }))
    }

    const call = { entry: [{ changes: [{ field: 'calls', value: { metadata: { phone_number_id: '999' }, calls: [{ id: 'wacid.1', event: 'connect' }] } }] }] }
    const { r, body, sig } = await send(call)
    expect(r.statusCode).toBe(200)
    expect(received).toHaveLength(1)
    expect(received[0]!.body).toBe(body)
    expect(received[0]!.headers['x-hub-signature-256']).toBe(`sha256=${sig}`)
    expect(received[0]!.headers['x-internal-key']).toBe(KEY)

    await send({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999' }, messages: [] } }] }] })
    expect(received).toHaveLength(1) // un aviso de mensajes no se reenvía

    await server.close()
    await new Promise((r) => target.close(r))
  })
})

describe('llamada desde la web', () => {
  it('exige sesión, reenvía la oferta con la clave interna y el celular verificado, y devuelve la respuesta', async () => {
    const received: Array<{ body: string; headers: IncomingMessage['headers'] }> = []
    let status = 200
    const target = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        received.push({ body, headers: req.headers })
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ sdp: 'v=0 respuesta', type: 'answer' }))
      })
    })
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
    const port = (target.address() as { port: number }).port
    const cfg = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET,
      VOICE_INTERNAL_KEY: KEY, VOICE_SERVICE_URL: `http://127.0.0.1:${port}`,
    } as NodeJS.ProcessEnv)
    const server = await buildServer({ config: cfg, db, whatsapp, llm, checks: ctx.checks, speech: ctx.speech, ocr: ctx.ocr, payments: ctx.payments })
    const offer = { sdp: 'v=0 oferta del navegador', type: 'offer' }

    expect((await server.inject({ method: 'POST', url: '/api/voice/web-call', payload: offer })).statusCode).toBe(401)

    const ip = '10.9.9.9'
    await server.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: ip, payload: { name: 'María Pérez', phone: '3001112233', password: 'clave-segura-1', municipalityCode: '05001' } })
    const v = await server.inject({ method: 'POST', url: '/api/auth/verify', remoteAddress: ip, payload: { phone: '3001112233', code: whatsapp.sent.at(-1)!.code } })
    const cookies = { ps_session: v.cookies.find((c) => c.name === 'ps_session')!.value }

    const ok = await server.inject({ method: 'POST', url: '/api/voice/web-call', cookies, payload: offer })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ sdp: 'v=0 respuesta', type: 'answer' })
    expect(received[0]!.headers['x-internal-key']).toBe(KEY)
    expect(JSON.parse(received[0]!.body)).toEqual({ ...offer, phone: '573001112233' })

    status = 503
    expect((await server.inject({ method: 'POST', url: '/api/voice/web-call', cookies, payload: offer })).json().error).toBe('voice_busy')
    expect((await server.inject({ method: 'POST', url: '/api/voice/web-call', cookies, payload: { sdp: 'x', type: 'answer' } })).statusCode).toBe(400)

    await server.close()
    await new Promise((r) => target.close(r))
  })
})
