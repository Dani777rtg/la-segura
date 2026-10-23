import type { FastifyInstance } from 'fastify'
import { InvalidWebhookSignatureError, WebhookSignatureValidator } from 'mercadopago'
import { z } from 'zod'
import type { Config } from '../../config.ts'
import { AppError } from '../../lib/errors.ts'
import type { CreditsService, SettleOutcome } from './service.ts'

const SIGNATURE_TOLERANCE_SEC = 300

const webhookQuery = z.object({ 'data.id': z.string().max(64).optional(), type: z.string().max(40).optional() })
const returnQuery = z.object({ payment_id: z.string().regex(/^\d{1,20}$/).optional(), collection_id: z.string().regex(/^\d{1,20}$/).optional() })

export function creditsRoutes(app: FastifyInstance, credits: CreditsService, config: Config) {
  const auth = { preHandler: app.requireUser }

  app.get('/credits', auth, async (req) => credits.overview(req.userId!))
  app.post('/credits/checkout', auth, async (req) => credits.checkout(req.userId!))
  app.post('/donations/checkout', auth, async (req) => credits.donate(req.userId!))

  // Retorno del usuario desde Mercado Pago. Funciona aunque el webhook no llegue (p. ej. en desarrollo).
  async function settleReturn(query: unknown): Promise<'success' | 'failure' | 'pending'> {
    const q = returnQuery.safeParse(query)
    const paymentId = q.success ? (q.data.payment_id ?? q.data.collection_id) : undefined
    let outcome: SettleOutcome = 'pending'
    if (paymentId) {
      try {
        outcome = await credits.settle(paymentId)
      } catch (err) {
        console.error('Fallo al confirmar el pago al volver:', err instanceof Error ? err.message : 'desconocido')
      }
    }
    return outcome === 'approved' ? 'success' : outcome === 'rejected' ? 'failure' : 'pending'
  }
  app.get('/donations/return', async (req, reply) => reply.redirect(`${config.WEB_ORIGIN}/app?donacion=${await settleReturn(req.query)}`))

  app.get('/credits/return', async (req, reply) => {
    const q = returnQuery.safeParse(req.query)
    const paymentId = q.success ? (q.data.payment_id ?? q.data.collection_id) : undefined
    let outcome: SettleOutcome = 'pending'
    if (paymentId) {
      try {
        outcome = await credits.settle(paymentId)
      } catch (err) {
        console.error('Fallo al confirmar el pago al volver:', err instanceof Error ? err.message : 'desconocido')
      }
    }
    const status = outcome === 'approved' ? 'success' : outcome === 'rejected' ? 'failure' : 'pending'
    return reply.redirect(`${config.WEB_ORIGIN}/app/creditos?status=${status}`)
  })

  // Aviso de Mercado Pago. Solo se acepta con firma válida (HMAC-SHA256 con la clave secreta de la app).
  app.post('/webhooks/mercadopago', async (req, reply) => {
    const secret = config.MERCADOPAGO_WEBHOOK_SECRET
    if (!secret) throw new AppError(503, 'webhook_not_configured', 'Webhook sin configurar')
    const query = webhookQuery.parse(req.query)
    try {
      WebhookSignatureValidator.validate({
        xSignature: req.headers['x-signature'],
        xRequestId: req.headers['x-request-id'],
        dataId: query['data.id'],
        secret,
        toleranceSeconds: SIGNATURE_TOLERANCE_SEC,
      })
    } catch (err) {
      if (err instanceof InvalidWebhookSignatureError) return reply.code(401).send({ error: 'invalid_signature' })
      throw err
    }
    // Solo interesan los pagos. Cualquier otro tipo de aviso se confirma sin hacer nada.
    if (query.type === 'payment' && query['data.id']) await credits.settle(query['data.id'])
    return reply.code(200).send({ ok: true })
  })
}
