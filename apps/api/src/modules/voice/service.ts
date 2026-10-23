import { desc, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client.ts'
import { botState, cases } from '../../db/schema.ts'
import type { WhatsappGateway } from '../../gateways/whatsapp.ts'
import { AppError } from '../../lib/errors.ts'
import { LEVEL_LABEL } from '../agent/level.ts'
import type { AgentService } from '../agent/service.ts'
import { findUserByPhone } from '../auth/repo.ts'
import { COST } from '../credits/costs.ts'
import { getBalance } from '../credits/repo.ts'
import type { FeedService } from '../feed/service.ts'
import type { Memory } from '../memory/service.ts'
import type { ReportService } from '../reports/service.ts'

// Puente para el agente de llamadas (servicio de voz aparte). Identifica a quien llama por su número de WhatsApp
// y reutiliza el mismo análisis, créditos y registro de casos que la app y el bot de texto.
export type VoiceDeps = { db: Db; agent: AgentService; feed: FeedService; reports: ReportService; wa: WhatsappGateway; memory: Memory; site: string }

const CHANNEL = { web: 'chat', image: 'captura', voice: 'llamada' } as Record<string, string>

export function createVoiceBridge({ db, agent, feed, reports, wa, memory, site }: VoiceDeps) {
  async function verified(phone: string) {
    const user = await findUserByPhone(db, phone)
    return user && user.phoneVerifiedAt ? user : null
  }
  // El caso sobre el que la persona puede decir "publícalo" o "arma el reporte": el último, venga del chat, de una captura o de una llamada.
  async function lastCaseId(phone: string) {
    const [st] = await db.select({ id: botState.lastCaseId }).from(botState).where(eq(botState.phone, phone))
    return st?.id ?? null
  }

  return {
    async caller(phone: string) {
      const user = await verified(phone)
      if (!user) return { registered: false as const }
      // Contexto compartido con el chat: los últimos casos de la persona, sin importar por qué canal los mandó.
      const rows = await db.select().from(cases).where(eq(cases.userId, user.id)).orderBy(desc(cases.createdAt)).limit(4)
      const last = await lastCaseId(phone)
      const recent = rows.map((c) => ({
        canal: CHANNEL[c.channel] ?? c.channel,
        nivel: c.level ? LEVEL_LABEL[c.level as keyof typeof LEVEL_LABEL] : c.risk,
        resumen: c.summary,
        texto: c.inputText.slice(0, 400),
        esElUltimo: c.id === last,
      }))
      // Memoria compartida: resumen + casos + últimos turnos de cualquier canal (WhatsApp, app, llamadas anteriores).
      const ctx = await memory.context(user.id)
      const history = ctx.turns.slice(-10).map((t) => `${t.role === 'user' ? 'Persona' : 'La Segura'}: ${t.content}`).join('\n')
      const contexto = `${memory.render(ctx, last)}\nÚltimos mensajes (de cualquier canal):\n${history || '(ninguno)'}`
      return { registered: true as const, name: user.name.split(' ')[0]!, credits: await getBalance(db, user.id), recent, contexto }
    },

    /** Al colgar, el servicio de voz manda lo que se habló: queda en la misma memoria que WhatsApp y la app. */
    async transcript(phone: string, turns: Array<{ role: 'user' | 'assistant'; content: string }>) {
      const user = await verified(phone)
      if (!user) return { ok: false as const }
      for (const t of turns.slice(-40)) await memory.add(user.id, 'voice', t.role, t.content)
      void memory.compact(user.id)
      return { ok: true as const, saved: Math.min(turns.length, 40) }
    },

    async publish(phone: string) {
      const user = await verified(phone)
      const caseId = await lastCaseId(phone)
      if (!user || !caseId) return { ok: false as const, reason: 'sin_caso' as const }
      try {
        const posted = await feed.publishCase(user.id, caseId)
        return { ok: true as const, yaEstaba: !posted.created }
      } catch (err) {
        if (err instanceof AppError && err.status < 500) return { ok: false as const, reason: err.status === 400 ? ('sin_senales' as const) : ('error' as const) }
        console.error('Fallo al publicar por llamada:', err instanceof Error ? err.message : 'desconocido')
        return { ok: false as const, reason: 'error' as const }
      }
    },

    // El PDF no se puede dar por voz: se arma y se manda al WhatsApp de la persona.
    async report(phone: string) {
      const user = await verified(phone)
      const caseId = await lastCaseId(phone)
      if (!user || !caseId) return { ok: false as const, reason: 'sin_caso' as const }
      try {
        const created = await reports.create(user.id, { caseId })
        const { buffer, code } = await reports.pdf(user.id, created.id)
        await wa.sendDocument(phone, buffer, `reporte-${code}.pdf`, `Reporte ${code}`)
        await wa.sendText(phone, `Listo ✅ Aquí está tu reporte. Llévalo a tu banco, a ADenunciar o a la Fiscalía: es un soporte, no la denuncia en sí.
Verifícalo en ${site}/certificado/${code}`)
        return { ok: true as const }
      } catch (err) {
        if (err instanceof AppError && err.status === 402) return { ok: false as const, reason: 'sin_creditos' as const }
        console.error('Fallo al armar el reporte por llamada:', err instanceof Error ? err.message : 'desconocido')
        return { ok: false as const, reason: 'error' as const }
      }
    },

    async analyze(phone: string, text: string) {
      const user = await findUserByPhone(db, phone)
      if (!user || !user.phoneVerifiedAt) return { ok: false as const, reason: 'no_registrado' as const }
      try {
        const r = await agent.analyze(user.id, text.slice(0, 2000), { cost: COST.analyzeVoiceOrImage, channel: 'voice' })
        // Después de la llamada la persona puede escribir "reporte" o "publicar" por WhatsApp sobre este caso.
        await db
          .insert(botState)
          .values({ phone, lastCaseId: r.caseId, awaitingReport: r.offerReport })
          .onConflictDoUpdate({ target: botState.phone, set: { lastCaseId: r.caseId, awaitingReport: r.offerReport, updatedAt: sql`now()` } })
        return {
          ok: true as const,
          level: r.level,
          label: LEVEL_LABEL[r.level],
          summary: r.summary,
          advice: r.advice.slice(0, 3),
          offerReport: r.offerReport,
          creditsLeft: r.creditsLeft,
        }
      } catch (err) {
        if (err instanceof AppError && err.status === 402) return { ok: false as const, reason: 'sin_creditos' as const }
        if (err instanceof AppError && err.status === 429) return { ok: false as const, reason: 'muy_rapido' as const }
        console.error('Fallo del análisis por llamada:', err instanceof Error ? err.message : 'desconocido')
        return { ok: false as const, reason: 'error' as const }
      }
    },
  }
}

export type VoiceBridge = ReturnType<typeof createVoiceBridge>
