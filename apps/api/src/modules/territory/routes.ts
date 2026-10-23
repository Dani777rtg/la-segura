import type { FastifyInstance } from 'fastify'
import type { TerritoryService } from './service.ts'

// Datos agregados y anónimos: el panel es público (no expone usuarios ni casos individuales).
export function territoryRoutes(app: FastifyInstance, territory: TerritoryService) {
  app.get('/territory', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60')
    return territory.overview()
  })

  app.get('/territory/bogota-geojson', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=86400')
    return territory.bogotaGeoJson()
  })
}
