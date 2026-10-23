import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Db } from '../../db/client.ts'
import { listLocalities, searchMunicipalities } from './repo.ts'

const searchQuery = z.object({ q: z.string().trim().min(2).max(60) })

export function locationRoutes(app: FastifyInstance, db: Db) {
  app.get('/locations/municipalities', async (req) => {
    const { q } = searchQuery.parse(req.query)
    return { items: await searchMunicipalities(db, q) }
  })

  app.get('/locations/bogota-localities', async () => ({ items: await listLocalities(db) }))
}
