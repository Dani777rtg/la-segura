import { desc, eq, sql } from 'drizzle-orm'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import { creditLedger, purchases } from '../../db/schema.ts'
import type { PaymentsGateway } from '../../gateways/payments.ts'
import { AppError } from '../../lib/errors.ts'
import { hit } from '../../lib/rateLimit.ts'
import { COST } from './costs.ts'
import { PACK } from './pricing.ts'
import { getBalance, grant } from './repo.ts'

const REF_PREFIX = 'PS-PUR-'
// Donación al proyecto: mismo flujo seguro de pago (webhook firmado, monto verificado), pero sin créditos.
export const DONATION_COP = 500_000

export type SettleOutcome = 'approved' | 'pending' | 'rejected' | 'ignored'

export function createCreditsService(db: Db, payments: PaymentsGateway | null, config: Config) {
  const gateway = () => {
    if (!payments) throw new AppError(503, 'payments_unavailable', 'Los pagos no están disponibles por ahora')
    return payments
  }

  return {
    async overview(userId: number) {
      const history = await db
        .select({ delta: creditLedger.delta, reason: creditLedger.reason, createdAt: creditLedger.createdAt })
        .from(creditLedger)
        .where(eq(creditLedger.userId, userId))
        .orderBy(desc(creditLedger.id))
        .limit(20)
      return { balance: await getBalance(db, userId), pack: PACK, costs: COST, history }
    },

    /** Crea la compra y devuelve la dirección de pago de Mercado Pago. No acredita nada todavía. */
    async checkout(userId: number) {
      const mp = gateway()
      await hit(db, `checkout:${userId}`, 10, 3600, 'Intentaste pagar muchas veces. Intenta más tarde')
      const [purchase] = await db
        .insert(purchases)
        .values({ userId, credits: PACK.credits, baseCop: PACK.baseCop, ivaCop: PACK.ivaCop, amountCop: PACK.totalCop })
        .returning({ id: purchases.id })
      const externalReference = `${REF_PREFIX}${purchase!.id}`
      try {
        const pref = await mp.createPreference({
          externalReference,
          title: `${PACK.credits.toLocaleString('es-CO')} créditos La Segura (incluye IVA)`,
          amountCop: PACK.totalCop,
          backUrl: `${config.PUBLIC_BASE_URL}/api/credits/return`,
          notificationUrl: `${config.PUBLIC_BASE_URL}/api/webhooks/mercadopago`,
        })
        await db.update(purchases).set({ mpPreferenceId: pref.id }).where(eq(purchases.id, purchase!.id))
        return { url: pref.url }
      } catch (err) {
        console.error('Fallo al crear el pago:', err instanceof Error ? err.message : 'desconocido')
        throw new AppError(502, 'payments_failed', 'No pudimos iniciar el pago. Intenta de nuevo')
      }
    },

    /** Crea una donación de $500.000 y devuelve la dirección de pago de Mercado Pago. */
    async donate(userId: number) {
      const mp = gateway()
      await hit(db, `checkout:${userId}`, 10, 3600, 'Intentaste pagar muchas veces. Intenta más tarde')
      const [purchase] = await db
        .insert(purchases)
        .values({ userId, credits: 0, baseCop: DONATION_COP, ivaCop: 0, amountCop: DONATION_COP })
        .returning({ id: purchases.id })
      try {
        const pref = await mp.createPreference({
          externalReference: `${REF_PREFIX}${purchase!.id}`,
          title: 'Donación al proyecto La Segura',
          amountCop: DONATION_COP,
          backUrl: `${config.PUBLIC_BASE_URL}/api/donations/return`,
          notificationUrl: `${config.PUBLIC_BASE_URL}/api/webhooks/mercadopago`,
        })
        await db.update(purchases).set({ mpPreferenceId: pref.id }).where(eq(purchases.id, purchase!.id))
        return { url: pref.url }
      } catch (err) {
        console.error('Fallo al crear la donación:', err instanceof Error ? err.message : 'desconocido')
        throw new AppError(502, 'payments_failed', 'No pudimos iniciar el pago. Intenta de nuevo')
      }
    },

    /**
     * Confirma un pago consultándolo directamente a Mercado Pago (nunca se confía en lo que llega
     * por la URL o el cuerpo del webhook). Es idempotente: webhook, retorno del usuario y reintentos
     * pueden llamarlo varias veces y los créditos se suman una sola vez.
     */
    async settle(paymentId: string): Promise<SettleOutcome> {
      const payment = await gateway().getPayment(paymentId)
      if (!payment?.externalReference?.startsWith(REF_PREFIX)) return 'ignored'
      const purchaseId = Number(payment.externalReference.slice(REF_PREFIX.length))
      if (!Number.isInteger(purchaseId)) return 'ignored'

      return db.transaction(async (tx) => {
        // Bloquea la compra: dos notificaciones simultáneas del mismo pago se procesan una tras otra.
        const [purchase] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for('update')
        if (!purchase) return 'ignored'
        if (purchase.status === 'approved') return 'approved'

        if (payment.status === 'approved') {
          // Defensa contra pagos alterados: el monto y la moneda deben ser exactamente los de la compra.
          if (payment.currency !== 'COP' || payment.amount !== purchase.amountCop) {
            console.error(`Pago ${paymentId} con importe distinto al esperado para la compra ${purchaseId}`)
            return 'ignored'
          }
          await tx
            .update(purchases)
            .set({ status: 'approved', mpPaymentId: payment.id, approvedAt: sql`now()` })
            .where(eq(purchases.id, purchaseId))
          // Una donación (0 créditos) solo queda aprobada; una compra suma sus créditos.
          if (purchase.credits > 0) await grant(tx, purchase.userId, purchase.credits, 'purchase', `mp:${payment.id}`)
          return 'approved'
        }
        if (payment.status === 'rejected' || payment.status === 'cancelled') {
          await tx.update(purchases).set({ status: 'rejected' }).where(eq(purchases.id, purchaseId))
          return 'rejected'
        }
        return 'pending'
      })
    },
  }
}

export type CreditsService = ReturnType<typeof createCreditsService>
