import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { buildServer } from '../src/server.ts'
import { isMetaMediaUrl } from '../src/gateways/whatsapp.ts'
import { createTestApp } from './helpers.ts'

// Pruebas de regresión de los hallazgos de la auditoría de seguridad (docs/SECURITY_AUDIT.md).
const ctx = await createTestApp()
const { app, whatsapp, llm, db } = ctx

const post = (url: string, payload: object, remoteAddress: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload, remoteAddress, headers })
const base = { name: 'Víctima', phone: '3001112233', password: 'clave-de-la-victima', municipalityCode: '05001' }

let ip = 0
async function signup(phone: string) {
  const remoteAddress = `10.7.0.${++ip}`
  await post('/api/auth/register', { ...base, phone }, remoteAddress)
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code }, remoteAddress)
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}

beforeEach(async () => {
  whatsapp.reset()
  llm.next = { risk: 'alto', confidence: 85, fraudType: 'suplantacion_entidad', summary: 'Estafa.', reasons: [], advice: [] }
  llm.calls.length = 0
  await ctx.reset()
})
afterAll(ctx.close)

describe('A-01: no se puede secuestrar el registro de un celular ajeno', () => {
  it('un segundo registro bloqueado por el límite NO cambia la contraseña ni invalida el código de la víctima', async () => {
    expect((await post('/api/auth/register', base, '10.8.0.1')).statusCode).toBe(202)
    const victimCode = whatsapp.sent.at(-1)!.code

    const attack = await post('/api/auth/register', { ...base, name: 'Atacante', password: 'clave-del-atacante' }, '10.8.0.2')
    expect(attack.statusCode).toBe(429)

    const verify = await post('/api/auth/verify', { phone: base.phone, code: victimCode }, '10.8.0.1')
    expect(verify.statusCode).toBe(200)
    expect(verify.json().name).toBe('Víctima')
    expect((await post('/api/auth/login', { phone: base.phone, password: 'clave-del-atacante' }, '10.8.0.2')).statusCode).toBe(401)
    expect((await post('/api/auth/login', { phone: base.phone, password: base.password }, '10.8.0.1')).statusCode).toBe(200)
  })
})

describe('A-02: la IP no se puede falsificar con X-Forwarded-For', () => {
  it('cambiar el encabezado en cada petición no evita el límite de 4 códigos por IP', async () => {
    const codes: number[] = []
    for (const [i, phone] of ['3001110001', '3001110002', '3001110003', '3001110004', '3001110005', '3001110006'].entries()) {
      const res = await post('/api/auth/register', { ...base, phone }, '10.9.0.1', { 'x-forwarded-for': `203.0.113.${i + 1}` })
      codes.push(res.statusCode)
    }
    expect(codes).toEqual([202, 202, 202, 202, 429, 429])
  })

  it('TRUST_PROXY es un número de saltos y por defecto no se confía en ninguno', () => {
    const cfg = loadConfig({ JWT_SECRET: 'x'.repeat(32) } as NodeJS.ProcessEnv)
    expect(cfg.TRUST_PROXY).toBe(0)
    expect(loadConfig({ JWT_SECRET: 'x'.repeat(32), TRUST_PROXY: '1' } as NodeJS.ProcessEnv).TRUST_PROXY).toBe(1)
    expect(() => loadConfig({ JWT_SECRET: 'x'.repeat(32), TRUST_PROXY: 'true' } as NodeJS.ProcessEnv)).toThrow()
  })
})

describe('A-03: la reputación no se envenena con sitios inocentes', () => {
  it('tres personas "reportando" un dominio sin señales objetivas no lo marcan como peligroso', async () => {
    const cookies = await Promise.all(['3001110001', '3001110002', '3001110003', '3001110004'].map(signup))
    for (const c of cookies.slice(0, 3)) {
      await app.inject({ method: 'POST', url: '/api/analyze', cookies: { ps_session: c }, payload: { text: 'urgente, tu cuenta será bloqueada, escríbeme en https://tienda-de-fulano.com' } })
    }
    const res = await app.inject({ method: 'GET', url: '/api/lookup?q=tienda-de-fulano.com', cookies: { ps_session: cookies[3]! } })
    expect(res.json()).toMatchObject({ level: 'sin_reportes', reporters: 0 })
    expect(await db.query.indicators.findMany()).toHaveLength(0)
  })
})

describe('tope de registros (control de costo de WhatsApp)', () => {
  it('con el cupo lleno (cuentas verificadas), un celular nuevo no puede registrarse pero uno existente sí puede reintentar', async () => {
    const cfg = loadConfig({ NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET, SIGNUP_CAP: '2' } as NodeJS.ProcessEnv)
    const capped = await buildServer({ config: cfg, db, whatsapp, llm, checks: ctx.checks, speech: ctx.speech, ocr: ctx.ocr, payments: ctx.payments })
    const reg = (phone: string, ipAddr: string) => capped.inject({ method: 'POST', url: '/api/auth/register', remoteAddress: ipAddr, payload: { ...base, phone } })
    expect((await reg('3001110001', '10.20.0.1')).statusCode).toBe(202)
    expect((await reg('3001110002', '10.20.0.2')).statusCode).toBe(202)
    expect((await reg('3001110003', '10.20.0.3')).statusCode).toBe(202) // sin verificar: no ocupa cupo
    // El cupo cuenta solo cuentas verificadas (un número mal escrito no ocupa cupo).
    await db.execute(sql`UPDATE users SET phone_verified_at = now() WHERE phone IN ('573001110001', '573001110002')`)
    const full = await reg('3001110004', '10.20.0.4')
    expect(full.statusCode).toBe(403)
    expect(full.json().error).toBe('signup_cap_reached')
    expect(whatsapp.sent).toHaveLength(3) // el bloqueado no costó ningún mensaje
    await db.execute(sql`DELETE FROM rate_limits`)
    expect((await reg('3001110003', '10.20.0.5')).statusCode).toBe(202) // ya existía sin verificar: puede reintentar
    await capped.close()
  })
})

describe('A-05: el cobro va primero, no se gasta IA sin saldo', () => {
  it('15 análisis en paralelo con 1 crédito hacen una sola llamada a la IA', async () => {
    const cookie = await signup('3001112233')
    await db.execute(sql`UPDATE credit_accounts SET balance = 1`)
    const results = await Promise.all(
      Array.from({ length: 15 }, () => app.inject({ method: 'POST', url: '/api/analyze', cookies: { ps_session: cookie }, payload: { text: 'mensaje sospechoso urgente https://bancolombia-seguro.xyz' } })),
    )
    const statuses = results.map((r) => r.statusCode)
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 402)).toHaveLength(14)
    expect(llm.calls).toHaveLength(1)
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { ps_session: cookie } })).json().credits).toBe(0)
  })

  it('si la IA falla se reembolsa y el libro queda cuadrado con el saldo', async () => {
    const cookie = await signup('3001112233')
    llm.next = new Error('caído')
    const res = await app.inject({ method: 'POST', url: '/api/analyze', cookies: { ps_session: cookie }, payload: { text: 'mensaje sospechoso urgente' } })
    expect(res.json().creditsLeft).toBe(200)
    const [row] = (await db.execute(sql`SELECT coalesce(sum(delta), 0)::int AS total FROM credit_ledger`)).rows as Array<{ total: number }>
    expect(row!.total).toBe(200)
  })
})

describe('A-06: el registro no se puede vaciar', () => {
  it('TRUNCATE sobre reportes y entradas está bloqueado', async () => {
    await expect(db.execute(sql`TRUNCATE ledger_entries`)).rejects.toThrow()
    await expect(db.execute(sql`TRUNCATE reports CASCADE`)).rejects.toThrow()
  })
})

describe('A-12 y A-14: hosts de medios y configuración de producción', () => {
  it('solo se aceptan hosts reales de Meta para descargar medios', () => {
    expect(isMetaMediaUrl('https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1')).toBe(true)
    expect(isMetaMediaUrl('https://scontent.xx.fbcdn.net/v/abc')).toBe(true)
    for (const bad of ['https://evilfbcdn.net/x', 'https://evil-facebook.com/x', 'http://scontent.fbcdn.net/x', 'https://fbcdn.net.evil.com/x', 'no es url']) {
      expect(isMetaMediaUrl(bad)).toBe(false)
    }
  })

  it('en producción faltan variables obligatorias => no arranca', () => {
    const env = { JWT_SECRET: 'x'.repeat(32), NODE_ENV: 'production', WHATSAPP_SEND_MODE: 'live' } as NodeJS.ProcessEnv
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/)
    expect(loadConfig({ ...env, DATABASE_URL: 'postgres://x', WEB_ORIGIN: 'https://a.co', PUBLIC_BASE_URL: 'https://a.co' } as NodeJS.ProcessEnv).NODE_ENV).toBe('production')
  })
})
