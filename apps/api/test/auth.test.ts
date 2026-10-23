import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { body, createTestApp, PHONE, PHONE_FULL } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp } = ctx

const post = (url: string, payload: unknown, remoteAddress = '10.0.0.1', headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, remoteAddress, headers })

const lastCode = () => whatsapp.sent.at(-1)!.code

beforeEach(async () => {
  whatsapp.reset()
  await ctx.reset()
})
afterAll(ctx.close)

describe('registro y verificación por WhatsApp', () => {
  it('envía un código al celular normalizado y no lo devuelve en la respuesta', async () => {
    const res = await post('/api/auth/register', body)
    expect(res.statusCode).toBe(202)
    expect(whatsapp.sent).toHaveLength(1)
    expect(whatsapp.sent[0]!.phone).toBe(PHONE_FULL)
    expect(whatsapp.sent[0]!.code).toMatch(/^\d{6}$/)
    expect(res.body).not.toContain(lastCode())
  })

  it('con el código correcto crea la sesión (cookie httpOnly) y regala 200 créditos', async () => {
    await post('/api/auth/register', body)
    const res = await post('/api/auth/verify', { phone: PHONE, code: lastCode() })
    expect(res.statusCode).toBe(200)
    expect(res.json().credits).toBe(200)

    const cookie = res.cookies.find((c) => c.name === 'ps_session')!
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.sameSite).toBe('Lax')

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { ps_session: cookie.value } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toMatchObject({ name: 'María Pérez', credits: 200 })
  })

  it('un código incorrecto se rechaza y tras 5 intentos queda bloqueado aunque el código sea el bueno', async () => {
    await post('/api/auth/register', body)
    const good = lastCode()
    const wrong = good === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      expect((await post('/api/auth/verify', { phone: PHONE, code: wrong })).statusCode).toBe(400)
    }
    expect((await post('/api/auth/verify', { phone: PHONE, code: good })).statusCode).toBe(429)
  })

  it('un código solo sirve una vez', async () => {
    await post('/api/auth/register', body)
    const code = lastCode()
    expect((await post('/api/auth/verify', { phone: PHONE, code })).statusCode).toBe(200)
    expect((await post('/api/auth/verify', { phone: PHONE, code })).statusCode).toBe(400)
  })

  it('verificar dos veces no duplica los créditos de bienvenida', async () => {
    await post('/api/auth/register', body)
    const res = await post('/api/auth/verify', { phone: PHONE, code: lastCode() })
    expect(res.json().credits).toBe(200)
  })
})

describe('límite de códigos: 4 por IP cada 10 minutos y 1 por minuto por celular', () => {
  it('la misma IP puede pedir hasta 4 códigos (otros celulares o un número corregido) y el quinto se rechaza', async () => {
    for (let i = 0; i < 4; i++) expect((await post('/api/auth/register', { ...body, phone: `300123456${i}` }, '10.0.0.7')).statusCode).toBe(202)
    const fifth = await post('/api/auth/register', { ...body, phone: '3001234569' }, '10.0.0.7')
    expect(fifth.statusCode).toBe(429)
    expect(Number(fifth.headers['retry-after'])).toBeGreaterThan(0)
    expect(whatsapp.sent).toHaveLength(4)
  })

  it('el mismo celular debe esperar un minuto entre códigos', async () => {
    await post('/api/auth/register', body, '10.0.0.7')
    const again = await post('/api/auth/resend-code', { phone: PHONE }, '10.0.0.7')
    expect(again.statusCode).toBe(429)
    expect(Number(again.headers['retry-after'])).toBeLessThanOrEqual(60)
  })

  it('otra IP tampoco puede pedir un segundo código para el mismo celular', async () => {
    await post('/api/auth/register', body, '10.0.0.7')
    const res = await post('/api/auth/resend-code', { phone: PHONE }, '10.0.0.8')
    expect(res.statusCode).toBe(429)
    expect(whatsapp.sent).toHaveLength(1)
  })

  it('reenviar a un celular sin cuenta responde igual y no envía nada', async () => {
    const res = await post('/api/auth/resend-code', { phone: '3009999999' })
    expect(res.statusCode).toBe(200)
    expect(whatsapp.sent).toHaveLength(0)
  })
})

describe('registro: validaciones', () => {
  it('rechaza celulares que no son colombianos', async () => {
    expect((await post('/api/auth/register', { ...body, phone: '1234567' })).statusCode).toBe(400)
  })

  it('Bogotá exige localidad válida y otras ciudades la ignoran', async () => {
    const bogota = { ...body, municipalityCode: '11001' }
    expect((await post('/api/auth/register', bogota)).statusCode).toBe(400)
    expect((await post('/api/auth/register', { ...bogota, localityId: 7 })).statusCode).toBe(202)
  })

  it('rechaza un municipio que no existe', async () => {
    expect((await post('/api/auth/register', { ...body, municipalityCode: '99999' })).statusCode).toBe(400)
  })

  it('un celular ya verificado no puede registrarse otra vez', async () => {
    await post('/api/auth/register', body)
    await post('/api/auth/verify', { phone: PHONE, code: lastCode() })
    // Dentro de la ventana de 10 minutos el límite responde primero (429); pasada la ventana, 409.
    expect((await post('/api/auth/register', body, '10.0.0.9')).statusCode).toBe(429)
    await ctx.db.execute(sql`DELETE FROM rate_limits`)
    expect((await post('/api/auth/register', body, '10.0.0.9')).statusCode).toBe(409)
  })
})

describe('recuperar contraseña', () => {
  async function account() {
    await post('/api/auth/register', body)
    await post('/api/auth/verify', { phone: PHONE, code: lastCode() })
    await ctx.db.execute(sql`DELETE FROM rate_limits`) // pasaron más de 10 minutos desde el registro
    whatsapp.reset()
  }

  it('manda un código por WhatsApp y con él se cambia la contraseña (la vieja deja de servir)', async () => {
    await account()
    const res = await post('/api/auth/forgot-password', { phone: PHONE }, '10.0.0.2')
    expect(res.statusCode).toBe(200)
    expect(whatsapp.sent).toHaveLength(1)
    const reset = await post('/api/auth/reset-password', { phone: PHONE, code: lastCode(), password: 'clave-nueva-123' })
    expect(reset.statusCode).toBe(200)
    expect(reset.cookies.some((c) => c.name === 'ps_session')).toBe(true)
    expect((await post('/api/auth/login', { phone: PHONE, password: body.password }, '10.0.0.3')).statusCode).toBe(401)
    expect((await post('/api/auth/login', { phone: PHONE, password: 'clave-nueva-123' }, '10.0.0.4')).statusCode).toBe(200)
  })

  it('código incorrecto no cambia nada, un código solo sirve una vez y una cuenta inexistente no envía nada', async () => {
    await account()
    await post('/api/auth/forgot-password', { phone: PHONE }, '10.0.0.2')
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    expect((await post('/api/auth/reset-password', { phone: PHONE, code: wrong, password: 'clave-nueva-123' })).statusCode).toBe(400)
    expect((await post('/api/auth/login', { phone: PHONE, password: body.password }, '10.0.0.3')).statusCode).toBe(200)
    expect((await post('/api/auth/reset-password', { phone: PHONE, code, password: 'clave-nueva-123' })).statusCode).toBe(200)
    expect((await post('/api/auth/reset-password', { phone: PHONE, code, password: 'otra-clave-999' })).statusCode).toBe(400)
    whatsapp.reset()
    expect((await post('/api/auth/forgot-password', { phone: '3009998877' }, '10.0.0.9')).statusCode).toBe(200)
    expect(whatsapp.sent).toHaveLength(0)
  })

  it('aplica el límite de 1 código cada 10 minutos por IP', async () => {
    await account()
    expect((await post('/api/auth/forgot-password', { phone: PHONE }, '10.0.0.2')).statusCode).toBe(200)
    expect((await post('/api/auth/forgot-password', { phone: PHONE }, '10.0.0.2')).statusCode).toBe(429)
  })
})

describe('login', () => {
  it('no deja entrar sin verificar el celular', async () => {
    await post('/api/auth/register', body)
    const res = await post('/api/auth/login', { phone: PHONE, password: body.password })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('phone_not_verified')
  })

  it('entra con la contraseña correcta y rechaza la incorrecta', async () => {
    await post('/api/auth/register', body)
    await post('/api/auth/verify', { phone: PHONE, code: lastCode() })
    expect((await post('/api/auth/login', { phone: PHONE, password: 'otra-clave-1' })).statusCode).toBe(401)
    expect((await post('/api/auth/login', { phone: PHONE, password: body.password })).statusCode).toBe(200)
  })

  it('bloquea tras demasiados intentos fallidos', async () => {
    for (let i = 0; i < 10; i++) await post('/api/auth/login', { phone: PHONE, password: 'mala-clave-1' })
    expect((await post('/api/auth/login', { phone: PHONE, password: 'mala-clave-1' })).statusCode).toBe(429)
  })

  it('no guarda la contraseña en claro', async () => {
    await post('/api/auth/register', body)
    const rows = await ctx.db.query.users.findMany()
    expect(rows[0]!.passwordHash).toMatch(/^scrypt\$/)
    expect(rows[0]!.passwordHash).not.toContain(body.password)
  })
})

describe('seguridad de la sesión', () => {
  it('/auth/me exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401)
  })

  it('una cookie manipulada no sirve', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { ps_session: 'abc.def.ghi' } })
    expect(res.statusCode).toBe(401)
  })

  it('rechaza peticiones que modifican datos desde otro origen (CSRF)', async () => {
    const res = await post('/api/auth/login', { phone: PHONE, password: 'x' }, '10.0.0.1', { origin: 'https://evil.example' })
    expect(res.statusCode).toBe(403)
  })
})
