import { sql } from 'drizzle-orm'
import { loadConfig } from '../src/config.ts'
import { createDb } from '../src/db/client.ts'
import { FakeChecks } from '../src/gateways/checks.ts'
import { FakeLlm } from '../src/gateways/llm.ts'
import { FakeOcr } from '../src/gateways/ocr.ts'
import { FakePayments } from '../src/gateways/payments.ts'
import { FakeSpeech } from '../src/gateways/speech.ts'
import { FakeWhatsapp } from '../src/gateways/whatsapp.ts'
import { buildServer } from '../src/server.ts'

export async function createTestApp() {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    JWT_SECRET: process.env.JWT_SECRET,
    MERCADOPAGO_WEBHOOK_SECRET: 'secreto-de-prueba-mp',
    WHATSAPP_APP_SECRET: 'app-secret-de-prueba',
    WHATSAPP_VERIFY_TOKEN: 'verify-de-prueba',
    TERRITORY_CACHE_SEC: '0',
    VOICE_INTERNAL_KEY: 'clave-interna-de-prueba-123456',
    WHATSAPP_PHONE_NUMBER_ID: '999',
  })
  const { db, pool } = createDb(config.DATABASE_URL)
  const whatsapp = new FakeWhatsapp()
  const llm = new FakeLlm()
  const checks = new FakeChecks()
  const speech = new FakeSpeech()
  const ocr = new FakeOcr()
  const payments = new FakePayments()
  const app = await buildServer({ config, db, whatsapp, llm, checks, speech, ocr, payments })
  const reset = () =>
    db.transaction(async (tx) => {
      // Los TRUNCATE sobre el registro están bloqueados a propósito; en pruebas se limpian sin disparar triggers.
      await tx.execute(sql`SET LOCAL session_replication_role = replica`)
      await tx.execute(sql`TRUNCATE wa_messages, bot_state, users, rate_limits, credit_ledger, credit_accounts, otp_codes, cases, indicators, reports, ledger_entries, posts, post_confirmations, purchases RESTART IDENTITY CASCADE`)
    })
  const close = async () => {
    await app.close()
    await pool.end()
  }
  return { app, db, whatsapp, llm, checks, speech, ocr, payments, reset, close }
}

export const PHONE = '3000000001'
export const PHONE_FULL = '573000000001'
export const body = { name: 'María Pérez', phone: PHONE, password: 'clave-segura-1', municipalityCode: '05001' }
