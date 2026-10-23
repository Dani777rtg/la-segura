import { loadConfig } from './config.ts'
import { createDb } from './db/client.ts'
import { createOpenChecks } from './gateways/checks.ts'
import { createLlm } from './gateways/llm.ts'
import { createOcr } from './gateways/ocr.ts'
import { createPayments } from './gateways/payments.ts'
import { createSpeech } from './gateways/speech.ts'
import { createWhatsapp } from './gateways/whatsapp.ts'
import { buildServer } from './server.ts'

const config = loadConfig()
const { db, pool } = createDb(config.DATABASE_URL)
const app = await buildServer({
  config,
  db,
  whatsapp: createWhatsapp(config),
  llm: createLlm(config),
  checks: createOpenChecks(),
  speech: createSpeech(config),
  ocr: createOcr(),
  payments: createPayments(config),
})

const shutdown = async () => {
  await app.close()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await app.listen({ port: config.PORT, host: '0.0.0.0' })
