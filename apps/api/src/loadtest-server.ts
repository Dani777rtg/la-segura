// SERVIDOR SOLO PARA PRUEBAS DE CARGA LOCALES. No carga .env. Todos los gateways son simulados.
// Uso (desde apps/api):  LOAD_DATABASE_URL=postgres://parcero:parcero_dev_only@127.0.0.1:15432/parcero_load \
//   LOAD_PORT=3100 node --import tsx src/loadtest-server.ts
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { loadConfig } from './config.ts'
import { createDb } from './db/client.ts'
import { FakeChecks } from './gateways/checks.ts'
import { FakeLlm, type LlmInput } from './gateways/llm.ts'
import { FakeOcr } from './gateways/ocr.ts'
import { FakePayments } from './gateways/payments.ts'
import { FakeSpeech } from './gateways/speech.ts'
import { FakeWhatsapp } from './gateways/whatsapp.ts'
import { buildServer } from './server.ts'

export const LOAD_JWT_SECRET = 'jwt-secret-solo-para-pruebas-de-carga-locales-0123456789'

const databaseUrl = process.env.LOAD_DATABASE_URL ?? 'postgres://parcero:parcero_dev_only@127.0.0.1:15432/parcero_load'
const url = new URL(databaseUrl)
if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname) || url.pathname !== '/parcero_load') {
  console.error(`ABORTADO: la BD debe ser localhost/127.0.0.1 y llamarse parcero_load (recibido ${url.hostname}${url.pathname})`)
  process.exit(1)
}

// FakeLlm sin el arreglo `calls` que crece sin límite (artefacto del doble de pruebas, no de la API).
class LoadLlm extends FakeLlm {
  override async classify(_input: LlmInput) {
    return this.next as Exclude<FakeLlm['next'], Error>
  }
}

// NODE_ENV=development: loadConfig prohíbe WHATSAPP_SEND_MODE=fake en production; resto de la config es la de producción.
const config = loadConfig({
  NODE_ENV: 'development',
  PORT: process.env.LOAD_PORT ?? '3100',
  DATABASE_URL: databaseUrl,
  JWT_SECRET: LOAD_JWT_SECRET,
  WHATSAPP_SEND_MODE: 'fake',
  TRUST_PROXY: '1', // como detrás de Cloud Run (1 salto): el límite por IP usa X-Forwarded-For; k6 envía una IP por VU
  MERCADOPAGO_WEBHOOK_SECRET: 'secreto-de-prueba-mp',
  WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
  WHATSAPP_VERIFY_TOKEN: 'verify-de-prueba',
  WHATSAPP_PHONE_NUMBER_ID: '999',
})
const { db, pool } = createDb(config.DATABASE_URL)
const app = await buildServer({
  config,
  db,
  whatsapp: new FakeWhatsapp(false),
  llm: new LoadLlm(),
  checks: new FakeChecks(),
  speech: new FakeSpeech(),
  ocr: new FakeOcr(),
  payments: new FakePayments(),
})

// Métricas del proceso para el informe (event loop, memoria, pool de pg).
const loop = monitorEventLoopDelay({ resolution: 10 })
loop.enable()
let lastCpu = process.cpuUsage()
let lastT = Date.now()
app.get('/__load/metrics', async () => {
  const now = Date.now()
  const cpu = process.cpuUsage(lastCpu)
  const cpuPct = ((cpu.user + cpu.system) / 1000 / (now - lastT)) * 100
  lastCpu = process.cpuUsage()
  lastT = now
  const out = {
    pid: process.pid,
    cpuPct: Math.round(cpuPct),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    heapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
    loopP50ms: loop.percentile(50) / 1e6,
    loopP99ms: loop.percentile(99) / 1e6,
    loopMaxMs: loop.max / 1e6,
    pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
  }
  loop.reset()
  return out
})

const shutdown = async () => {
  await app.close()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

const host = process.env.LOAD_HOST ?? '127.0.0.1'
if (!host.startsWith('127.') && host !== '::1') {
  console.error('ABORTADO: LOAD_HOST debe ser una dirección de loopback')
  process.exit(1)
}
await app.listen({ port: config.PORT, host })
