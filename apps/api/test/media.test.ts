import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, llm, speech, ocr } = ctx

let ip = 0
async function signup(phone: string) {
  const remoteAddress = `10.2.0.${++ip}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress })
  await post('/api/auth/register', { name: 'Ana', phone, password: 'clave-segura-1', municipalityCode: '05001' })
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

const sendBinary = (cookie: string, url: string, body: Buffer, type: string) =>
  app.inject({ method: 'POST', url, cookies: { ps_session: cookie }, headers: { 'content-type': type }, payload: body })

beforeEach(async () => {
  whatsapp.reset()
  speech.spoken.length = 0
  speech.transcript = 'Me llegó un mensaje de Nequi pidiéndome mi clave'
  ocr.text = 'Bancolombia tu cuenta será bloqueada, ingresa a https://bancolombia-seguro.xyz y envía tu clave dinámica'
  llm.next = { risk: 'alto', confidence: 90, fraudType: 'suplantacion_entidad', summary: 'Parece estafa.', reasons: [], advice: [] }
  await ctx.reset()
})
afterAll(ctx.close)

describe('análisis por voz', () => {
  it('transcribe, analiza, cobra 2 créditos y devuelve la transcripción', async () => {
    const cookie = await signup('3001112233')
    const res = await sendBinary(cookie, '/api/analyze/audio', Buffer.from('audio'), 'audio/webm;codecs=opus')
    expect(res.statusCode).toBe(200)
    expect(res.json().transcript).toBe(speech.transcript)
    expect(res.json().creditsLeft).toBe(198)
    expect(llm.calls[0]!.text).toBe(speech.transcript)
  })

  it('si no se escucha nada, responde 400 y no cobra', async () => {
    const cookie = await signup('3001112233')
    speech.transcript = ''
    const res = await sendBinary(cookie, '/api/analyze/audio', Buffer.from('audio'), 'audio/webm')
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('no_speech')
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { ps_session: cookie } })).json().credits).toBe(200)
  })

  it('exige sesión', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/analyze/audio', headers: { 'content-type': 'audio/webm' }, payload: Buffer.from('a') })
    expect(res.statusCode).toBe(401)
  })
})

describe('análisis de capturas', () => {
  it('lee el texto de la imagen, lo analiza y cobra 2 créditos', async () => {
    const cookie = await signup('3001112233')
    const res = await sendBinary(cookie, '/api/analyze/image', PNG, 'image/png')
    expect(res.statusCode).toBe(200)
    expect(res.json().risk).toBe('alto')
    expect(res.json().extractedText).toBe(ocr.text)
    expect(res.json().creditsLeft).toBe(198)
  })

  it('rechaza archivos que no son imágenes aunque digan serlo', async () => {
    const cookie = await signup('3001112233')
    const res = await sendBinary(cookie, '/api/analyze/image', Buffer.from('<html>no soy una imagen</html>'), 'image/png')
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('bad_image')
  })

  it('imagen sin texto legible: 400 y sin cobro', async () => {
    const cookie = await signup('3001112233')
    ocr.text = '  . '
    const res = await sendBinary(cookie, '/api/analyze/image', PNG, 'image/png')
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('no_text')
    // Una foto (paisaje, selfie) da letras sueltas al OCR: tampoco se analiza ni se cobra.
    ocr.text = 'Il| ~ 0O ae ;; rn Wl ii 77'
    const photo = await sendBinary(cookie, '/api/analyze/image', PNG, 'image/png')
    expect(photo.json().error).toBe('no_text')
    expect(photo.json().message).toContain('No encontré texto')
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { ps_session: cookie } })).json().credits).toBe(200)
  })
})

describe('voz del veredicto', () => {
  it('devuelve audio y exige texto corto', async () => {
    const cookie = await signup('3001112233')
    const ok = await app.inject({ method: 'POST', url: '/api/voice/speak', cookies: { ps_session: cookie }, payload: { text: 'Parece una estafa' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toBe('audio/mpeg')
    const long = await app.inject({ method: 'POST', url: '/api/voice/speak', cookies: { ps_session: cookie }, payload: { text: 'x'.repeat(601) } })
    expect(long.statusCode).toBe(400)
  })
})
