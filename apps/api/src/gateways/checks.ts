import { inspectLink, type SiteInfo } from './webinfo.ts'

// Consultas a fuentes abiertas externas. Todas devuelven `null` si la fuente no responde:
// una fuente caída nunca debe tumbar el análisis ni inventar un resultado.

/** Empresa según el RUES (datos abiertos de Confecámaras en datos.gov.co). */
export type Company = { name: string; nit: string; status: string; registeredYear: number | null; lastRenewal: number | null; chamber: string }
export type { SiteInfo }

export interface OpenChecks {
  /** Días desde el registro del dominio (RDAP), o null si no se pudo consultar. */
  domainAgeDays(domain: string): Promise<number | null>
  /** true si el dominio aparece en la lista pública de phishing (OpenPhish), null si no hay lista. */
  isListedPhishing(domain: string): Promise<boolean | null>
  /** Puesto en Tranco (millón de sitios más visitados del mundo); null si no aparece o no responde. */
  popularityRank(domain: string): Promise<number | null>
  /** Sigue el enlace hasta su destino y lee la página (título, nombre, NIT). */
  siteInfo(link: string): Promise<SiteInfo | null>
  /** Busca la empresa en el RUES por NIT (exacto) o por nombre (aproximado). */
  companyByNit(nit: string): Promise<Company | null>
  companyByName(name: string): Promise<Company | null>
}

export class FakeChecks implements OpenChecks {
  ages = new Map<string, number>()
  phishing = new Set<string>()
  async domainAgeDays(domain: string) {
    return this.ages.get(domain) ?? null
  }
  async isListedPhishing(domain: string) {
    return this.phishing.has(domain)
  }
  ranks = new Map<string, number>()
  sites = new Map<string, SiteInfo>()
  companies = new Map<string, Company>()
  async popularityRank(domain: string) {
    return this.ranks.get(domain) ?? null
  }
  async siteInfo(link: string) {
    return [...this.sites.entries()].find(([k]) => link.includes(k))?.[1] ?? null
  }
  async companyByNit(nit: string) {
    return this.companies.get(nit) ?? null
  }
  async companyByName(name: string) {
    return [...this.companies.values()].find((c) => c.name.includes(name.toUpperCase())) ?? null
  }
}

const TIMEOUT_MS = 4000
const FEED_TTL_MS = 60 * 60 * 1000

const DAY_MS = 86_400_000
const RUES = 'https://www.datos.gov.co/resource/c82u-588k.json'

function toCompany(rows: Array<Record<string, string>>): Company | null {
  // Puede haber varias matrículas (sucursales): se prefiere la principal y la más reciente.
  const r = rows.find((x) => (x.categoria_matricula ?? '').startsWith('SOCIEDAD')) ?? rows[0]
  if (!r) return null
  const year = (v?: string) => (v && /^\d{4}/.test(v) ? Number(v.slice(0, 4)) : null)
  return {
    name: r.razon_social ?? '',
    nit: r.nit ?? r.numero_identificacion ?? '',
    status: r.estado_matricula ?? '',
    registeredYear: year(r.fecha_matricula),
    lastRenewal: r.ultimo_ano_renovado ? Number(r.ultimo_ano_renovado) : null,
    chamber: r.camara_comercio ?? '',
  }
}

class RealChecks implements OpenChecks {
  private feed: { hosts: Set<string>; fetchedAt: number } | null = null
  private feedLoading: Promise<Set<string> | null> | null = null
  // ponytail: caché en memoria por instancia (Tranco limita consultas); pasar a Postgres si hay muchas instancias.
  private ranks = new Map<string, { rank: number | null; at: number }>()

  async popularityRank(domain: string) {
    const hit = this.ranks.get(domain)
    if (hit && Date.now() - hit.at < DAY_MS) return hit.rank
    try {
      const res = await fetch(`https://tranco-list.eu/api/ranks/domain/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return null
      const data = (await res.json()) as { ranks?: Array<{ rank: number }> }
      const rank = data.ranks?.[0]?.rank ?? null
      this.ranks.set(domain, { rank, at: Date.now() })
      return rank
    } catch {
      return null
    }
  }

  siteInfo(link: string) {
    return inspectLink(link)
  }

  private async rues(where: string) {
    try {
      const url = new URL(RUES)
      url.searchParams.set('$where', where)
      url.searchParams.set('$limit', '5')
      url.searchParams.set('$order', 'fecha_renovacion DESC')
      const token = process.env.DATOSGOV_APP_TOKEN
      const res = await fetch(url, { headers: token ? { 'X-App-Token': token } : {}, signal: AbortSignal.timeout(4000) })
      if (!res.ok) return null
      return toCompany((await res.json()) as Array<Record<string, string>>)
    } catch {
      return null
    }
  }

  companyByNit(nit: string) {
    return /^\d{9}$/.test(nit) ? this.rues(`nit='${nit}'`) : Promise.resolve(null)
  }

  companyByName(name: string) {
    // Solo letras, números y espacios: el texto viene de una página externa y no puede alterar la consulta.
    const clean = name.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    if (clean.length < 5) return Promise.resolve(null)
    return this.rues(`razon_social like '%${clean}%' AND estado_matricula='ACTIVA'`)
  }

  async domainAgeDays(domain: string) {
    try {
      const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        // rdap.org responde 403 a clientes sin User-Agent.
        headers: { Accept: 'application/rdap+json', 'User-Agent': 'ParceroSeguro/1.0 (prototipo hackathon)' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { events?: Array<{ eventAction: string; eventDate: string }> }
      const registered = data.events?.find((e) => e.eventAction === 'registration')?.eventDate
      if (!registered) return null
      return Math.max(0, Math.floor((Date.now() - new Date(registered).getTime()) / 86_400_000))
    } catch {
      return null
    }
  }

  async isListedPhishing(domain: string) {
    const hosts = await this.loadFeed()
    if (!hosts) return null
    return [...hosts].some((h) => h === domain || h.endsWith(`.${domain}`))
  }

  // La lista de OpenPhish se descarga una vez por hora y se comparte entre peticiones.
  private async loadFeed() {
    if (this.feed && Date.now() - this.feed.fetchedAt < FEED_TTL_MS) return this.feed.hosts
    this.feedLoading ??= (async () => {
      try {
        const res = await fetch('https://openphish.com/feed.txt', { signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!res.ok) return null
        const hosts = new Set<string>()
        for (const line of (await res.text()).split('\n')) {
          try {
            hosts.add(new URL(line.trim()).hostname.toLowerCase())
          } catch {
            /* línea vacía o inválida */
          }
        }
        this.feed = { hosts, fetchedAt: Date.now() }
        return hosts
      } catch {
        return this.feed?.hosts ?? null
      } finally {
        this.feedLoading = null
      }
    })()
    return this.feedLoading
  }
}

export const createOpenChecks = (): OpenChecks => new RealChecks()
