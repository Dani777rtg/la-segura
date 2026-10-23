import { and, eq, sql } from 'drizzle-orm'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import { indicators, type CaseSource } from '../../db/schema.ts'
import type { OpenChecks } from '../../gateways/checks.ts'
import { badRequest } from '../../lib/errors.ts'
import { subkey } from '../../lib/keys.ts'
import { displayIndicator, hashIndicator, type IndicatorKind } from '../../lib/indicator.ts'
import { normalizeColombianMobile } from '../../lib/phone.ts'
import { hit } from '../../lib/rateLimit.ts'
import { extract } from '../agent/signals.ts'

export type Level = 'sin_reportes' | 'alerta' | 'peligro'

const DANGER_AT = 3 // personas distintas que reportaron algo para considerarlo peligroso

// "Consulta antes de pagar": gratis. Busca un celular o un enlace en la comunidad y en fuentes abiertas.
export function createLookupService(db: Db, checks: OpenChecks, config: Config) {
  function parse(raw: string): { kind: IndicatorKind; value: string } {
    const query = raw.trim()
    const phone = normalizeColombianMobile(query)
    if (phone) return { kind: 'phone', value: phone }
    const domain = extract(query).domains[0]
    if (domain) return { kind: 'domain', value: domain }
    throw badRequest('invalid_query', 'Escribe un celular colombiano o un enlace')
  }

  return {
    async lookup(userId: number, raw: string) {
      await hit(db, `lookup:${userId}`, 30, 60, 'Vas muy rápido. Espera un momento')
      const { kind, value } = parse(raw)
      const valueHash = hashIndicator(subkey(config.JWT_SECRET, 'indicator'), kind, value)

      const [rep] = await db
        .select({
          reporters: sql<number>`count(distinct ${indicators.userId})::int`,
          first: sql<Date | null>`min(${indicators.createdAt})`,
          last: sql<Date | null>`max(${indicators.createdAt})`,
        })
        .from(indicators)
        .where(and(eq(indicators.kind, kind), eq(indicators.valueHash, valueHash)))

      const reporters = rep?.reporters ?? 0
      const level: Level = reporters >= DANGER_AT ? 'peligro' : reporters > 0 ? 'alerta' : 'sin_reportes'

      const notes: CaseSource[] = []
      if (kind === 'domain') {
        const [age, listed] = await Promise.all([checks.domainAgeDays(value), checks.isListedPhishing(value)])
        if (age !== null) notes.push({ name: 'Antigüedad del dominio', result: age < 60 ? 'flag' : 'ok', detail: `Se registró hace ${age} días` })
        if (listed) notes.push({ name: 'Lista pública de phishing (OpenPhish)', result: 'flag', detail: 'Aparece en la lista de sitios de phishing' })
        for (const s of extract(`https://${value}`).signals) {
          if (s.key === 'dominio_imitador' || s.key === 'tld_riesgoso' || s.key === 'acortador') notes.push({ name: 'Revisión del enlace', result: 'flag', detail: s.label })
        }
      }
      const external = notes.some((n) => n.result === 'flag' && n.name !== 'Antigüedad del dominio')

      return {
        kind,
        display: displayIndicator(kind, value),
        reporters,
        firstReportedAt: rep?.first ?? null,
        lastReportedAt: rep?.last ?? null,
        level: external && level === 'sin_reportes' ? ('alerta' as Level) : level,
        notes,
        disclaimer: 'Que nadie lo haya reportado no significa que sea seguro. Antes de pagar, confirma el nombre del destinatario en tu app del banco.',
      }
    },
  }
}

export type LookupService = ReturnType<typeof createLookupService>
