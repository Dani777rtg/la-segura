import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import type { Config } from './config.ts'
import type { Db } from './db/client.ts'
import type { OpenChecks } from './gateways/checks.ts'
import type { LlmGateway } from './gateways/llm.ts'
import type { OcrGateway } from './gateways/ocr.ts'
import type { PaymentsGateway } from './gateways/payments.ts'
import type { SpeechGateway } from './gateways/speech.ts'
import type { WhatsappGateway } from './gateways/whatsapp.ts'
import { AppError } from './lib/errors.ts'
import { agentRoutes } from './modules/agent/routes.ts'
import { createIntakeService } from './modules/agent/intake.ts'
import { createAgentService } from './modules/agent/service.ts'
import { certificatePageRoute, reportRoutes } from './modules/reports/routes.ts'
import { botRoutes } from './modules/bot/routes.ts'
import { createBotService } from './modules/bot/service.ts'
import { voiceRoutes } from './modules/voice/routes.ts'
import { createVoiceBridge } from './modules/voice/service.ts'
import { createMemory } from './modules/memory/service.ts'
import { createAssistant } from './modules/assistant/service.ts'
import { assistantRoutes } from './modules/assistant/routes.ts'
import { presentationRoutes } from './modules/presentation/routes.ts'
import { creditsRoutes } from './modules/credits/routes.ts'
import { createCreditsService } from './modules/credits/service.ts'
import { createReportService } from './modules/reports/service.ts'
import { feedRoutes } from './modules/feed/routes.ts'
import { createFeedService } from './modules/feed/service.ts'
import { lookupRoutes } from './modules/lookup/routes.ts'
import { createLookupService } from './modules/lookup/service.ts'
import { territoryRoutes } from './modules/territory/routes.ts'
import { createTerritoryService } from './modules/territory/service.ts'
import { authRoutes } from './modules/auth/routes.ts'
import { createAuthService } from './modules/auth/service.ts'
import { locationRoutes } from './modules/locations/routes.ts'
import { sessionPlugin } from './plugins/session.ts'
import { webAppPlugin } from './plugins/webapp.ts'

export type Deps = {
  config: Config
  db: Db
  whatsapp: WhatsappGateway
  llm: LlmGateway | null
  checks: OpenChecks
  speech: SpeechGateway | null
  ocr: OcrGateway
  payments: PaymentsGateway | null
}

export async function buildServer({ config, db, whatsapp, llm, checks, speech, ocr, payments }: Deps) {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            redact: ['req.headers.cookie', 'req.headers.authorization'],
            // La query puede traer tokens (hub.verify_token, payment_id): no se registra.
            serializers: { req: (r) => ({ method: r.method, url: r.url?.split('?')[0], host: r.host }) },
          },
    // Solo se confía en los N proxies más cercanos (hop < N): el resto de X-Forwarded-For lo controla el cliente.
    trustProxy: config.TRUST_PROXY > 0 ? (_addr: string, hop: number) => hop < config.TRUST_PROXY : false,
    bodyLimit: 1_000_000,
  })

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Leaflet y React aplican estilos en línea; los scripts siguen siendo solo propios.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.NODE_ENV === 'production' ? [] : null,
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
  // Micrófono y cámara solo para esta misma página (voz y capturas); nada de geolocalización ni pagos del navegador.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Permissions-Policy', 'microphone=(self), camera=(self), geolocation=(), payment=()')
  })
  // ponytail: límite general en memoria por instancia; los límites sensibles (códigos, login) van en Postgres.
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' })
  await sessionPlugin(app, config)

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', message: 'Datos inválidos', details: err.issues })
    }
    if (err instanceof AppError) {
      if (err.status === 429 && typeof err.extra?.retryAfterSec === 'number') {
        reply.header('Retry-After', err.extra.retryAfterSec)
      }
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra })
    }
    const status = (err as { statusCode?: number }).statusCode
    if (status && status < 500) return reply.code(status).send({ error: 'bad_request', message: 'Solicitud inválida' })
    req.log.error(err)
    return reply.code(500).send({ error: 'internal_error', message: 'Ocurrió un error. Intenta de nuevo' })
  })

  app.get('/api/health', async () => ({ ok: true }))

  const reports = createReportService({ db, llm, config })
  await app.register(
    async (api) => {
      locationRoutes(api, db)
      presentationRoutes(api, db, config)
      authRoutes(api, db, createAuthService({ db, whatsapp, config }))
      const agent = createAgentService({ db, llm, checks, config })
      const intake = createIntakeService({ db, agent, speech, ocr })
      agentRoutes(api, agent, intake)
      reportRoutes(api, db, reports)
      const feed = createFeedService({ db, llm })
      const memory = createMemory(db, llm)
      const assistant = createAssistant({ db, llm, agent, feed, memory })
      assistantRoutes(api, db, assistant, memory, intake)
      voiceRoutes(api, createVoiceBridge({ db, agent, feed, reports, wa: whatsapp, memory, site: config.PUBLIC_BASE_URL }), config, db)
      botRoutes(api, createBotService({ db, wa: whatsapp, agent, intake, reports, feed, speech, memory, assistant, config }), config)
      creditsRoutes(api, createCreditsService(db, payments, config), config)
      feedRoutes(api, feed)
      lookupRoutes(api, createLookupService(db, checks, config))
      territoryRoutes(api, createTerritoryService(db, config.MIN_CELL, config.TERRITORY_CACHE_SEC))
    },
    { prefix: '/api' },
  )
  certificatePageRoute(app, db, reports)
  if (config.NODE_ENV !== 'test') await webAppPlugin(app)

  return app
}
