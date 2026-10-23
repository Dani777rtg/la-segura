import { and, desc, eq, lt, sql } from 'drizzle-orm'
import { cases } from '../../db/schema.ts'
import { extract } from '../agent/signals.ts'
import type { Db } from '../../db/client.ts'
import { localities, municipalities, postConfirmations, posts, users } from '../../db/schema.ts'
import type { LlmGateway } from '../../gateways/llm.ts'
import { AppError, unauthorized } from '../../lib/errors.ts'
import { maskPhone } from '../../lib/phone.ts'
import { hit } from '../../lib/rateLimit.ts'
import { findUserById } from '../auth/repo.ts'

export type CreatePostInput = { kind: 'estafaron' | 'intentaron'; text: string; fraudType?: string }

/** Primera barrera, sin IA: números, correos y cédulas nunca llegan al feed ni al modelo. */
export function redactPersonalData(text: string): string {
  return (
    text
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[correo]')
      // Enlaces: se muestran solo como dominio y sin ser clicables (el feed no debe difundir phishing).
      .replace(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/\S*)?/gi, (_m, host: string) => `[enlace: ${host.toLowerCase()}]`)
      // Cualquier secuencia de 7+ dígitos, aunque traiga puntos, guiones, espacios o paréntesis (cédulas, cuentas, celulares).
      .replace(/(?:\+?\d[\s().-]*){7,}/g, (m) => {
        const digits = m.replace(/\D/g, '')
        if (/^(57)?3\d{9}$/.test(digits)) return maskPhone(digits.startsWith('57') ? digits : `57${digits}`)
        return '[número]'
      })
  )
}

export type FeedDeps = { db: Db; llm: LlmGateway | null }

const FRAUD_LABEL: Record<string, string> = {
  suplantacion_entidad: 'Suplantación de banco o entidad',
  robo_whatsapp: 'Robo de cuenta de WhatsApp o redes',
  sim_swapping: 'Duplicado o cambio de SIM',
  tienda_falsa: 'Tienda o venta falsa',
  prestamo_falso: 'Préstamo falso o gota a gota digital',
  pago_falso: 'Pago falso o "consigné por error"',
  citacion_falsa: 'Citación o notificación falsa',
  inversion_falsa: 'Inversión o premio falso',
}
const DOMAIN_FLAGS = ['dominio_imitador', 'tld_riesgoso', 'ip_directa', 'acortador']

export function createFeedService({ db, llm }: FeedDeps) {
  return {
    async create(userId: number, input: CreatePostInput) {
      await hit(db, `post:${userId}`, 10, 3600, 'Publicaste muchas veces seguidas. Intenta más tarde')
      const user = await findUserById(db, userId)
      if (!user) throw unauthorized()

      let body = redactPersonalData(input.text).slice(0, 600)
      if (llm) {
        try {
          const verdict = await llm.moderate(body)
          if (!verdict.allowed) {
            throw new AppError(422, 'post_rejected', verdict.reason || 'No pudimos publicar este mensaje. Revisa que no tenga insultos ni nombres de personas')
          }
          body = verdict.text.trim().slice(0, 600) || body
        } catch (err) {
          if (err instanceof AppError) throw err
          // Falla cerrado: sin moderación no se publica (un texto sin revisar podría traer nombres o acusaciones).
          console.error('Fallo del moderador:', err instanceof Error ? err.message : 'desconocido')
          throw new AppError(503, 'moderation_unavailable', 'No pudimos revisar tu publicación. Intenta de nuevo en un momento')
        }
      }

      const [row] = await db
        .insert(posts)
        .values({
          userId,
          kind: input.kind,
          body,
          fraudType: input.fraudType ?? 'otro',
          municipalityCode: user.municipalityCode,
          localityId: user.localityId,
        })
        .returning({ id: posts.id })
      return { id: row!.id, body }
    },

    /**
     * Publica un caso analizado como alerta para la comunidad. El texto NO es lo que escribió la persona sino el
     * resumen del análisis (con celulares enmascarados y solo enlaces con señales objetivas). Sale como "Un vecino".
     * Un caso se publica una sola vez.
     */
    async publishCase(userId: number, caseId: number) {
      const [c] = await db.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.userId, userId)))
      if (!c) throw new AppError(404, 'case_not_found', 'No encontramos ese caso')
      if (c.risk === 'bajo') throw new AppError(400, 'case_not_publishable', 'Solo se publican casos con señales de posible estafa')

      const [existing] = await db.select({ id: posts.id, body: posts.body }).from(posts).where(eq(posts.caseId, c.id))
      if (existing) return { id: existing.id, body: existing.body, created: false }

      await hit(db, `post:${userId}`, 10, 3600, 'Publicaste muchas veces seguidas. Intenta más tarde')
      // Se publica lo que de verdad le llegó (así los vecinos lo reconocen si les llega igual), sin datos personales:
      // primero se quitan números, correos y cédulas; luego la IA quita nombres de personas. Si la IA no está o lo
      // rechaza, se publica el resumen del análisis (que nunca trae datos personales).
      const found = extract(c.inputText)
      const badDomains = found.domains.filter((d) => extract(`https://${d}`).signals.some((s) => DOMAIN_FLAGS.includes(s.key)))
      const summaryParts = [`${FRAUD_LABEL[c.fraudType] ?? 'Posible estafa'}: ${c.summary}`]
      if (badDomains.length) summaryParts.push(`Enlace sospechoso: ${badDomains.join(', ')}.`)
      if (c.risk === 'alto' && found.phones.length) summaryParts.push(`Número involucrado: ${found.phones.map((p) => maskPhone(p)).join(', ')}.`)
      let body = redactPersonalData(summaryParts.join(' ')).slice(0, 600)
      const exact = redactPersonalData(c.inputText.replace(/^\[(Nota de voz|Captura de pantalla)\]\s*/i, '')).trim().slice(0, 480)
      if (llm && exact.length >= 10) {
        try {
          const v = await llm.moderate(`Me llegó este mensaje: «${exact}»`)
          if (v.allowed && v.text.trim()) body = v.text.trim().slice(0, 600)
        } catch (err) {
          console.error('Fallo del moderador al publicar el caso:', err instanceof Error ? err.message : 'desconocido')
        }
      }

      const [row] = await db
        .insert(posts)
        .values({
          userId,
          kind: 'intentaron',
          body,
          fraudType: c.fraudType === 'ninguno' ? 'otro' : c.fraudType,
          municipalityCode: c.municipalityCode,
          localityId: c.localityId,
          caseId: c.id,
          anonymous: true,
        })
        .onConflictDoNothing({ target: posts.caseId })
        .returning({ id: posts.id })
      if (!row) {
        const [again] = await db.select({ id: posts.id, body: posts.body }).from(posts).where(eq(posts.caseId, c.id))
        return { id: again!.id, body: again!.body, created: false }
      }
      return { id: row.id, body, created: true }
    },

    /**
     * Muro ordenado por cercanía: primero lo de la ciudad o municipio de quien mira, luego su departamento
     * y al final el resto del país. La cercanía solo cuenta los últimos 30 días,
     * para que una alerta vieja del barrio no tape lo nuevo. El cursor es "cercanía_id".
     */
    async list(userId: number, before?: { rank: number; id: number }, limit = 20, onlyMine = false) {
      const me = await findUserById(db, userId)
      if (!me) throw unauthorized()
      // Primero la ciudad o municipio de quien mira (Bogotá entera, no solo su localidad), luego su departamento.
      const myDept = sql`(SELECT dept_code FROM municipalities WHERE code = ${me.municipalityCode})`
      const rank = sql<number>`(CASE WHEN ${posts.createdAt} < now() - interval '30 days' THEN 0
        WHEN ${posts.municipalityCode} = ${me.municipalityCode} THEN 2 WHEN ${municipalities.deptCode} = ${myDept} THEN 1 ELSE 0 END)`
      const rows = await db
        .select({
          id: posts.id,
          kind: posts.kind,
          body: posts.body,
          fraudType: posts.fraudType,
          createdAt: posts.createdAt,
          authorId: posts.userId,
          authorName: users.name,
          anonymous: posts.anonymous,
          demo: users.isDemo,
          municipality: municipalities.name,
          locality: localities.name,
          rank,
          confirms: sql<number>`(SELECT count(*)::int FROM ${postConfirmations} c WHERE c.post_id = ${posts.id})`,
          confirmedByMe: sql<boolean>`EXISTS (SELECT 1 FROM ${postConfirmations} c WHERE c.post_id = ${posts.id} AND c.user_id = ${userId})`,
        })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.userId))
        .innerJoin(municipalities, eq(municipalities.code, posts.municipalityCode))
        .leftJoin(localities, eq(localities.id, posts.localityId))
        .where(and(
          eq(posts.status, 'published'),
          onlyMine ? eq(posts.userId, userId) : undefined,
          before ? sql`(${rank} < ${before.rank} OR (${rank} = ${before.rank} AND ${posts.id} < ${before.id}))` : undefined,
        ))
        // En "mis publicaciones" basta el orden por fecha; en el muro, primero lo cercano.
        .orderBy(...(onlyMine ? [desc(posts.id)] : [desc(rank), desc(posts.id)]))
        .limit(limit + 1)

      const page = rows.slice(0, limit)
      const [area] = await db.select({ name: municipalities.name }).from(municipalities).where(eq(municipalities.code, me.municipalityCode))
      const last = page.at(-1)
      return {
        area: area?.name ?? null,
        items: page.map(({ authorId, authorName, anonymous, municipality, locality, rank: r, ...p }) => ({
          ...p,
          near: r === 2,
          // Todo el muro es anónimo: nunca se dice quién publicó (la persona ve "Tú" en lo suyo).
          author: authorId === userId ? 'Tú' : 'Un vecino',
          place: locality ? `${locality}, Bogotá` : municipality,
          mine: authorId === userId,
        })),
        nextCursor: rows.length > limit && last ? `${last.rank}_${last.id}` : null,
      }
    },

    async confirm(userId: number, postId: number) {
      const [post] = await db.select({ userId: posts.userId }).from(posts).where(and(eq(posts.id, postId), eq(posts.status, 'published')))
      if (!post) throw new AppError(404, 'post_not_found', 'No encontramos esa publicación')
      if (post.userId === userId) throw new AppError(400, 'own_post', 'No puedes confirmar tu propia publicación')
      await db.insert(postConfirmations).values({ postId, userId }).onConflictDoNothing()
    },

    async unconfirm(userId: number, postId: number) {
      await db.delete(postConfirmations).where(and(eq(postConfirmations.postId, postId), eq(postConfirmations.userId, userId)))
    },

    async remove(userId: number, postId: number) {
      const res = await db
        .update(posts)
        .set({ status: 'hidden' })
        .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
        .returning({ id: posts.id })
      if (res.length === 0) throw new AppError(404, 'post_not_found', 'No encontramos esa publicación')
    },
  }
}

export type FeedService = ReturnType<typeof createFeedService>
