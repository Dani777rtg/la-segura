import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { LookupService } from './service.ts'

const query = z.object({ q: z.string().trim().min(3).max(300) })

export function lookupRoutes(app: FastifyInstance, lookup: LookupService) {
  app.get('/lookup', { preHandler: app.requireUser }, async (req) => lookup.lookup(req.userId!, query.parse(req.query).q))
}
