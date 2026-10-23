import { createHmac } from 'node:crypto'

export type IndicatorKind = 'phone' | 'domain'

// HMAC: permite buscar "¿alguien reportó este número?" sin guardar el número en claro.
export const hashIndicator = (secret: string, kind: IndicatorKind, value: string) =>
  createHmac('sha256', secret).update(`${kind}:${value.toLowerCase()}`).digest('hex')

// Los teléfonos se muestran enmascarados; los dominios son públicos.
export const displayIndicator = (kind: IndicatorKind, value: string) =>
  kind === 'phone' ? `${value.slice(0, 4)}•••••${value.slice(-3)}` : value
