import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { REPORT_TYPES } from '../../db/schema.ts'
import { hit } from '../../lib/rateLimit.ts'
import type { Db } from '../../db/client.ts'
import { certificatePage, notFoundPage } from './certificatePage.ts'
import type { ReportService } from './service.ts'

const createBody = z.object({
  caseId: z.number().int().positive(),
  type: z.enum(REPORT_TYPES).optional(),
  occurredAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => !Number.isNaN(Date.parse(d)) && Date.parse(d) <= Date.now() + 86_400_000, 'Fecha inválida')
    .optional(),
  channel: z.enum(['WhatsApp', 'SMS', 'Llamada', 'Correo', 'Redes sociales', 'Sitio web', 'Otro']).optional(),
  amountCop: z.number().int().min(0).max(10_000_000_000).optional(),
  details: z.string().trim().max(600).optional(),
})
const idParam = z.object({ id: z.coerce.number().int().positive() })
const codeParam = z.object({ code: z.string().regex(/^PS-[A-Z0-9]{5}-[A-Z0-9]{5}$/) })

export function reportRoutes(app: FastifyInstance, db: Db, reports: ReportService) {
  const auth = { preHandler: app.requireUser }

  app.post('/reports', auth, async (req, reply) => {
    await hit(db, `report:${req.userId}`, 10, 3600, 'Creaste muchos reportes seguidos. Intenta más tarde')
    const result = await reports.create(req.userId!, createBody.parse(req.body))
    return reply.code(result.created ? 201 : 200).send(result)
  })

  app.get('/reports', auth, async (req) => ({ items: await reports.list(req.userId!) }))

  app.get('/reports/:id/pdf', auth, async (req, reply) => {
    const { id } = idParam.parse(req.params)
    await hit(db, `pdf:${req.userId}`, 30, 60, 'Vas muy rápido. Espera un momento')
    const { buffer, code } = await reports.pdf(req.userId!, id)
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `inline; filename="reporte-${code}.pdf"`)
      .header('Cache-Control', 'no-store')
      .send(buffer)
  })

  // Verificación pública: cualquiera con el código (o el QR) puede comprobar un certificado.
  app.get('/verify/:code', async (req, reply) => {
    await hit(db, `verify:${req.ip}`, 60, 60, 'Demasiadas consultas. Espera un momento')
    const cert = await reports.publicCertificate(codeParam.parse(req.params).code)
    if (!cert) return reply.code(404).send({ error: 'not_found', message: 'No existe un certificado con ese código' })
    return cert
  })
}

/** Página HTML pública del certificado (la abre el QR del PDF). Fuera del prefijo /api. */
export function certificatePageRoute(app: FastifyInstance, db: Db, reports: ReportService) {
  app.get('/certificado/:code', async (req, reply) => {
    await hit(db, `verify:${req.ip}`, 60, 60, 'Demasiadas consultas. Espera un momento')
    const parsed = codeParam.safeParse(req.params)
    const cert = parsed.success ? await reports.publicCertificate(parsed.data.code) : null
    return reply
      .type('text/html; charset=utf-8')
      .code(cert ? 200 : 404)
      .send(cert ? certificatePage(cert) : notFoundPage())
  })
}
