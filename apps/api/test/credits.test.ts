import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/errors.ts'
import { getBalance, grant, spend } from '../src/modules/credits/repo.ts'
import { users } from '../src/db/schema.ts'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { db } = ctx
let userId: number

beforeEach(async () => {
  await ctx.reset()
  const [u] = await db
    .insert(users)
    .values({ phone: '573001112233', name: 'Test', passwordHash: 'x', municipalityCode: '05001' })
    .returning({ id: users.id })
  userId = u!.id
})
afterAll(ctx.close)

describe('libro de créditos', () => {
  it('grant es idempotente por ref (un pago no se acredita dos veces)', async () => {
    expect(await grant(db, userId, 1000, 'purchase', 'mp:123')).toBe(true)
    expect(await grant(db, userId, 1000, 'purchase', 'mp:123')).toBe(false)
    expect(await getBalance(db, userId)).toBe(1000)
  })

  it('spend sin saldo falla con 402 y no cambia nada', async () => {
    await grant(db, userId, 5, 'welcome', 'w:1')
    await expect(spend(db, userId, 10, 'analysis')).rejects.toMatchObject({ status: 402 })
    expect(await getBalance(db, userId)).toBe(5)
  })

  it('spend en transacción que falla se revierte completo', async () => {
    await grant(db, userId, 10, 'welcome', 'w:1')
    await expect(
      db.transaction(async (tx) => {
        await spend(tx, userId, 4, 'analysis')
        throw new AppError(500, 'boom', 'boom')
      }),
    ).rejects.toThrow('boom')
    expect(await getBalance(db, userId)).toBe(10)
  })

  it('gastos concurrentes nunca dejan el saldo negativo', async () => {
    await grant(db, userId, 100, 'welcome', 'w:1')
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => db.transaction((tx) => spend(tx, userId, 30, 'analysis'))),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
    expect(await getBalance(db, userId)).toBe(10)
  })
})
