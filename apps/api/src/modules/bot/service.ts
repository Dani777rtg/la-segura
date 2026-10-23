import { and, eq, sql } from 'drizzle-orm'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import { botState, cases, users, waMessages } from '../../db/schema.ts'
import type { SpeechGateway } from '../../gateways/speech.ts'
import type { WhatsappGateway } from '../../gateways/whatsapp.ts'
import { AppError } from '../../lib/errors.ts'
import { hit } from '../../lib/rateLimit.ts'
import type { IntakeService } from '../agent/intake.ts'
import type { AgentService, AnalysisResult } from '../agent/service.ts'
import { getBalance } from '../credits/repo.ts'
import { LEVEL_LABEL } from '../agent/level.ts'
import type { FeedService } from '../feed/service.ts'
import type { Assistant } from '../assistant/service.ts'
import type { Memory } from '../memory/service.ts'
import type { ReportService } from '../reports/service.ts'

export type Incoming = {
  id: string
  from: string // 57XXXXXXXXXX
  type: 'text' | 'audio' | 'image' | 'other'
  text?: string
  mediaId?: string
}

const ICON = { alto: '🔴', medio: '🟠', bajo: '⚪' } as const

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export type BotDeps = {
  db: Db
  wa: WhatsappGateway
  agent: AgentService
  intake: IntakeService
  reports: ReportService
  feed: FeedService
  speech: SpeechGateway | null
  memory: Memory
  assistant: Assistant
  config: Config
}

// El bot solo responde a personas registradas, solo cuando ellas escriben primero y con mensajes cortos.
// Todo lo que entra y sale queda en la memoria compartida con las llamadas y la app.
export function createBotService({ db, wa, intake, reports, speech, memory, assistant, config }: BotDeps) {
  const site = config.PUBLIC_BASE_URL

  const HELP =
    'Soy *La Segura* 🛡️. Mándame un mensaje, enlace, captura o audio que te parezca sospechoso y te digo si parece estafa.\n\n' +
    'Escribe *saldo* para ver tus créditos, *voz* para que te lea la última respuesta o *publicar* para avisar a tus vecinos de una estafa.'

  function formatVerdict(r: AnalysisResult): string {
    const lines = [`${ICON[r.risk]} *${LEVEL_LABEL[r.level]}*`, r.summary]
    if (r.advice.length) lines.push('', '*Qué hacer:*', ...r.advice.slice(0, 3).map((a, i) => `${i + 1}. ${a}`))
    if (r.offerReport) {
      lines.push('', '¿Armo tu reporte en PDF para denunciar? Responde *SÍ* (cuesta 5 créditos).')
      lines.push('¿Alertar a tus vecinos en la red? Responde *PUBLICAR* (gratis, sin tu nombre).')
    }
    return lines.join('\n')
  }

  async function setState(phone: string, lastCaseId: number | null, awaitingReport: boolean) {
    await db
      .insert(botState)
      .values({ phone, lastCaseId, awaitingReport })
      .onConflictDoUpdate({ target: botState.phone, set: { lastCaseId, awaitingReport, updatedAt: sql`now()` } })
  }

  async function getState(phone: string) {
    const [row] = await db.select().from(botState).where(eq(botState.phone, phone))
    return row
  }

  async function reply(to: string, body: string) {
    await wa.sendText(to, body)
  }

  async function sendVoice(to: string, text: string) {
    if (!speech) return
    try {
      await wa.sendAudio(to, await speech.speak(text.slice(0, 600), 'ogg'), 'audio/ogg')
    } catch (err) {
      // La voz es un extra: si falla, la persona ya tiene la respuesta escrita.
      console.error('No se pudo enviar la nota de voz:', err instanceof Error ? err.message : 'desconocido')
    }
  }

  // Responde y lo anota en la memoria de la persona.
  async function say(userId: number, phone: string, body: string) {
    await reply(phone, body)
    await memory.add(userId, 'whatsapp', 'assistant', body)
  }

  async function showAnalysis(userId: number, phone: string, r: AnalysisResult, withVoice: boolean) {
    await say(userId, phone, formatVerdict(r))
    await assistant.setLastCase(userId, r.caseId, r.offerReport)
    if (withVoice) await sendVoice(phone, `${LEVEL_LABEL[r.level]}. ${r.summary} ${r.advice[0] ?? ''}`)
  }

  async function makeReport(userId: number, phone: string, caseId: number) {
    // Armar el reporte tarda unos segundos (relato con IA, PDF, subida): se avisa de inmediato.
    await reply(phone, 'Armando tu reporte… ⏳ en unos segundos te lo envío.')
    const created = await reports.create(userId, { caseId })
    const { buffer, code } = await reports.pdf(userId, created.id)
    await wa.sendDocument(phone, buffer, `reporte-${code}.pdf`, `Reporte ${code}`)
    await say(
      userId,
      phone,
      `Listo ✅ Aquí está tu reporte. Llévalo a tu banco, a ADenunciar o a la Fiscalía: es un soporte, no la denuncia en sí.\nVerifícalo en ${site}/certificado/${code}`,
    )
    await setState(phone, caseId, false)
  }

  const publish = async (userId: number, phone: string) => say(userId, phone, await assistant.publish(userId))

  const saldo = async (userId: number, phone: string) =>
    say(userId, phone, `Tienes *${await getBalance(db, userId)} créditos*. Puedes recargar en ${site}/app/creditos`)

  /** Conversación: el asistente compartido entiende la intención y decide (hablar, analizar, publicar, reporte, saldo). */
  async function converse(userId: number, phone: string, text: string, fromVoice: boolean) {
    const out = await assistant.decide(userId, 'whatsapp', text, fromVoice)
    // Siempre se responde por escrito, aunque haya llegado un audio: para hablar están las llamadas.
    if (out.kind === 'analysis') return showAnalysis(userId, phone, out.result, false)
    if (out.kind === 'publish') return publish(userId, phone)
    if (out.kind === 'balance') return saldo(userId, phone)
    if (out.kind === 'report') {
      if (!out.caseId) return say(userId, phone, 'Primero mándame algo sospechoso para revisarlo y luego te armo el reporte.')
      return makeReport(userId, phone, out.caseId)
    }
    await say(userId, phone, out.text)
  }

  async function handleText(userId: number, phone: string, text: string, fromVoice = false) {
    await memory.add(userId, 'whatsapp', 'user', fromVoice ? `[Nota de voz] ${text}` : text)
    // Atajos exactos que el bot mismo ofrece (*SÍ*, *PUBLICAR*, *saldo*...): rápidos y sin gastar IA.
    const t = norm(text)
    if (/^(saldo|creditos|mis creditos)$/.test(t)) return saldo(userId, phone)
    if (/^(ayuda|menu|help)$/.test(t)) return say(userId, phone, HELP)

    const state = await getState(phone)
    if (/^(publicar|publicalo|alertar|avisar)$/.test(t)) return publish(userId, phone)
    // "¿Puedes publicar el mensaje en la app para que le salga a otros?": pedir publicar nunca es un mensaje a revisar.
    // Solo si hay un caso para publicar y el texto no trae enlaces ni números (eso sería un mensaje para revisar).
    if (state?.lastCaseId && t.length < 220 && !/[a-z0-9-]+\.[a-z]{2,}|\d{7,}/.test(t) && /\b(public(a|ar|alo|arlo|ame|amelo|ues|que)|avis(a|ar|ale|arle)s? a (mis|los|tus) vecinos|alert(a|ar) a (mis|los) vecinos|sub(e|ir|elo)(lo)? (a|en) (la )?(app|red|plataforma))\b/.test(t)) {
      return publish(userId, phone)
    }
    if (/^(voz|audio|leeme|escuchar)$/.test(t)) {
      if (!state?.lastCaseId) return say(userId, phone, 'Aún no tengo nada para leerte. Mándame primero algo sospechoso.')
      const [c] = await db.select().from(cases).where(eq(cases.id, state.lastCaseId))
      if (c) await sendVoice(phone, `${c.summary} ${(c.advice as string[])[0] ?? ''}`)
      return
    }
    if (/^(si|sii|dale|claro|armalo|hazlo|quiero)[.!]*$/.test(t) && state?.awaitingReport && state.lastCaseId) {
      return makeReport(userId, phone, state.lastCaseId)
    }
    if (/^(no|nada|no gracias)[.!]*$/.test(t) && state?.awaitingReport) {
      await setState(phone, state.lastCaseId, false)
      return say(userId, phone, 'Está bien. Si cambias de opinión, escríbeme *reporte*.')
    }
    if (/^reporte$/.test(t) && state?.lastCaseId) return makeReport(userId, phone, state.lastCaseId)

    return converse(userId, phone, text, fromVoice)
  }

  async function dispatch(userId: number, msg: Incoming) {
    if (msg.type === 'text' && msg.text) return handleText(userId, msg.from, msg.text)
    if ((msg.type === 'audio' || msg.type === 'image') && msg.mediaId) {
      const media = await wa.downloadMedia(msg.mediaId)
      if (msg.type === 'audio') {
        // La nota de voz se trata como si la persona lo hubiera escrito: puede ser una pregunta, no solo un mensaje a revisar.
        return handleText(userId, msg.from, await intake.transcribe(userId, media.data, media.mime), true)
      }
      const r = await intake.fromImage(userId, media.data)
      await memory.add(userId, 'whatsapp', 'user', `[Captura de pantalla] ${r.extractedText}`)

      return showAnalysis(userId, msg.from, r, false)
    }
    return reply(msg.from, 'Envíame un texto, un audio o una captura de pantalla y te ayudo a revisarlo 🙂')
  }

  return {
    HELP,
    async handle(msg: Incoming) {
      // Meta reintenta los avisos que no confirma a tiempo. Un mensaje terminado no se repite; uno "en curso"
      // tampoco (otra petición lo está atendiendo); pero si quedó a medias hace rato (el servidor se cortó),
      // el reintento sí lo vuelve a procesar.
      const fresh = await db.insert(waMessages).values({ id: msg.id }).onConflictDoNothing().returning({ id: waMessages.id })
      if (fresh.length === 0) {
        const taken = await db
          .update(waMessages)
          .set({ createdAt: sql`now()` })
          .where(and(eq(waMessages.id, msg.id), eq(waMessages.done, false), sql`${waMessages.createdAt} < now() - interval '90 seconds'`))
          .returning({ id: waMessages.id })
        if (taken.length === 0) return
      }
      await this.process(msg)
      await db.update(waMessages).set({ done: true }).where(eq(waMessages.id, msg.id))
    },

    async process(msg: Incoming) {
      const [user] = await db.select().from(users).where(eq(users.phone, msg.from))
      if (!user || !user.phoneVerifiedAt) {
        try {
          await hit(db, `wa:unregistered:${msg.from}`, 2, 3600, '')
          await reply(msg.from, `Hola 👋 Para usar La Segura primero crea tu cuenta gratis en ${site} con este mismo número. Te regalamos 200 créditos.`)
        } catch {
          /* demasiados mensajes de un número sin cuenta: se ignora en silencio */
        }
        return
      }

      try {
        await hit(db, `wa:user:${user.id}`, 20, 60, '')
        await dispatch(user.id, msg)
      } catch (err) {
        if (err instanceof AppError && err.status === 402) {
          return say(user.id, msg.from, `Te quedaste sin créditos 😕 Puedes recargar en ${site}/app/creditos`)
        }
        if (err instanceof AppError && err.status === 429) return reply(msg.from, 'Vas muy rápido. Espera un momento y vuelve a escribirme.')
        if (err instanceof AppError && err.status < 500) return say(user.id, msg.from, err.message)
        console.error('Error del bot:', err instanceof Error ? err.message : 'desconocido')
        await reply(msg.from, 'Tuve un problema para revisar eso. Intenta de nuevo en un momento.')
      } finally {
        void memory.compact(user.id)
      }
    },
  }
}

export type BotService = ReturnType<typeof createBotService>
