import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { FRAUD_TYPES } from '../../gateways/llm.ts'
import type { FeedService } from './service.ts'

const createBody = z.object({
  kind: z.enum(['estafaron', 'intentaron']),
  text: z.string().trim().min(10, 'Cuéntanos un poco más').max(600),
  fraudType: z.enum(FRAUD_TYPES).optional(),
})
const listQuery = z.object({
  before: z.string().regex(/^[0-2]_\d{1,15}$/).transform((v) => { const [rank, id] = v.split('_').map(Number); return { rank: rank!, id: id! } }).optional(),
})
const idParam = z.object({ id: z.coerce.number().int().positive() })

export function feedRoutes(app: FastifyInstance, feed: FeedService) {
  const auth = { preHandler: app.requireUser }

  app.get('/posts', auth, async (req) => feed.list(req.userId!, listQuery.parse(req.query).before))
  // Mi perfil: lo que yo publiqué (máximo 50, lo más nuevo primero).
  app.get('/posts/mine', auth, async (req) => feed.list(req.userId!, undefined, 50, true))

  app.post('/posts', auth, async (req, reply) => reply.code(201).send(await feed.create(req.userId!, createBody.parse(req.body))))

  // Publicar un caso analizado como alerta para los vecinos (gratis, una sola vez por caso, sin nombre).
  app.post('/cases/:id/publish', auth, async (req, reply) => {
    const result = await feed.publishCase(req.userId!, idParam.parse(req.params).id)
    return reply.code(result.created ? 201 : 200).send(result)
  })

  app.post('/posts/:id/confirm', auth, async (req, reply) => {
    await feed.confirm(req.userId!, idParam.parse(req.params).id)
    return reply.code(204).send()
  })

  app.delete('/posts/:id/confirm', auth, async (req, reply) => {
    await feed.unconfirm(req.userId!, idParam.parse(req.params).id)
    return reply.code(204).send()
  })

  app.delete('/posts/:id', auth, async (req, reply) => {
    await feed.remove(req.userId!, idParam.parse(req.params).id)
    return reply.code(204).send()
  })
}
