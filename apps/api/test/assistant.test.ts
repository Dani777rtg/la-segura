import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, llm, speech } = ctx

let ip = 0
async function signup(phone = '3001112233') {
  const remoteAddress = `10.12.0.${++ip}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress })
  await post('/api/auth/register', { name: 'Ana Gómez', phone, password: 'clave-segura-1', municipalityCode: '05001' })
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}
const say = (cookie: string, text: string) => app.inject({ method: 'POST', url: '/api/assistant/message', cookies: { ps_session: cookie }, payload: { text } })
const credits = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { ps_session: cookie } })).json().credits

beforeEach(async () => {
  whatsapp.reset()
  llm.conversation = null
  llm.conversations.length = 0
  llm.next = { risk: 'alto', confidence: 90, fraudType: 'suplantacion_entidad', summary: 'Imita a un banco.', reasons: [], advice: ['No entres al enlace'] }
  await ctx.reset()
})
afterAll(ctx.close)

describe('chat de la app (mismo asistente que WhatsApp)', () => {
  it('una pregunta o un permiso se conversa sin analizar ni cobrar', async () => {
    const cookie = await signup()
    llm.conversation = { text: 'Claro que sí, mándamelo y lo reviso.' }
    const res = await say(cookie, '¿Te puedo enviar otro mensaje?')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ reply: 'Claro que sí, mándamelo y lo reviso.' })
    expect(res.json().analysis).toBeUndefined()
    expect(await credits(cookie)).toBe(200)
  })

  it('cuando el asistente decide revisar, devuelve el análisis completo y cobra 1 crédito', async () => {
    const cookie = await signup()
    const res = (await say(cookie, 'Bancolombia: tu cuenta será bloqueada, entra a bancolombia-seguro.xyz')).json()
    expect(res.analysis.caseId).toBeGreaterThan(0)
    expect(res.reply).toContain('estafa')
    expect(await credits(cookie)).toBe(199)
  })

  it('"publícalo" desde la app publica el último caso; "reporte" pide abrir el formulario', async () => {
    const cookie = await signup()
    await say(cookie, 'Bancolombia: tu cuenta será bloqueada, entra a bancolombia-seguro.xyz')
    llm.conversation = { tool: 'publicar_alerta', args: {} }
    expect((await say(cookie, 'publícalo para mis vecinos')).json().reply).toContain('Publicado')
    llm.conversation = { tool: 'armar_reporte', args: {} }
    expect((await say(cookie, 'hazme el reporte')).json()).toMatchObject({ action: 'report' })
  })

  it('una nota de voz se transcribe y pasa por el asistente: una pregunta hablada no se analiza', async () => {
    const cookie = await signup()
    speech.transcript = '¿En qué más me puedes ayudar?'
    llm.conversation = { text: 'Te ayudo a revisar mensajes, enlaces y llamadas.' }
    const res = await app.inject({ method: 'POST', url: '/api/assistant/audio', cookies: { ps_session: cookie }, headers: { 'content-type': 'audio/webm' }, payload: Buffer.from('audio') })
    expect(res.json()).toMatchObject({ transcript: '¿En qué más me puedes ayudar?', reply: 'Te ayudo a revisar mensajes, enlaces y llamadas.' })
    expect(await credits(cookie)).toBe(200)
  })

  it('la conversación es una sola: el historial de la app muestra también lo de WhatsApp', async () => {
    const cookie = await signup()
    llm.conversation = { text: 'Hola, ¿en qué te ayudo?' }
    await say(cookie, 'Hola desde la app')
    const hist = (await app.inject({ method: 'GET', url: '/api/assistant/history', cookies: { ps_session: cookie } })).json()
    expect(hist.items.map((m: { content: string }) => m.content)).toEqual(['Hola desde la app', 'Hola, ¿en qué te ayudo?'])
    expect(hist.items[0].channel).toBe('app')
    // y lo de la app llega al modelo cuando la persona escribe por WhatsApp
    expect((await app.inject({ method: 'GET', url: '/api/assistant/history' })).statusCode).toBe(401)
  })
})
