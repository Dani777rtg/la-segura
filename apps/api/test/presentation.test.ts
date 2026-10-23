import { afterAll, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app } = ctx
afterAll(ctx.close)

describe('presentación controlada desde el celular', () => {
  it('solo quien tiene el enlace de control cambia la diapositiva; la pantalla la lee', async () => {
    await ctx.reset()
    const { code, token } = (await app.inject({ method: 'POST', url: '/api/presentation' })).json()
    expect(code).toMatch(/^[a-z0-9]{6}$/)
    expect((await app.inject({ method: 'GET', url: `/api/presentation/${code}` })).json()).toEqual({ slide: 0 })
    const bad = await app.inject({ method: 'POST', url: `/api/presentation/${code}/slide`, payload: { token: 'x'.repeat(24), slide: 3 } })
    expect(bad.statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/api/presentation/${code}/slide`, payload: { token, slide: 1 } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/api/presentation/${code}` })).json()).toEqual({ slide: 1 })
  })

  it('el QR solo se genera para el WhatsApp del bot o enlaces de la app', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/qr.svg?data=' + encodeURIComponent('https://wa.me/573024036890?text=Hola') })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['content-type']).toContain('image/svg+xml')
    expect((await app.inject({ method: 'GET', url: '/api/qr.svg?data=' + encodeURIComponent('https://sitio-malo.xyz') })).statusCode).toBe(400)
  })
})
