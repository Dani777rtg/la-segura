import { randomUUID } from 'node:crypto'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import type { CaseSource } from '../../db/schema.ts'
import type { OpenChecks } from '../../gateways/checks.ts'
import type { LlmGateway, LlmVerdict } from '../../gateways/llm.ts'
import { subkey } from '../../lib/keys.ts'
import { displayIndicator, hashIndicator, type IndicatorKind } from '../../lib/indicator.ts'
import { hit } from '../../lib/rateLimit.ts'
import { findUserById } from '../auth/repo.ts'
import { AppError, unauthorized } from '../../lib/errors.ts'
import { getBalance, grant, spend } from '../credits/repo.ts'
import { levelFor, type Level } from './level.ts'
import { assessRules, type Risk } from './rules.ts'
import { countOtherReporters, insertCase, insertIndicators } from './repo.ts'
import { extract, officialOwner, registrableDomain } from './signals.ts'

export type AnalysisResult = {
  caseId: number
  risk: Risk
  level: Level
  fraudType: string
  summary: string
  reasons: string[]
  advice: string[]
  sources: CaseSource[]
  offerReport: boolean
  creditsLeft: number
}

const RANK: Record<Risk, number> = { bajo: 0, medio: 1, alto: 2 }
const YOUNG_DOMAIN_DAYS = 60
// Un sitio entre los 200.000 más visitados del mundo (Tranco) es, en la práctica, de una empresa o servicio real.
const POPULAR_RANK = 200_000

export type AgentDeps = { db: Db; llm: LlmGateway | null; checks: OpenChecks; config: Config }

export function createAgentService({ db, llm, checks, config }: AgentDeps) {
  const hash = (kind: IndicatorKind, value: string) => hashIndicator(subkey(config.JWT_SECRET, 'indicator'), kind, value)

  /**
   * Para un dominio que NO está en la lista de oficiales, averigua si es de una empresa real: qué tan visitado es
   * (Tranco), a dónde lleva de verdad el enlace y si la empresa de la página existe y está activa en el RUES.
   */
  async function reputation(domain: string, link: string) {
    const year = new Date().getFullYear()
    const sources: CaseSource[] = []
    const [rank, site] = await Promise.all([checks.popularityRank(domain), checks.siteInfo(link)])
    sources.push(
      rank !== null
        ? { name: 'Popularidad en internet (Tranco)', result: rank <= POPULAR_RANK ? 'ok' : 'unverified', detail: `${domain} está en el puesto ${rank.toLocaleString('es-CO')} de los sitios más visitados del mundo` }
        : { name: 'Popularidad en internet (Tranco)', result: 'unverified', detail: `${domain} no aparece entre el millón de sitios más visitados del mundo` },
    )

    let finalDomain: string | null = null
    let destinationTrusted = false
    if (!site) {
      sources.push({ name: 'Destino del enlace', result: 'unavailable', detail: 'No pudimos abrir el enlace de forma segura' })
    } else {
      finalDomain = registrableDomain(site.finalHost)
      if (finalDomain !== domain) {
        const owner = officialOwner(finalDomain)
        const finalRank = owner ? null : await checks.popularityRank(finalDomain)
        destinationTrusted = !!owner || (finalRank !== null && finalRank <= POPULAR_RANK)
        sources.push({
          name: 'Destino del enlace',
          result: destinationTrusted ? 'ok' : 'unverified',
          detail: `El enlace lleva a ${finalDomain}${owner ? ` (sitio oficial de ${owner})` : finalRank !== null ? ` (puesto ${finalRank.toLocaleString('es-CO')} en internet)` : ''}`,
        })
      }
    }

    let company = site?.nit ? await checks.companyByNit(site.nit) : null
    let byName = false
    if (!company && site) {
      const name = site.siteName || site.title.split(/[|\-–—:·]/)[0]!.trim()
      company = name ? await checks.companyByName(name) : null
      byName = !!company
    }
    const solid = !!company && !byName && company.status === 'ACTIVA' && (company.lastRenewal ?? 0) >= year - 1 && (company.registeredYear ?? year) <= year - 2
    if (company) {
      const facts = `${company.name} (NIT ${company.nit}), matrícula ${company.status.toLowerCase()}${company.registeredYear ? ` desde ${company.registeredYear}` : ''}${company.lastRenewal ? `, renovada en ${company.lastRenewal}` : ''}`
      sources.push({
        name: 'Empresa en el RUES',
        result: company.status !== 'ACTIVA' ? 'flag' : solid ? 'ok' : 'unverified',
        detail: byName ? `Posible coincidencia por nombre (no confirmada): ${facts}` : `La página publica el NIT de ${facts}`,
      })
    } else if (site) {
      sources.push({ name: 'Empresa en el RUES', result: 'unverified', detail: 'La página no muestra un NIT ni un nombre de empresa que encontremos en el RUES' })
    }
    const trusted = (rank !== null && rank <= POPULAR_RANK) || destinationTrusted || solid
    return { sources, trusted }
  }

  async function consultSources(domains: string[], phones: string[], userId: number, urls: string[] = []) {
    const sources: CaseSource[] = []
    const trusted = new Set<string>()

    const checked = domains.slice(0, 3)
    const [ages, listed, extra] = await Promise.all([
      Promise.all(checked.map((d) => checks.domainAgeDays(d))),
      Promise.all(checked.map((d) => checks.isListedPhishing(d))),
      Promise.all(checked.map((d) => (officialOwner(d) ? null : reputation(d, urls.find((u) => u.toLowerCase().includes(d)) ?? d)))),
    ])
    checked.forEach((domain, i) => {
      // Siempre se verifica si el enlace es de la empresa real (lista curada de dominios oficiales).
      const owner = officialOwner(domain)
      sources.push(
        owner
          ? { name: 'Dominio oficial', result: 'ok', detail: `${domain} es un dominio oficial verificado de ${owner}` }
          : { name: 'Dominio oficial', result: 'unverified', detail: `${domain} no está en la lista de dominios oficiales verificados de empresas` },
      )
      if (owner) trusted.add(domain)
      const rep = extra[i]
      if (rep) {
        sources.push(...rep.sources)
        if (rep.trusted) trusted.add(domain)
      }
      const age = ages[i]!
      sources.push(
        age === null
          ? { name: 'Antigüedad del dominio', result: 'unavailable', detail: `No pudimos consultar ${domain}` }
          : {
              name: 'Antigüedad del dominio',
              result: age < YOUNG_DOMAIN_DAYS ? 'flag' : 'ok',
              detail: `${domain} se registró hace ${age} días`,
            },
      )
      const l = listed[i]!
      sources.push(
        l === null
          ? { name: 'Lista pública de phishing (OpenPhish)', result: 'unavailable', detail: 'La lista no respondió' }
          : {
              name: 'Lista pública de phishing (OpenPhish)',
              result: l ? 'flag' : 'ok',
              detail: l ? `${domain} está en la lista de sitios de phishing` : `${domain} no aparece en la lista`,
            },
      )
    })

    const reporters = await countOtherReporters(
      db,
      [...domains.map((d) => ({ kind: 'domain' as const, valueHash: hash('domain', d) })), ...phones.map((p) => ({ kind: 'phone' as const, valueHash: hash('phone', p) }))],
      userId,
    )
    if (domains.length + phones.length > 0) {
      sources.push({
        name: 'Reportes de la comunidad',
        result: reporters > 0 ? 'flag' : 'ok',
        detail: reporters > 0 ? `${reporters} persona(s) de la comunidad ya reportaron esto` : 'Nadie lo ha reportado todavía',
      })
    }

    // No existe una API pública de Policía/Fiscalía: se muestra como simulación, nunca como resultado real.
    sources.push({
      name: 'Policía / Fiscalía (CAI Virtual)',
      result: 'simulated',
      detail: 'Consulta simulada: no hay una API pública. En producción se conectaría a las bases oficiales',
    })
    return { sources, trusted }
  }

  function fallbackVerdict(risk: Risk, reasons: string[]): LlmVerdict {
    return {
      risk,
      confidence: risk === 'alto' ? 75 : risk === 'medio' ? 55 : 40,
      fraudType: risk === 'bajo' ? 'ninguno' : 'otro',
      summary:
        risk === 'bajo'
          ? 'No veo señales claras, pero no puedo estar seguro.'
          : 'Hay señales de posible estafa. Ten mucho cuidado.',
      reasons: reasons.slice(0, 3),
      advice: ['No hagas pagos ni des códigos', 'Verifica con la entidad por su número oficial'],
    }
  }

  // El cobro va PRIMERO (atómico, con candado de fila): sin saldo no se llama a la IA, y varias peticiones
  // simultáneas no pueden gastar más de lo que hay. Si el servicio falla, se devuelve con un reembolso.
  type Reservation = { ref: string; cost: number }

  async function reserve(userId: number, cost: number, channel: string): Promise<Reservation> {
    const ref = `analyze:${randomUUID()}`
    await db.transaction((tx) => spend(tx, userId, cost, `analyze_${channel}`, ref))
    return { ref, cost }
  }

  async function refund(userId: number, r: Reservation) {
    await db.transaction((tx) => grant(tx, userId, r.cost, 'refund', `refund:${r.ref}`))
  }

  const DOMAIN_FLAGS = ['dominio_imitador', 'tld_riesgoso', 'ip_directa', 'acortador']

  return {
    reserve,
    refund,
    async analyze(
      userId: number,
      text: string,
      opts: { cost: number; channel: 'web' | 'voice' | 'image'; reservation?: Reservation },
    ): Promise<AnalysisResult> {
      let reservation = opts.reservation ?? null
      let refunded = false
      const giveBack = async () => {
        if (!reservation || refunded) return
        refunded = true
        await refund(userId, reservation).catch((e) => console.error('No se pudo reembolsar:', e instanceof Error ? e.message : 'desconocido'))
      }

      try {
        await hit(db, `analyze:${userId}`, 20, 60, 'Vas muy rápido. Espera un momento')
        const user = await findUserById(db, userId)
        if (!user) throw unauthorized()
        reservation ??= await reserve(userId, opts.cost, opts.channel)

        const found = extract(text)
        const { sources, trusted } = await consultSources(found.domains, found.phones, userId, found.urls)
        // Si el dominio resultó ser de una empresa real (muy visitado, lleva a un sitio oficial o la empresa está activa
        // en el RUES), su parecido con una marca deja de contar como prueba de imitación.
        const signalsForRules = found.signals.filter((s) => !(s.key === 'dominio_imitador' && [...trusted].some((d) => s.label.includes(d))))
        const floor = assessRules(signalsForRules, sources)
        const signalLabels = signalsForRules.map((s) => s.label)

        let verdict: LlmVerdict | null = null
        if (llm) {
          try {
            verdict = await llm.classify({
              text,
              signals: signalLabels,
              sources: sources.map((s) => `${s.name}: ${s.detail}${s.result === 'simulated' ? ' (simulación)' : ''}`),
            })
          } catch (err) {
            console.error('Fallo del modelo de IA:', err instanceof Error ? err.message : 'desconocido')
          }
        }
        if (verdict?.offTopic) {
          await giveBack()
          throw new AppError(422, 'off_topic', 'Eso se sale de lo que hago: solo te ayudo a revisar si algo puede ser una estafa. Mándame el mensaje, enlace, captura o audio que te parezca raro.')
        }
        // Si la IA no respondió, se contesta con las reglas y no se cobra.
        if (!verdict) await giveBack()
        const base = verdict ?? fallbackVerdict(floor, signalLabels)

        // Las reglas objetivas nunca bajan el riesgo, solo pueden subirlo.
        const risk: Risk = RANK[floor] > RANK[base.risk] ? floor : base.risk
        const escalated = risk !== base.risk
        const confidence = Math.round(escalated ? Math.max(base.confidence, 75) : base.confidence)
        const level = levelFor(risk, floor)
        const summary = escalated ? 'Hay señales claras de posible estafa. Ten mucho cuidado.' : base.summary
        const fraudType = escalated && base.fraudType === 'ninguno' ? 'otro' : base.fraudType

        // Reputación comunitaria: solo con evidencia objetiva, nunca por el solo juicio de la IA sobre un texto
        // que escribe el usuario (si no, cualquiera podría marcar como "peligro" un negocio o a una persona).
        const flaggedBySource = (d: string) => sources.some((s) => s.result === 'flag' && s.detail.startsWith(d))
        const indicatorsToSave =
          risk === 'bajo'
            ? []
            : [
                ...found.domains
                  .filter((d) => extract(`https://${d}`).signals.some((s) => DOMAIN_FLAGS.includes(s.key)) || flaggedBySource(d))
                  .map((d) => ({ kind: 'domain' as const, valueHash: hash('domain', d), display: displayIndicator('domain', d) })),
                ...(risk === 'alto' && floor !== 'bajo'
                  ? found.phones.map((p) => ({ kind: 'phone' as const, valueHash: hash('phone', p), display: displayIndicator('phone', p) }))
                  : []),
              ]

        const caseId = await db.transaction(async (tx) => {
          const id = await insertCase(tx, {
            userId,
            channel: opts.channel,
            inputText: text,
            risk,
            confidence,
            level,
            fraudType,
            summary,
            reasons: base.reasons,
            advice: base.advice,
            sources,
            municipalityCode: user.municipalityCode,
            localityId: user.localityId,
          })
          await insertIndicators(tx, id, userId, indicatorsToSave)
          return id
        })

        return {
          caseId,
          risk,
          level,
          fraudType,
          summary,
          reasons: base.reasons,
          advice: base.advice,
          sources,
          // Cualquier sospecha mínima ofrece el reporte.
          offerReport: risk !== 'bajo',
          creditsLeft: await getBalance(db, userId),
        }
      } catch (err) {
        await giveBack()
        throw err
      }
    },
  }
}

export type AgentService = ReturnType<typeof createAgentService>
