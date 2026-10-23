import type { Config } from '../config.ts'

// Puerto de Mercado Pago (Checkout Pro). Las credenciales son de producción de la empresa:
// cualquier pago aprobado es dinero real. Las pruebas automáticas siempre usan FakePayments.
export type PreferenceInput = {
  externalReference: string
  title: string
  amountCop: number
  backUrl: string
  notificationUrl?: string
}

export type Payment = {
  id: string
  status: string
  externalReference: string | null
  amount: number
  currency: string
}

export interface PaymentsGateway {
  createPreference(input: PreferenceInput): Promise<{ id: string; url: string }>
  getPayment(id: string): Promise<Payment | null>
}

export class FakePayments implements PaymentsGateway {
  preferences: PreferenceInput[] = []
  payments = new Map<string, Payment>()
  async createPreference(input: PreferenceInput) {
    this.preferences.push(input)
    return { id: `pref-${this.preferences.length}`, url: `https://pago.example/checkout/${input.externalReference}` }
  }
  async getPayment(id: string) {
    return this.payments.get(id) ?? null
  }
}

const API = 'https://api.mercadopago.com'

class MercadoPago implements PaymentsGateway {
  constructor(private readonly token: string) {}

  private headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${this.token}`,
    'Content-Type': 'application/json',
    ...extra,
  })

  async createPreference(i: PreferenceInput) {
    const https = i.backUrl.startsWith('https://')
    const res = await fetch(`${API}/checkout/preferences`, {
      method: 'POST',
      // La clave de idempotencia evita preferencias duplicadas si se reintenta la misma compra.
      headers: this.headers({ 'X-Idempotency-Key': i.externalReference }),
      body: JSON.stringify({
        items: [
          {
            id: i.amountCop === 500_000 ? 'donacion' : 'creditos-1000',
            title: i.title,
            quantity: 1,
            currency_id: 'COP',
            unit_price: i.amountCop,
          },
        ],
        external_reference: i.externalReference,
        statement_descriptor: 'LASEGURA',
        back_urls: { success: i.backUrl, pending: i.backUrl, failure: i.backUrl },
        // Pago aprobado: Mercado Pago devuelve a la persona a La Segura sola. Pendiente o rechazado: muestra el botón
        // "Volver al sitio", que lleva a las mismas back_urls. Solo acepta auto_return y notification_url con https público.
        ...(https ? { auto_return: 'approved' } : {}),
        ...(i.notificationUrl?.startsWith('https://') ? { notification_url: i.notificationUrl } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status} al crear la preferencia`)
    const data = (await res.json()) as { id?: string; init_point?: string }
    if (!data.id || !data.init_point) throw new Error('Mercado Pago no devolvió la preferencia')
    return { id: data.id, url: data.init_point }
  }

  async getPayment(id: string): Promise<Payment | null> {
    const res = await fetch(`${API}/v1/payments/${encodeURIComponent(id)}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status} al consultar el pago`)
    const d = (await res.json()) as {
      id: number
      status: string
      external_reference?: string | null
      transaction_amount: number
      currency_id: string
    }
    return { id: String(d.id), status: d.status, externalReference: d.external_reference ?? null, amount: d.transaction_amount, currency: d.currency_id }
  }
}

export const createPayments = (cfg: Config): PaymentsGateway | null =>
  cfg.MERCADOPAGO_ACCESS_TOKEN ? new MercadoPago(cfg.MERCADOPAGO_ACCESS_TOKEN) : null
