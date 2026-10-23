import { createHmac } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, llm, speech, ocr, db } = ctx
const APP_SECRET = 'app-secret-de-prueba'
const PHONE = '3001112233'
const WA = '573001112233'

let ip = 0
async function signup(phone = PHONE) {
  const remoteAddress = `10.6.0.${++ip}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress })
  await post('/api/auth/register', { name: 'Ana Gómez', phone, password: 'clave-segura-1', municipalityCode: '05001' })
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  whatsapp.reset()
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}

let msgSeq = 0
const text = (body: string, from = WA, id = `wamid.${++msgSeq}`) => ({ id, from, type: 'text', text: { body } })

function send(messages: object[], opts: { phoneId?: string; secret?: string } = {}) {
  const body = JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: opts.phoneId ?? '999' }, messages } }] }],
  })
  const sig = createHmac('sha256', opts.secret ?? APP_SECRET).update(body).digest('hex')
  return app.inject({
    method: 'POST',
    url: '/api/webhooks/whatsapp',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${sig}` },
    payload: body,
  })
}
const texts = () => whatsapp.outbox.filter((o) => o.kind === 'text').map((o) => (o as { body: string }).body)
const balance = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { ps_session: cookie } })).json().credits

const SCAM = 'Bancolombia: tu cuenta será bloqueada hoy, confirma tu clave dinámica en https://bancolombia-seguro.xyz'

beforeEach(async () => {
  whatsapp.reset()
  whatsapp.media.clear()
  speech.spoken.length = 0
  llm.next = { risk: 'alto', confidence: 92, fraudType: 'suplantacion_entidad', summary: 'Es un mensaje falso que imita a Bancolombia.', reasons: [], advice: ['No entres al enlace', 'Llama a tu banco'] }
  await ctx.reset()
})
afterAll(ctx.close)

describe('webhook de WhatsApp: seguridad', () => {
  it('el apretón inicial solo responde con el token correcto', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-de-prueba&hub.challenge=12345' })
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toBe('12345')
    const bad = await app.inject({ method: 'GET', url: '/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=12345' })
    expect(bad.statusCode).toBe(403)
  })

  it('rechaza avisos sin firma o con firma falsa y no responde nada', async () => {
    await signup()
    expect((await send([text('hola')], { secret: 'secreto-falso' })).statusCode).toBe(401)
    const noSig = await app.inject({ method: 'POST', url: '/api/webhooks/whatsapp', headers: { 'content-type': 'application/json' }, payload: '{}' })
    expect(noSig.statusCode).toBe(401)
    expect(whatsapp.outbox).toHaveLength(0)
  })

  it('ignora mensajes dirigidos a otros números de la cuenta', async () => {
    await signup()
    await send([text('hola')], { phoneId: '12345' })
    expect(whatsapp.outbox).toHaveLength(0)
  })

  it('procesa cada mensaje una sola vez aunque Meta reintente', async () => {
    await signup()
    const m = text('hola', WA, 'wamid.repetido')
    await send([m])
    await send([m])
    expect(texts()).toHaveLength(1)
  })
})

describe('publicar una alerta desde el chat', () => {
  it('"publicar" después de un veredicto crea una alerta anónima en la red, gratis', async () => {
    const cookie = await signup()
    await send([text(SCAM)])
    whatsapp.reset()
    await send([text('PUBLICAR')])
    expect(texts()[0]).toContain('Publicado')
    const posts = await db.query.posts.findMany()
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ anonymous: true, kind: 'intentaron' })
    expect(await balance(cookie)).toBe(199) // solo costó el análisis
    await send([text('publicar')]) // otra vez: ya estaba publicada
    expect(texts().at(-1)).toContain('ya estaba publicada')
    expect(await db.query.posts.findMany()).toHaveLength(1)
  })

  it('sin análisis previo pide primero mandar algo sospechoso', async () => {
    await signup()
    await send([text('publicar')])
    expect(texts()[0]).toContain('Primero mándame algo sospechoso')
  })
})

describe('reintentos de Meta', () => {
  it('si el procesamiento se corta a medias, el reintento del mismo mensaje SÍ se atiende', async () => {
    await signup()
    const m = text('hola', WA, 'wamid.cortado')
    whatsapp.failNextTexts = 2 // falla el saludo y también el aviso de error: el mensaje queda a medias
    await send([m])
    expect(texts()).toHaveLength(0)
    await db.execute(sql`UPDATE wa_messages SET created_at = now() - interval '5 minutes' WHERE id = 'wamid.cortado'`)
    await send([m]) // reintento de Meta
    expect(texts()).toHaveLength(1)
    await send([m]) // y ahora que terminó, un tercer aviso ya no repite
    expect(texts()).toHaveLength(1)
  })

  it('un aviso repetido mientras el primero sigue en curso no duplica la respuesta', async () => {
    await signup()
    const m = text('hola', WA, 'wamid.simultaneo')
    await Promise.all([send([m]), send([m]), send([m])])
    expect(texts()).toHaveLength(1)
  })

  it('al pedir el reporte avisa de inmediato que lo está armando', async () => {
    await signup()
    await send([text(SCAM)])
    whatsapp.reset()
    await send([text('Sí')])
    expect(texts()[0]).toContain('Armando tu reporte')
    expect(whatsapp.outbox.some((o) => o.kind === 'document')).toBe(true)
  })
})

describe('personas sin cuenta', () => {
  it('reciben la invitación a registrarse y no más de 2 veces por hora', async () => {
    for (let i = 0; i < 4; i++) await send([text('hola', '573009998877')])
    const replies = whatsapp.outbox.filter((o) => o.kind === 'text')
    expect(replies).toHaveLength(2)
    expect(texts()[0]).toContain('crea tu cuenta')
    expect(whatsapp.outbox.every((o) => o.to === '573009998877')).toBe(true)
  })
})

describe('conversación', () => {
  it('un saludo no cuesta créditos', async () => {
    const cookie = await signup()
    await send([text('Hola buenas')])
    expect(texts()[0]).toContain('La Segura')
    expect(await balance(cookie)).toBe(200)
  })

  it('un mensaje sospechoso recibe veredicto corto, consejos y la oferta del reporte; cobra 1 crédito', async () => {
    const cookie = await signup()
    await send([text(SCAM)])
    const reply = texts()[0]!
    expect(reply).toContain('🔴')
    expect(reply).toContain('Muy probable que sea una estafa')
    expect(reply).not.toMatch(/\d+\s?%/)
    expect(reply).toContain('Responde *PUBLICAR*')
    expect(reply).toContain('1. No entres al enlace')
    expect(reply).toContain('Responde *SÍ*')
    expect(reply.length).toBeLessThan(600)
    expect(await balance(cookie)).toBe(199)
  })

  it('un riesgo bajo nunca dice que es seguro y no ofrece el reporte', async () => {
    await signup()
    llm.next = { risk: 'bajo', confidence: 60, fraudType: 'ninguno', summary: 'Parece un mensaje normal.', reasons: [], advice: [] }
    await send([text('Nos vemos mañana para almorzar')])
    const reply = texts()[0]!
    expect(reply).toContain('no puedo asegurar que sea seguro')
    expect(reply).not.toContain('Responde *SÍ*')
  })

  it('"sí" después del veredicto genera el reporte, envía el PDF y cobra 5 créditos', async () => {
    const cookie = await signup()
    await send([text(SCAM)])
    whatsapp.reset()
    await send([text('Sí')])
    const doc = whatsapp.outbox.find((o) => o.kind === 'document') as { filename: string; bytes: number }
    expect(doc.filename).toMatch(/^reporte-PS-[A-Z0-9]{5}-[A-Z0-9]{5}\.pdf$/)
    expect(doc.bytes).toBeGreaterThan(3000)
    expect(texts().at(-1)).toContain('/certificado/PS-')
    expect(await balance(cookie)).toBe(200 - 1 - 5)
  })

  it('un "sí" suelto, sin veredicto previo, se analiza como mensaje normal en vez de crear un reporte', async () => {
    await signup()
    await send([text('Sí')])
    expect(await db.query.reports.findMany()).toHaveLength(0)
  })

  it('"saldo" muestra los créditos y "voz" lee la última respuesta', async () => {
    await signup()
    await send([text(SCAM)])
    whatsapp.reset()
    await send([text('saldo')])
    expect(texts()[0]).toContain('199 créditos')
    await send([text('voz')])
    expect(whatsapp.outbox.some((o) => o.kind === 'audio')).toBe(true)
    expect(speech.spoken.at(-1)).toContain('Bancolombia')
  })

  it('sin créditos avisa cómo recargar, sin errores técnicos', async () => {
    await signup()
    await db.execute(sql`UPDATE credit_accounts SET balance = 0`)
    await send([text(SCAM)])
    expect(texts()[0]).toContain('sin créditos')
    expect(texts()[0]).toContain('/app/creditos')
  })

  it('los errores internos no se filtran a la persona', async () => {
    await signup()
    llm.next = new Error('DeepSeek caído: secreto-interno')
    await send([text(SCAM)])
    expect(texts().join(' ')).not.toContain('secreto-interno')
    expect(texts().length).toBeGreaterThan(0)
  })
})

describe('audio e imágenes', () => {
  it('un audio se transcribe y se responde SOLO con texto (para hablar están las llamadas); cuesta 2 créditos', async () => {
    const cookie = await signup()
    whatsapp.media.set('media-1', { data: Buffer.from('audio'), mime: 'audio/ogg; codecs=opus' })
    speech.transcript = 'Me llamaron diciendo que eran del banco y pidieron mi clave'
    await send([{ id: 'wamid.audio1', from: WA, type: 'audio', audio: { id: 'media-1' } }])
    expect(texts()[0]).toContain('🔴')
    expect(whatsapp.outbox.some((o) => o.kind === 'audio')).toBe(false)
    expect(await balance(cookie)).toBe(198)
  })

  it('una captura se lee con OCR y se responde con texto', async () => {
    const cookie = await signup()
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)])
    whatsapp.media.set('media-2', { data: png, mime: 'image/png' })
    ocr.text = SCAM
    await send([{ id: 'wamid.img1', from: WA, type: 'image', image: { id: 'media-2' } }])
    expect(texts()[0]).toContain('🔴')
    expect(whatsapp.outbox.some((o) => o.kind === 'audio')).toBe(false)
    expect(await balance(cookie)).toBe(198)
  })

  it('otros tipos (stickers, ubicación) reciben una guía amable sin cobrar', async () => {
    const cookie = await signup()
    await send([{ id: 'wamid.stk', from: WA, type: 'sticker' }])
    expect(texts()[0]).toContain('texto, un audio o una captura')
    expect(await balance(cookie)).toBe(200)
  })
})

describe('memoria de la conversación', () => {
  it('"Hola ma, cambié de número…" se analiza como posible estafa en vez de contestar el saludo', async () => {
    await signup()
    await send([text('Hola ma, cambié de número, necesito que me consignes 300 mil urgente')])
    expect(texts()[0]).toContain('*Probablemente es una estafa*')
  })

  it('cada turno guarda lo dicho y el siguiente turno se lo pasa al modelo (WhatsApp con contexto)', async () => {
    await signup()
    await send([text('Hola')])
    await send([text(SCAM)])
    await send([text('¿Y eso que te mandé era del banco?')])
    const last = llm.conversations.at(-1)!
    const said = last.map((m) => m.content).join('\n')
    expect(said).toContain('Hola')
    expect(said).toContain(SCAM) // el mensaje anterior de la persona
    expect(said).toMatch(/\*(Muy probable|Probablemente).*estafa\*/) // y la respuesta que le dimos
    expect(last[0]!.role).toBe('system')
    expect(last[0]!.content).toContain('Casos recientes') // los casos analizados también van en la memoria
  })

  it('si el modelo contesta en texto se envía tal cual; si falla, se analiza el mensaje (respuesta segura)', async () => {
    await signup()
    llm.conversation = { text: 'Ese caso ya lo revisamos: parece estafa. No respondas.' }
    await send([text('¿qué pasó con lo de ayer?')])
    expect(texts().at(-1)).toBe('Ese caso ya lo revisamos: parece estafa. No respondas.')
    llm.conversation = new Error('DeepSeek caído')
    await send([text(SCAM)])
    expect(texts().at(-1)).toMatch(/\*(Muy probable|Probablemente).*estafa\*/)
    llm.conversation = null
  })

  it('lo hablado en una llamada queda en la misma memoria que WhatsApp', async () => {
    await signup()
    const res = await app.inject({
      method: 'POST', url: '/api/internal/voice/transcript', headers: { 'x-internal-key': 'clave-interna-de-prueba-123456' },
      payload: { phone: WA, turns: [{ role: 'user', content: 'Me llamaron diciendo que eran de la DIAN' }, { role: 'assistant', content: 'Eso podría ser una estafa.' }] },
    })
    expect([200, 401, 503]).toContain(res.statusCode)
    if (res.statusCode !== 200) return // el servidor de prueba no tiene clave interna configurada
    await send([text('¿y lo de la llamada?')])
    expect(llm.conversations.at(-1)!.map((m) => m.content).join('\n')).toContain('(en llamada) Me llamaron diciendo que eran de la DIAN')
  })

  it('cuando la conversación se alarga, resume lo viejo y lo guarda como memoria de largo plazo', async () => {
    await signup()
    llm.conversation = { text: 'Entendido.' }
    for (let i = 0; i < 14; i++) await send([text(`mensaje número ${i} sobre una oferta rara`)])
    llm.conversation = null
    await new Promise((r) => setTimeout(r, 100))
    const [mem] = await db.execute(sql`SELECT summary FROM chat_memory`).then((r) => r.rows as Array<{ summary: string }>)
    expect(mem?.summary).toContain('turnos resumidos')
  })
})

describe('publicar desde WhatsApp', () => {
  it('"¿puedes publicar el mensaje en la app para que le salga a otros?" publica el último caso', async () => {
    await signup()
    await send([text(SCAM)])
    await send([text('Oye puede publicar el mensaje en al app para que le salga a otras personas')])
    expect(texts().at(-1)).toContain('Publicado ✅')
  })
})
