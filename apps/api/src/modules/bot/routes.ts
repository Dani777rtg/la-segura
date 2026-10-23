import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Config } from '../../config.ts'
import { AppError } from '../../lib/errors.ts'
import type { BotService, Incoming } from './service.ts'

const verifyQuery = z.object({
  'hub.mode': z.string().optional(),
  'hub.verify_token': z.string().optional(),
  'hub.challenge': z.string().max(200).optional(),
})

type WaMessage = {
  id: string
  from: string
  type: string
  text?: { body?: string }
  audio?: { id?: string }
  image?: { id?: string }
}
type WaPayload = {
  entry?: Array<{ changes?: Array<{ value?: { metadata?: { phone_number_id?: string }; messages?: WaMessage[] } }> }>
}

export function signatureValid(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const given = header.slice(7)
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

function toIncoming(m: WaMessage): Incoming {
  if (m.type === 'text') return { id: m.id, from: m.from, type: 'text', text: m.text?.body }
  if (m.type === 'audio') return { id: m.id, from: m.from, type: 'audio', mediaId: m.audio?.id }
  if (m.type === 'image') return { id: m.id, from: m.from, type: 'image', mediaId: m.image?.id }
  return { id: m.id, from: m.from, type: 'other' }
}

export function botRoutes(app: FastifyInstance, bot: BotService, config: Config) {
  async function forwardToVoice(raw: Buffer, signature: string | undefined) {
    if (!config.VOICE_SERVICE_URL || !config.VOICE_INTERNAL_KEY) {
      console.error('Llegó un aviso de llamada pero el servicio de voz no está configurado')
      return
    }
    try {
      const res = await fetch(`${config.VOICE_SERVICE_URL.replace(/\/$/, '')}/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? '', 'X-Internal-Key': config.VOICE_INTERNAL_KEY },
        body: new Uint8Array(raw),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) console.error(`El servicio de voz respondió ${res.status}`)
    } catch (err) {
      console.error('No se pudo reenviar la llamada al servicio de voz:', err instanceof Error ? err.message : 'desconocido')
    }
  }

  // Se necesita el cuerpo crudo para comprobar la firma de Meta: este plugin lo conserva como Buffer.
  app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1_000_000 }, (_req, body, done) => done(null, body))

    // Apretón inicial: Meta confirma que la dirección es nuestra con un token que solo conocemos nosotros.
    hooks.get('/webhooks/whatsapp', async (req, reply) => {
      const q = verifyQuery.parse(req.query)
      if (!config.WHATSAPP_VERIFY_TOKEN) throw new AppError(503, 'webhook_not_configured', 'Webhook sin configurar')
      if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN && q['hub.challenge']) {
        return reply.type('text/plain').send(q['hub.challenge'])
      }
      return reply.code(403).send({ error: 'forbidden' })
    })

    hooks.post('/webhooks/whatsapp', async (req, reply) => {
      if (!config.WHATSAPP_APP_SECRET) throw new AppError(503, 'webhook_not_configured', 'Webhook sin configurar')
      const raw = req.body as Buffer
      if (!signatureValid(raw, req.headers['x-hub-signature-256'] as string | undefined, config.WHATSAPP_APP_SECRET)) {
        return reply.code(401).send({ error: 'invalid_signature' })
      }

      let payload: WaPayload
      try {
        payload = JSON.parse(raw.toString('utf8')) as WaPayload
      } catch {
        return reply.code(400).send({ error: 'bad_json' })
      }

      // Avisos de llamadas (campo `calls`): se reenvían tal cual (mismos bytes y firma) al servicio de voz.
      const hasCalls = (payload.entry ?? []).some((e) => e.changes?.some((c) => (c as { field?: string }).field === 'calls'))
      if (hasCalls) await forwardToVoice(raw, req.headers['x-hub-signature-256'] as string | undefined)

      for (const entry of payload.entry ?? []) {
        for (const change of entry.changes ?? []) {
          // La cuenta puede tener más números: solo se atienden los mensajes dirigidos al nuestro.
          if (change.value?.metadata?.phone_number_id !== config.WHATSAPP_PHONE_NUMBER_ID) continue
          for (const m of change.value?.messages ?? []) {
            try {
              await bot.handle(toIncoming(m))
            } catch (err) {
              console.error('Fallo al procesar un mensaje de WhatsApp:', err instanceof Error ? err.message : 'desconocido')
            }
          }
        }
      }
      // Siempre 200: si se responde con error, Meta reintenta y duplicaría el trabajo.
      return reply.code(200).send({ ok: true })
    })
  })
}
