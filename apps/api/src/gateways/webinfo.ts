import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'

// Visita segura de un enlace sospechoso para saber a dónde lleva y de quién es la página.
// El servidor NUNCA debe poder ser usado para entrar a direcciones internas (metadatos de la nube, red privada):
// cada salto se resuelve aquí, se rechaza cualquier IP no pública y la conexión se fija a esa misma IP.

const MAX_HOPS = 5
const MAX_BYTES = 300_000
const TIMEOUT_MS = 5000

function isPublicIp(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number) as [number, number]
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false // CGNAT
    if (a === 169 && b === 254) return false // enlace local (metadatos de la nube)
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    return true
  }
  const v6 = ip.toLowerCase()
  if (v6 === '::' || v6 === '::1') return false
  if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return false // ULA y enlace local
  return isIP(v6) === 6
}

async function publicAddress(host: string): Promise<{ address: string; family: number }> {
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new Error('dirección no pública')
    return { address: host, family: isIP(host) }
  }
  const all = await lookup(host, { all: true })
  if (!all.length || all.some((a) => !isPublicIp(a.address))) throw new Error('dirección no pública')
  return all[0]!
}

type Hop = { status: number; location?: string; body: string }

async function getOnce(url: URL): Promise<Hop> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocolo no permitido')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('puerto no permitido')
  const pinned = await publicAddress(url.hostname)
  const client = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = client.get(
      url,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ParceroSeguro/1.0; verificacion de enlaces)', Accept: 'text/html,*/*;q=0.5' },
        // Se conecta a la IP ya validada (sin volver a preguntar al DNS): evita el truco de cambiar la IP entre la
        // validación y la conexión.
        lookup: ((_h: string, o: { all?: boolean }, cb: (...args: unknown[]) => void) =>
          o?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family)) as never,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ status, location: res.headers.location, body: '' })
        }
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BYTES) res.destroy()
          else chunks.push(c)
        })
        res.on('close', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('tiempo agotado')))
    req.on('error', reject)
  })
}

export type SiteInfo = { finalUrl: string; finalHost: string; title: string; siteName: string; nit: string | null }

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()

/** Sigue el enlace (máximo 5 redirecciones) y lee de la página: título, nombre del sitio y NIT si lo publica. */
export async function inspectLink(raw: string): Promise<SiteInfo | null> {
  try {
    let url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const r = await getOnce(url)
      if (r.location) {
        url = new URL(r.location, url)
        continue
      }
      const html = r.body
      const title = decode(/<title[^>]*>([^<]{1,200})/i.exec(html)?.[1] ?? '')
      const siteName = decode(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,120})/i.exec(html)?.[1] ?? '')
      // Las empresas colombianas suelen publicar su NIT en el pie de página o en los términos: "NIT 900.243.000-8".
      const nitMatch = /\bN\.?\s?I\.?\s?T\.?\s*(?:No\.?|:)?\s*(\d{3}[.\s]?\d{3}[.\s]?\d{3})/i.exec(html.replace(/<[^>]+>/g, ' '))
      return {
        finalUrl: url.toString().slice(0, 300),
        finalHost: url.hostname.toLowerCase(),
        title,
        siteName,
        nit: nitMatch ? nitMatch[1]!.replace(/\D/g, '') : null,
      }
    }
    return null // demasiadas redirecciones
  } catch {
    return null
  }
}

export { isPublicIp }
