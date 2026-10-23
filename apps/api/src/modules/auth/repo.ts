import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Executor } from '../../db/client.ts'
import { otpCodes, users } from '../../db/schema.ts'

export type User = typeof users.$inferSelect

export async function findUserByPhone(ex: Executor, phone: string) {
  const [user] = await ex.select().from(users).where(eq(users.phone, phone))
  return user
}

export async function countRealUsers(ex: Executor) {
  // Solo cuentan las cuentas verificadas: un número mal escrito y nunca confirmado no ocupa cupo.
  const [row] = await ex.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.isDemo, false), isNotNull(users.phoneVerifiedAt)))
  return row?.n ?? 0
}

export async function findUserById(ex: Executor, id: number) {
  const [user] = await ex.select().from(users).where(eq(users.id, id))
  return user
}

/** Crea el usuario o, si el celular nunca se verificó, reemplaza sus datos (reintento de registro). */
export async function upsertUnverifiedUser(
  ex: Executor,
  data: { phone: string; name: string; passwordHash: string; municipalityCode: string; localityId: number | null },
) {
  const [user] = await ex
    .insert(users)
    .values(data)
    .onConflictDoUpdate({
      target: users.phone,
      set: {
        name: data.name,
        passwordHash: data.passwordHash,
        municipalityCode: data.municipalityCode,
        localityId: data.localityId,
      },
      setWhere: isNull(users.phoneVerifiedAt),
    })
    .returning()
  return user
}

export async function markPhoneVerified(ex: Executor, userId: number) {
  await ex.update(users).set({ phoneVerifiedAt: sql`now()` }).where(eq(users.id, userId))
}

export async function invalidateOtps(ex: Executor, userId: number) {
  await ex
    .update(otpCodes)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(otpCodes.userId, userId), isNull(otpCodes.consumedAt)))
}

export async function createOtp(ex: Executor, userId: number, codeHash: string, ttlSec: number) {
  await ex.insert(otpCodes).values({
    userId,
    codeHash,
    expiresAt: sql`now() + make_interval(secs => ${ttlSec})`,
  })
}

export async function findActiveOtp(ex: Executor, userId: number) {
  const [otp] = await ex
    .select()
    .from(otpCodes)
    .where(and(eq(otpCodes.userId, userId), isNull(otpCodes.consumedAt), sql`${otpCodes.expiresAt} > now()`))
    .orderBy(desc(otpCodes.id))
    .limit(1)
    // Bloquea la fila: dos verificaciones simultáneas no pueden pasar el límite de intentos.
    .for('update')
  return otp
}

export async function bumpOtpAttempts(ex: Executor, otpId: number) {
  await ex
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(eq(otpCodes.id, otpId))
}

export async function consumeOtp(ex: Executor, otpId: number) {
  await ex.update(otpCodes).set({ consumedAt: sql`now()` }).where(eq(otpCodes.id, otpId))
}

export async function setPassword(ex: Executor, userId: number, passwordHash: string) {
  await ex.update(users).set({ passwordHash }).where(eq(users.id, userId))
}
