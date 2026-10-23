import { afterAll, describe, expect, it } from 'vitest'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
afterAll(ctx.close)

describe('autocompletado de municipios', () => {
  it('ignora tildes y mayúsculas', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/locations/municipalities?q=MEDEL' })
    expect(res.json().items[0]).toMatchObject({ code: '05001', name: 'MEDELLÍN' })
  })

  it('exige al menos 2 caracteres', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/locations/municipalities?q=m' })
    expect(res.statusCode).toBe(400)
  })

  it('un % en la búsqueda no actúa como comodín', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/locations/municipalities?q=%25%25' })
    expect(res.json().items).toHaveLength(0)
  })
})
