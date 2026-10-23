import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { COST } from '../credits/costs.ts'
import type { IntakeService } from './intake.ts'
import type { AgentService } from './service.ts'

const analyzeBody = z.object({ text: z.string().trim().min(1).max(4000) })
const speakBody = z.object({ text: z.string().trim().min(1).max(600) })

const MEDIA_LIMIT = 6 * 1024 * 1024

export function agentRoutes(app: FastifyInstance, agent: AgentService, intake: IntakeService) {
  // Audio e imágenes llegan como cuerpo binario (no multipart): más simple y sin dependencias.
  app.addContentTypeParser(/^(audio|image)\/.+/, { parseAs: 'buffer', bodyLimit: MEDIA_LIMIT }, (_req, body, done) => done(null, body))

  const auth = { preHandler: app.requireUser }

  app.post('/analyze', auth, async (req) => {
    const { text } = analyzeBody.parse(req.body)
    return agent.analyze(req.userId!, text, { cost: COST.analyzeText, channel: 'web' })
  })

  app.post('/analyze/audio', { ...auth, bodyLimit: MEDIA_LIMIT }, async (req) =>
    intake.fromAudio(req.userId!, req.body as Buffer, req.headers['content-type'] ?? 'audio/webm'),
  )

  app.post('/analyze/image', { ...auth, bodyLimit: MEDIA_LIMIT }, async (req) =>
    intake.fromImage(req.userId!, req.body as Buffer),
  )

  app.post('/voice/speak', auth, async (req, reply) => {
    const { text } = speakBody.parse(req.body)
    const audio = await intake.speak(req.userId!, text)
    return reply.header('Content-Type', 'audio/mpeg').header('Cache-Control', 'no-store').send(audio)
  })
}
