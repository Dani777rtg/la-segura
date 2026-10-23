import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Db } from '../../db/client.ts'
import { chatMessages } from '../../db/schema.ts'
import { LEVEL_LABEL } from '../agent/level.ts'
import type { IntakeService } from '../agent/intake.ts'
import type { AnalysisResult } from '../agent/service.ts'
import type { Memory } from '../memory/service.ts'
import type { Assistant } from './service.ts'

const messageBody = z.object({ text: z.string().trim().min(1).max(4000) })
const MEDIA_LIMIT = 6 * 1024 * 1024

const verdictText = (r: AnalysisResult) => `${LEVEL_LABEL[r.level]}. ${r.summary}`

// Chat de la app: el mismo asistente y la misma memoria que WhatsApp y las llamadas.
export function assistantRoutes(app: FastifyInstance, db: Db, assistant: Assistant, memory: Memory, intake: IntakeService) {
  const auth = { preHandler: app.requireUser }

  async function turn(userId: number, text: string, fromMedia: boolean) {
    const out = await assistant.decide(userId, 'app', text, fromMedia)
    let reply: string
    let analysis: AnalysisResult | undefined
    let action: 'report' | undefined
    let caseId: number | undefined
    if (out.kind === 'analysis') {
      analysis = out.result
      reply = verdictText(out.result)
      await assistant.setLastCase(userId, out.result.caseId, out.result.offerReport)
    } else if (out.kind === 'publish') reply = await assistant.publish(userId)
    else if (out.kind === 'balance') reply = `Tienes ${out.credits} créditos.`
    else if (out.kind === 'report') {
      reply = out.caseId ? 'Listo, armemos tu reporte. Completa los datos que quieras agregar.' : 'Primero mándame algo sospechoso para revisarlo y luego armamos el reporte.'
      if (out.caseId) { action = 'report'; caseId = out.caseId }
    } else reply = out.text
    await memory.add(userId, 'app', 'assistant', reply)
    void memory.compact(userId)
    return { reply, analysis, action, caseId }
  }

  app.post('/assistant/message', auth, async (req) => {
    const { text } = messageBody.parse(req.body)
    await memory.add(req.userId!, 'app', 'user', text)
    return turn(req.userId!, text, false)
  })

  // Nota de voz desde la app: se transcribe y el asistente decide (puede ser una pregunta, no solo un mensaje a revisar).
  app.post('/assistant/audio', { ...auth, bodyLimit: MEDIA_LIMIT }, async (req) => {
    const transcript = await intake.transcribe(req.userId!, req.body as Buffer, req.headers['content-type'] ?? 'audio/webm')
    await memory.add(req.userId!, 'app', 'user', `[Nota de voz] ${transcript}`)
    return { transcript, ...(await turn(req.userId!, transcript, true)) }
  })

  // Una captura casi siempre es un mensaje para revisar: se lee y se analiza directo.
  app.post('/assistant/image', { ...auth, bodyLimit: MEDIA_LIMIT }, async (req) => {
    const r = await intake.fromImage(req.userId!, req.body as Buffer)
    await memory.add(req.userId!, 'app', 'user', `[Captura de pantalla] ${r.extractedText}`)
    const reply = verdictText(r)
    await memory.add(req.userId!, 'app', 'assistant', reply)
    await assistant.setLastCase(req.userId!, r.caseId, r.offerReport)
    return { reply, analysis: r, extractedText: r.extractedText }
  })

  // La conversación es una sola: la app muestra también lo hablado por WhatsApp y en llamadas.
  app.get('/assistant/history', auth, async (req) => {
    const rows = await db
      .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, channel: chatMessages.channel, createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(eq(chatMessages.userId, req.userId!))
      .orderBy(desc(chatMessages.id))
      .limit(40)
    return { items: rows.reverse() }
  })
}
