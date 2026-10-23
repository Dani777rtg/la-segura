import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, llm, db } = ctx

let ip = 0
async function signup(phone: string, name = 'Ana Gómez') {
  const remoteAddress = `10.3.0.${++ip}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress })
  await post('/api/auth/register', { name, phone, password: 'clave-segura-1', municipalityCode: '05001' })
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}
const authed = (cookie: string) => ({ ps_session: cookie })
async function newCase(cookie: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/analyze',
    cookies: authed(cookie),
    payload: { text: 'Bancolombia: confirma tu clave en https://bancolombia-seguro.xyz o llama al 300 000 0001' },
  })
  return res.json().caseId as number
}
const createReport = (cookie: string, payload: object) =>
  app.inject({ method: 'POST', url: '/api/reports', cookies: authed(cookie), payload })
const credits = async (cookie: string) =>
  (await app.inject({ method: 'GET', url: '/api/auth/me', cookies: authed(cookie) })).json().credits

beforeEach(async () => {
  whatsapp.reset()
  llm.narration = 'Yo, Ana Gómez, reporto un intento de fraude.'
  await ctx.reset()
})
afterAll(ctx.close)

describe('crear reporte', () => {
  it('cobra 5 créditos y devuelve un código; pedirlo otra vez no cobra de nuevo', async () => {
    const cookie = await signup('3001112233')
    const caseId = await newCase(cookie)
    const first = await createReport(cookie, { caseId, amountCop: 50000, channel: 'WhatsApp' })
    expect(first.statusCode).toBe(201)
    expect(first.json().code).toMatch(/^PS-[A-Z0-9]{5}-[A-Z0-9]{5}$/)
    expect(await credits(cookie)).toBe(200 - 1 - 5)
    const again = await createReport(cookie, { caseId })
    expect(again.statusCode).toBe(200)
    expect(again.json().code).toBe(first.json().code)
    expect(await credits(cookie)).toBe(194)
  })

  it('no se puede reportar el caso de otra persona', async () => {
    const a = await signup('3001112233')
    const b = await signup('3004445566')
    const caseId = await newCase(a)
    expect((await createReport(b, { caseId })).statusCode).toBe(404)
  })

  it('sin créditos responde 402 y no crea nada', async () => {
    const cookie = await signup('3001112233')
    const caseId = await newCase(cookie)
    await db.execute(sql`UPDATE credit_accounts SET balance = 2`)
    expect((await createReport(cookie, { caseId })).statusCode).toBe(402)
    expect(await db.query.reports.findMany()).toHaveLength(0)
  })

  it('valida los datos (fecha futura, monto negativo)', async () => {
    const cookie = await signup('3001112233')
    const caseId = await newCase(cookie)
    expect((await createReport(cookie, { caseId, occurredAt: '2999-01-01' })).statusCode).toBe(400)
    expect((await createReport(cookie, { caseId, amountCop: -5 })).statusCode).toBe(400)
  })

  it('si la IA falla igual genera el reporte con un relato base', async () => {
    llm.narration = new Error('caído')
    const cookie = await signup('3001112233')
    const caseId = await newCase(cookie)
    expect((await createReport(cookie, { caseId })).statusCode).toBe(201)
    expect((await db.query.reports.findMany())[0]!.payload).toContain('Yo, Ana Gómez, reporto')
  })
})

describe('PDF', () => {
  it('lo descarga solo su dueño y es un PDF real', async () => {
    const a = await signup('3001112233')
    const b = await signup('3004445566')
    const { id } = (await createReport(a, { caseId: await newCase(a) })).json()
    const ok = await app.inject({ method: 'GET', url: `/api/reports/${id}/pdf`, cookies: authed(a) })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toBe('application/pdf')
    expect(ok.rawPayload.subarray(0, 5).toString()).toBe('%PDF-')
    expect(ok.rawPayload.length).toBeGreaterThan(3000)
    expect((await app.inject({ method: 'GET', url: `/api/reports/${id}/pdf`, cookies: authed(b) })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/api/reports/${id}/pdf` })).statusCode).toBe(401)
  })
})

describe('registro inmutable', () => {
  it('encadena las entradas: el anterior de cada una es el hash de la previa', async () => {
    const a = await signup('3001112233')
    const b = await signup('3004445566')
    await createReport(a, { caseId: await newCase(a) })
    await createReport(b, { caseId: await newCase(b) })
    const entries = await db.query.ledgerEntries.findMany({ orderBy: (t, { asc }) => asc(t.idx) })
    expect(entries.map((e) => e.idx)).toEqual([1, 2])
    expect(entries[0]!.prevHash).toBe('0'.repeat(64))
    expect(entries[1]!.prevHash).toBe(entries[0]!.entryHash)
  })

  it('reportes simultáneos no rompen la cadena', async () => {
    const cookies = await Promise.all(['3001110001', '3001110002', '3001110003', '3001110004'].map((p) => signup(p)))
    const caseIds = await Promise.all(cookies.map(newCase))
    const results = await Promise.all(cookies.map((c, i) => createReport(c, { caseId: caseIds[i]! })))
    expect(results.every((r) => r.statusCode === 201)).toBe(true)
    const code = results[0]!.json().code
    const verify = await app.inject({ method: 'GET', url: `/api/verify/${code}` })
    expect(verify.json().verification).toMatchObject({ valid: true, totalEntries: 4 })
  })

  it('la base de datos rechaza editar o borrar reportes y entradas', async () => {
    const cookie = await signup('3001112233')
    await createReport(cookie, { caseId: await newCase(cookie) })
    await expect(db.execute(sql`UPDATE reports SET type = 'generico'`)).rejects.toThrow()
    await expect(db.execute(sql`DELETE FROM reports`)).rejects.toThrow()
    await expect(db.execute(sql`UPDATE ledger_entries SET entry_hash = 'x'`)).rejects.toThrow()
    await expect(db.execute(sql`DELETE FROM ledger_entries`)).rejects.toThrow()
  })

  it('si alguien con acceso total a la BD manipula un reporte, la verificación lo detecta', async () => {
    const cookie = await signup('3001112233')
    const { code } = (await createReport(cookie, { caseId: await newCase(cookie) })).json()
    expect((await app.inject({ method: 'GET', url: `/api/verify/${code}` })).json().verification.valid).toBe(true)

    await db.execute(sql`ALTER TABLE reports DISABLE TRIGGER reports_no_update_delete`)
    await db.execute(sql`UPDATE reports SET payload = replace(payload, 'Ana', 'Pedro')`)
    await db.execute(sql`ALTER TABLE reports ENABLE TRIGGER reports_no_update_delete`)

    const after = await app.inject({ method: 'GET', url: `/api/verify/${code}` })
    expect(after.json().verification.valid).toBe(false)
    expect(after.json().verification.problem).toContain('no coincide')
  })

  it('si se altera un eslabón de la cadena también se detecta', async () => {
    const a = await signup('3001112233')
    const b = await signup('3004445566')
    await createReport(a, { caseId: await newCase(a) })
    const { code } = (await createReport(b, { caseId: await newCase(b) })).json()
    await db.execute(sql`ALTER TABLE ledger_entries DISABLE TRIGGER ledger_entries_no_update_delete`)
    await db.execute(sql`UPDATE ledger_entries SET payload_hash = repeat('a', 64) WHERE idx = 1`)
    await db.execute(sql`ALTER TABLE ledger_entries ENABLE TRIGGER ledger_entries_no_update_delete`)
    const res = await app.inject({ method: 'GET', url: `/api/verify/${code}` })
    expect(res.json().verification.valid).toBe(false)
  })
})

describe('verificación pública', () => {
  it('no expone nombre, relato ni números', async () => {
    const cookie = await signup('3001112233')
    const { code } = (await createReport(cookie, { caseId: await newCase(cookie), details: 'detalle secreto' })).json()
    const json = await app.inject({ method: 'GET', url: `/api/verify/${code}` })
    expect(json.statusCode).toBe(200)
    for (const secret of ['Ana', 'Gómez', '3000000001', 'detalle secreto', 'reporto un intento']) {
      expect(json.body).not.toContain(secret)
    }
    const html = await app.inject({ method: 'GET', url: `/certificado/${code}` })
    expect(html.statusCode).toBe(200)
    expect(html.headers['content-type']).toContain('text/html')
    expect(html.body).toContain('VERIFICADO')
    expect(html.body).not.toContain('Gómez')
  })

  it('código inexistente o mal formado: 404 y 400, sin romper', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/verify/PS-AAAAA-BBBBB' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/verify/%3Cscript%3E' })).statusCode).toBe(400)
    const page = await app.inject({ method: 'GET', url: '/certificado/%3Cscript%3Ealert(1)%3C%2Fscript%3E' })
    expect(page.statusCode).toBe(404)
    expect(page.body).not.toContain('<script>alert')
  })
})
