import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import QRCode from 'qrcode'
import { z } from 'zod'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import { presentations } from '../../db/schema.ts'
import { AppError } from '../../lib/errors.ts'
import { hit } from '../../lib/rateLimit.ts'

// Diapositivas que se manejan desde el celular: la pantalla del computador consulta en qué diapositiva va y el
// celular (con el enlace de control, que trae un secreto) la cambia. Sin cuentas ni datos personales.
const codeParam = z.object({ code: z.string().regex(/^[a-z0-9]{6}$/) })
const slideBody = z.object({ token: z.string().min(16).max(64), slide: z.number().int().min(0).max(50) })
const qrQuery = z.object({ data: z.string().max(400) })
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

export function presentationRoutes(app: FastifyInstance, db: Db, config: Config) {
  app.post('/presentation', async (req) => {
    await hit(db, `pres:${req.ip}`, 10, 3600, 'Demasiadas presentaciones nuevas. Intenta más tarde')
    const code = randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 6)
    const token = randomBytes(18).toString('base64url')
    await db.insert(presentations).values({ code, tokenHash: sha(token) })
    return { code, token }
  })

  app.get('/presentation/:code', async (req, reply) => {
    const { code } = codeParam.parse(req.params)
    const [p] = await db.select({ slide: presentations.slide }).from(presentations).where(eq(presentations.code, code))
    if (!p) throw new AppError(404, 'not_found', 'No encontramos esa presentación')
    return reply.header('Cache-Control', 'no-store').send(p)
  })

  app.post('/presentation/:code/slide', async (req) => {
    const { code } = codeParam.parse(req.params)
    const { token, slide } = slideBody.parse(req.body)
    const [p] = await db.select().from(presentations).where(eq(presentations.code, code))
    const given = Buffer.from(sha(token))
    if (!p || !timingSafeEqual(given, Buffer.from(p.tokenHash))) throw new AppError(403, 'forbidden', 'Este enlace no controla la presentación')
    await db.update(presentations).set({ slide, updatedAt: sql`now()` }).where(eq(presentations.code, code))
    return { slide }
  })

  // QR en SVG para las diapositivas. Solo para el WhatsApp del bot, el repositorio público o enlaces de esta app (no es un
  // generador abierto de QR).
  app.get('/qr.svg', async (req, reply) => {
    const { data } = qrQuery.parse(req.query)
    const allowed = data.startsWith('https://wa.me/') || data.startsWith('https://github.com/Dani777rtg/') || [config.PUBLIC_BASE_URL, config.WEB_ORIGIN].some((o) => data.startsWith(`${o}/`))
    if (!allowed) throw new AppError(400, 'bad_qr', 'Ese enlace no se puede convertir en QR aquí')
    const svg = await QRCode.toString(data, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f2f40', light: '#ffffff' } })
    return reply.header('Content-Type', 'image/svg+xml').header('Cache-Control', 'public, max-age=3600').send(svg)
  })
}
