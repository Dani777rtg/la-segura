import { normalizeColombianMobile } from '../../lib/phone.ts'

// Extracción determinista de lo que hay en el mensaje: no depende de la IA ni de la red.

export type Extracted = {
  urls: string[]
  domains: string[] // dominios registrables, sin duplicados
  phones: string[] // 57XXXXXXXXXX
  signals: Signal[]
}

export type Signal = { key: string; label: string; weight: 'alto' | 'medio' }

// Dominios oficiales verificados de empresas y entidades que más suplantan en Colombia.
// Se usan en los dos sentidos: un enlace a uno de estos es de la empresa real; uno que se parece sin serlo, la imita.
// ponytail: lista curada a mano; ampliarla cuando la comunidad reporte una marca nueva.
export const OFFICIAL_DOMAINS: Record<string, { name: string; domains: string[] }> = {
  bancolombia: { name: 'Bancolombia', domains: ['bancolombia.com', 'grupobancolombia.com', 'bancolombia.com.co'] },
  nequi: { name: 'Nequi', domains: ['nequi.com.co', 'nequi.com'] },
  daviplata: { name: 'Daviplata', domains: ['daviplata.com'] },
  davivienda: { name: 'Davivienda', domains: ['davivienda.com'] },
  bbva: { name: 'BBVA', domains: ['bbva.com.co', 'bbva.com'] },
  bancodebogota: { name: 'Banco de Bogotá', domains: ['bancodebogota.com', 'bancodebogota.com.co'] },
  bancopopular: { name: 'Banco Popular', domains: ['bancopopular.com.co'] },
  bancodeoccidente: { name: 'Banco de Occidente', domains: ['bancodeoccidente.com.co'] },
  avvillas: { name: 'AV Villas', domains: ['avvillas.com.co'] },
  colpatria: { name: 'Scotiabank Colpatria', domains: ['scotiabankcolpatria.com'] },
  falabella: { name: 'Falabella', domains: ['falabella.com.co', 'bancofalabella.com.co', 'falabella.com'] },
  nubank: { name: 'Nu Colombia', domains: ['nu.com.co'] },
  lulobank: { name: 'Lulo Bank', domains: ['lulobank.com'] },
  policia: { name: 'Policía Nacional', domains: ['policia.gov.co'] },
  fiscalia: { name: 'Fiscalía', domains: ['fiscalia.gov.co'] },
  dian: { name: 'DIAN', domains: ['dian.gov.co'] },
  simit: { name: 'SIMIT', domains: ['fcm.org.co'] },
  superfinanciera: { name: 'Superfinanciera', domains: ['superfinanciera.gov.co'] },
  mercadopago: { name: 'Mercado Pago', domains: ['mercadopago.com.co', 'mercadopago.com'] },
  mercadolibre: { name: 'Mercado Libre', domains: ['mercadolibre.com.co', 'mercadolibre.com'] },
  servientrega: { name: 'Servientrega', domains: ['servientrega.com'] },
  interrapidisimo: { name: 'Interrapidísimo', domains: ['interrapidisimo.com'] },
  coordinadora: { name: 'Coordinadora', domains: ['coordinadora.com'] },
  efecty: { name: 'Efecty', domains: ['efecty.com.co'] },
  movistar: { name: 'Movistar', domains: ['movistar.com.co'] },
  claro: { name: 'Claro', domains: ['claro.com.co'] },
  tigo: { name: 'Tigo', domains: ['tigo.com.co'] },
  temu: { name: 'Temu', domains: ['temu.com'] },
  rappi: { name: 'Rappi', domains: ['rappi.com.co', 'rappi.com'] },
  exito: { name: 'Éxito', domains: ['exito.com'] },
  amazon: { name: 'Amazon', domains: ['amazon.com'] },
  netflix: { name: 'Netflix', domains: ['netflix.com'] },
  betplay: { name: 'BetPlay', domains: ['betplay.com.co'] },
  whatsapp: { name: 'WhatsApp', domains: ['whatsapp.com', 'wa.me'] },
}

/** Si el dominio (o un subdominio suyo) es oficial, devuelve el nombre de la empresa. */
export function officialOwner(domain: string): string | null {
  for (const o of Object.values(OFFICIAL_DOMAINS)) if (o.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return o.name
  return null
}

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 't.ly', 'is.gd', 'rb.gy', 'shorturl.at', 'ow.ly', 'goo.su'])
const RISKY_TLDS = new Set(['xyz', 'top', 'click', 'link', 'icu', 'buzz', 'cfd', 'sbs', 'rest', 'monster', 'cyou'])
const SECOND_LEVEL_CO = new Set(['com', 'gov', 'org', 'net', 'edu', 'mil', 'nom'])

const URL_RE = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi
const PHONE_RE = /(?:\+?57[\s-]?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g

/** "login.bancolombia-seguro.com.co/x" → "bancolombia-seguro.com.co" */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')
  const last = labels.at(-1)!
  const second = labels.at(-2)!
  return last === 'co' && SECOND_LEVEL_CO.has(second) ? labels.slice(-3).join('.') : labels.slice(-2).join('.')
}

function hostOf(raw: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
  }
  return dp[a.length]![b.length]!
}

/** Marca dominios que imitan a una entidad conocida sin ser el dominio oficial. */
function impersonatedBrand(domain: string): string | null {
  if (officialOwner(domain)) return null
  const label = domain.split('.')[0]!.replace(/-/g, '')
  for (const [brand, o] of Object.entries(OFFICIAL_DOMAINS)) {
    // Marcas cortas ("tigo", "nu", "claro") aparecen dentro de palabras normales: solo cuentan las de 5+ letras.
    if (brand.length < 5) continue
    if (label.includes(brand) || (label.length >= 5 && levenshtein(label, brand) <= 2)) return o.name
  }
  return null
}

const PATTERNS: Array<{ key: string; label: string; weight: Signal['weight']; re: RegExp }> = [
  { key: 'pide_codigo', label: 'Pide un código, clave, token o datos de la tarjeta', weight: 'alto', re: /(c[oó]digo (de )?(verificaci[oó]n|seguridad|de \d)|clave (din[aá]mica|del cajero)?|\btoken\b|\bcvv\b|\bpin\b|n[uú]mero de (tu )?tarjeta)/i },
  { key: 'urgencia', label: 'Mete afán o amenaza con bloquear algo', weight: 'medio', re: /(urgente|de inmediato|[uú]ltimas horas|ser[aá] (bloquead|suspendid|cancelad)|tu cuenta (ha sido|est[aá]) (bloquead|suspendid)|evita (el )?bloqueo)/i },
  { key: 'premio', label: 'Dice que ganaste un premio o sorteo', weight: 'medio', re: /(ganaste|has ganado|premio|sorteo|felicitaciones)/i },
  { key: 'prestamo', label: 'Ofrece un préstamo fácil o sin requisitos', weight: 'medio', re: /(pr[eé]stamo|cr[eé]dito) (aprobado|inmediato|f[aá]cil)|sin (papeleo|centrales|codeudor|estudio)/i },
  { key: 'comprobante', label: 'Menciona un comprobante o un pago hecho "por error" (un comprobante no prueba que el dinero llegó)', weight: 'medio', re: /(comprobante|consign[eé] por error|devu[eé]lveme|transferencia (fallida|pendiente))/i },
  { key: 'familiar', label: 'Dice ser un familiar que cambió de número', weight: 'medio', re: /(cambi[eé] de n[uú]mero|este es mi nuevo n[uú]mero|mam[aá]|pap[aá]|hijo|hija).{0,40}(nuevo n[uú]mero|ayuda|urgente|plata|dinero)/i },
  { key: 'judicial', label: 'Habla de una citación, demanda o proceso judicial', weight: 'medio', re: /(citaci[oó]n|demanda|juzgado|proceso (judicial|penal)|orden de captura|embargo)/i },
  { key: 'sim', label: 'Habla de cambio, duplicado o portabilidad de tu SIM o tu línea', weight: 'alto', re: /(duplicado de (tu )?sim|cambio de sim|sim (duplicada|clonada)|portabilidad|se me (qued[oó]|fue|cay[oó]) (sin )?(la )?(se[ñn]al|l[ií]nea)|sin se[ñn]al de (repente|sin motivo))/i },
  { key: 'inversion', label: 'Promete ganancias rápidas o dinero garantizado', weight: 'medio', re: /(ganancias? (garantizad|aseguradas?)|duplica(r)? tu dinero|inversi[oó]n segura|trabaja desde casa.{0,30}gana)/i },
]

export function extract(text: string): Extracted {
  const urls: string[] = []
  const domains = new Set<string>()
  for (const raw of text.match(URL_RE) ?? []) {
    const host = hostOf(raw)
    // Descarta falsos positivos como "ej.mplo" o nombres de archivo.
    if (!host || !host.includes('.') || /\.(png|jpe?g|gif|pdf|docx?)$/i.test(host)) continue
    urls.push(raw)
    domains.add(registrableDomain(host))
  }

  const phones = new Set<string>()
  for (const raw of text.match(PHONE_RE) ?? []) {
    const phone = normalizeColombianMobile(raw)
    if (phone) phones.add(phone)
  }

  const signals: Signal[] = []
  for (const p of PATTERNS) if (p.re.test(text)) signals.push({ key: p.key, label: p.label, weight: p.weight })

  for (const domain of domains) {
    const brand = impersonatedBrand(domain)
    if (brand) signals.push({ key: 'dominio_imitador', label: `El enlace ${domain} imita a "${brand}" pero no es su sitio oficial`, weight: 'alto' })
    if (SHORTENERS.has(domain)) signals.push({ key: 'acortador', label: `El enlace está acortado (${domain}) y no se ve a dónde lleva`, weight: 'medio' })
    if (RISKY_TLDS.has(domain.split('.').at(-1)!)) signals.push({ key: 'tld_riesgoso', label: `El dominio ${domain} usa una terminación muy usada en estafas`, weight: 'medio' })
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) signals.push({ key: 'ip_directa', label: 'El enlace es una dirección numérica, no un sitio con nombre', weight: 'alto' })
  }
  return { urls, domains: [...domains], phones: [...phones], signals }
}
