import { eq, sql } from 'drizzle-orm'
import type { Executor } from '../../db/client.ts'
import { creditAccounts, creditLedger } from '../../db/schema.ts'
import { AppError } from '../../lib/errors.ts'

// Todas las funciones deben llamarse dentro de la transacción del caso de uso que las usa.

/** Suma créditos. Idempotente por `ref`: devuelve false si ya se había aplicado. */
export async function grant(ex: Executor, userId: number, amount: number, reason: string, ref: string) {
  const inserted = await ex
    .insert(creditLedger)
    .values({ userId, delta: amount, reason, ref })
    .onConflictDoNothing({ target: creditLedger.ref })
    .returning({ id: creditLedger.id })
  if (inserted.length === 0) return false

  await ex
    .insert(creditAccounts)
    .values({ userId, balance: amount })
    .onConflictDoUpdate({
      target: creditAccounts.userId,
      set: { balance: sql`${creditAccounts.balance} + ${amount}` },
    })
  return true
}

/** Resta créditos de forma atómica. Lanza 402 si no alcanza; el saldo nunca queda negativo. */
export async function spend(ex: Executor, userId: number, amount: number, reason: string, ref?: string) {
  const updated = await ex
    .update(creditAccounts)
    .set({ balance: sql`${creditAccounts.balance} - ${amount}` })
    .where(sql`${creditAccounts.userId} = ${userId} AND ${creditAccounts.balance} >= ${amount}`)
    .returning({ balance: creditAccounts.balance })
  if (updated.length === 0) {
    throw new AppError(402, 'insufficient_credits', 'No tienes créditos suficientes')
  }
  await ex.insert(creditLedger).values({ userId, delta: -amount, reason, ref: ref ?? null })
  return updated[0]!.balance
}

export async function getBalance(ex: Executor, userId: number) {
  const [row] = await ex.select({ balance: creditAccounts.balance }).from(creditAccounts).where(eq(creditAccounts.userId, userId))
  return row?.balance ?? 0
}
