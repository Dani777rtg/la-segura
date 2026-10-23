import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import { hit } from '../../lib/rateLimit.ts'
import { findUserById } from '../auth/repo.ts'
import { AppError } from '../../lib/errors.ts'
import { normalizeColombianMobile } from '../../lib/phone.ts'
import type { VoiceBridge } from './service.ts'

const phoneField = z.string().max(20).transform((v) => normalizeColombianMobile(v) ?? '')
const callerQuery = z.object({ phone: phoneField })
const offerBody = z.object({ sdp: z.string().min(10).max(20_000), type: z.literal('offer') })
const analyzeBody = z.object({ phone: phoneField, text: z.string().trim().min(3).max(2000) })

// Rutas internas: solo las llama el servicio de voz con una clave compartida. No son parte de la API pública.
export function voiceRoutes(app: FastifyInstance, bridge: VoiceBridge, config: Config, db: Db) {
  function guard(req: FastifyRequest) {
    const expected = config.VOICE_INTERNAL_KEY
    if (!expected) throw new AppError(503, 'voice_not_configured', 'Voz sin configurar')
    const given = String(req.headers['x-internal-key'] ?? '')
    const a = Buffer.from(given)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError(401, 'unauthorized', 'No autorizado')
  }

  app.get('/internal/voice/caller', async (req) => {
    guard(req)
    const { phone } = callerQuery.parse(req.query)
    if (!phone) return { registered: false }
    return bridge.caller(phone)
  })

  const phoneBody = z.object({ phone: phoneField })
  const transcriptBody = z.object({
    phone: phoneField,
    turns: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(2000) })).max(200),
  })
  app.post('/internal/voice/transcript', async (req) => {
    guard(req)
    const { phone, turns } = transcriptBody.parse(req.body)
    return phone ? bridge.transcript(phone, turns) : { ok: false }
  })

  app.post('/internal/voice/publish', async (req) => {
    guard(req)
    const { phone } = phoneBody.parse(req.body)
    return phone ? bridge.publish(phone) : { ok: false, reason: 'no_registrado' }
  })

  app.post('/internal/voice/report', async (req) => {
    guard(req)
    const { phone } = phoneBody.parse(req.body)
    return phone ? bridge.report(phone) : { ok: false, reason: 'no_registrado' }
  })

  app.post('/internal/voice/analyze', async (req) => {
    guard(req)
    const { phone, text } = analyzeBody.parse(req.body)
    if (!phone) return { ok: false, reason: 'no_registrado' }
    return bridge.analyze(phone, text)
  })

  // Llamada desde la web: el navegador manda su oferta WebRTC con la sesión normal y aquí se reenvía al servicio de
  // voz con la clave interna y el celular verificado de la persona. El audio va directo navegador <-> servicio de voz.
  app.post('/voice/web-call', { preHandler: app.requireUser }, async (req) => {
    const offer = offerBody.parse(req.body)
    if (!config.VOICE_SERVICE_URL || !config.VOICE_INTERNAL_KEY) throw new AppError(503, 'voice_not_configured', 'La llamada no está disponible ahora')
    const user = await findUserById(db, req.userId!)
    if (!user?.phoneVerifiedAt) throw new AppError(403, 'phone_not_verified', 'Verifica tu celular para llamar')
    await hit(db, `webcall:${user.id}`, 6, 600, 'Hiciste muchas llamadas seguidas. Espera unos minutos')
    let res: Response
    try {
      res = await fetch(`${config.VOICE_SERVICE_URL.replace(/\/$/, '')}/web/offer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': config.VOICE_INTERNAL_KEY },
        body: JSON.stringify({ ...offer, phone: user.phone }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (err) {
      console.error('No se pudo contactar el servicio de voz:', err instanceof Error ? err.message : 'desconocido')
      throw new AppError(503, 'voice_unavailable', 'No pudimos conectar la llamada. Intenta de nuevo en un momento')
    }
    if (res.status === 503) throw new AppError(503, 'voice_busy', 'Hay muchas llamadas en este momento. Intenta en un minuto')
    if (!res.ok) throw new AppError(502, 'voice_failed', 'No pudimos conectar la llamada. Intenta de nuevo')
    const answer = (await res.json()) as { sdp?: unknown; type?: unknown }
    if (typeof answer.sdp !== 'string' || answer.type !== 'answer') throw new AppError(502, 'voice_failed', 'No pudimos conectar la llamada')
    return { sdp: answer.sdp, type: answer.type }
  })
}
