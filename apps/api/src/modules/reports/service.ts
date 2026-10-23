import { randomBytes, randomUUID } from 'node:crypto'
import type { Config } from '../../config.ts'
import type { Db } from '../../db/client.ts'
import type { LlmGateway } from '../../gateways/llm.ts'
import { AppError, conflict } from '../../lib/errors.ts'
import { findUserById } from '../auth/repo.ts'
import { extract } from '../agent/signals.ts'
import { COST } from '../credits/costs.ts'
import { grant, spend } from '../credits/repo.ts'
import { levelFromRisk } from '../agent/level.ts'
import { reportTypeForFraud, TYPE_LABEL, type ReportType } from './guidance.ts'
import { appendEntry, canonicalJson, sha256, verifyReport } from './ledger.ts'
import type { ReportPayload } from './payload.ts'
import { renderReportPdf } from './pdf.ts'
import * as repo from './repo.ts'

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789' // sin letras ni números que se confunden

function newCode() {
  const bytes = randomBytes(10)
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
  return `PS-${chars.slice(0, 5)}-${chars.slice(5)}`
}

export type CreateReportInput = {
  caseId: number
  type?: ReportType
  occurredAt?: string
  channel?: string
  amountCop?: number
  details?: string
}

export type ReportDeps = { db: Db; llm: LlmGateway | null; config: Config }

export function createReportService({ db, llm, config }: ReportDeps) {
  const verifyUrl = (code: string) => `${config.PUBLIC_BASE_URL}/certificado/${code}`

  async function narrative(p: Omit<ReportPayload, 'narrative'>): Promise<string> {
    const fallback =
      `Yo, ${p.reporter.name}, reporto que recibí un mensaje que parece un intento de fraude (${TYPE_LABEL[p.type].toLowerCase()}). ` +
      `${p.analysis.summary} ` +
      (p.amountCop ? `Como consecuencia, perdí $${p.amountCop.toLocaleString('es-CO')} COP. ` : 'No reporto pérdida de dinero. ') +
      (p.details ? `Detalles: ${p.details}` : '')
    if (!llm) return fallback.trim()
    try {
      return await llm.narrate({
        reporterName: p.reporter.name,
        fraudType: TYPE_LABEL[p.type],
        location: [p.location.locality, p.location.municipality].filter(Boolean).join(', '),
        receivedText: p.receivedText,
        occurredAt: p.occurredAt,
        channel: p.channel,
        amountCop: p.amountCop,
        details: p.details,
      })
    } catch (err) {
      console.error('Fallo al redactar el relato:', err instanceof Error ? err.message : 'desconocido')
      return fallback.trim()
    }
  }

  return {
    async create(userId: number, input: CreateReportInput) {
      const found = await repo.getOwnCase(db, input.caseId, userId)
      if (!found) throw new AppError(404, 'case_not_found', 'No encontramos ese caso')

      // Idempotente: pedir dos veces el reporte del mismo caso devuelve el existente sin cobrar otra vez.
      const existing = await repo.findReportByCase(db, found.id)
      if (existing) return { id: existing.id, code: existing.code, created: false }

      // El cobro va primero y es atómico (402 si no alcanza); si algo falla después, se reembolsa.
      const spendRef = `report:${found.id}:${randomUUID()}`
      await db.transaction((tx) => spend(tx, userId, COST.pdfReport, 'pdf_report', spendRef))
      try {
        const user = (await findUserById(db, userId))!
      const place = await repo.locationNames(db, found.municipalityCode, found.localityId)
      const ev = extract(found.inputText)
      const type = input.type ?? reportTypeForFraud(found.fraudType)
      const code = newCode()

      const base: Omit<ReportPayload, 'narrative'> = {
        v: 1,
        code,
        type,
        createdAt: new Date().toISOString(),
        reporter: { name: user.name },
        location: { municipality: place.municipality, department: place.department, locality: place.locality },
        analysis: { caseId: found.id, risk: found.risk, level: found.level ?? levelFromRisk(found.risk), fraudType: found.fraudType, summary: found.summary },
        occurredAt: input.occurredAt,
        channel: input.channel,
        amountCop: input.amountCop,
        details: input.details,
        evidence: { domains: ev.domains, phones: ev.phones },
        receivedText: found.inputText,
      }
      const payload = canonicalJson({ ...base, narrative: await narrative(base) })

      const report = await db.transaction(async (tx) => {
        const row = await repo.insertReport(tx, {
          code,
          caseId: found.id,
          userId,
          type,
          payload,
          payloadHash: sha256(payload),
        })
        if (!row) throw conflict('report_exists', 'Ese caso ya tiene un reporte')
        await appendEntry(tx, row.id, row.payloadHash)
        return row
      })
      return { id: report.id, code: report.code, created: true }
      } catch (err) {
        await db.transaction((tx) => grant(tx, userId, COST.pdfReport, 'refund', `refund:${spendRef}`))
        throw err
      }
    },

    list: (userId: number) => repo.listReports(db, userId),

    async pdf(userId: number, id: number) {
      const report = await repo.findReportOwned(db, id, userId)
      if (!report) throw new AppError(404, 'report_not_found', 'No encontramos ese reporte')
      const verification = await verifyReport(db, report.code)
      if (!verification) throw new AppError(500, 'ledger_missing', 'Falta el registro de este reporte')
      const buffer = await renderReportPdf(JSON.parse(report.payload) as ReportPayload, verification, verifyUrl(report.code))
      return { buffer, code: report.code }
    },

    /** Datos públicos del certificado: sin nombre, sin relato, sin números ni texto original. */
    async publicCertificate(code: string) {
      const report = await repo.findReportByCode(db, code)
      if (!report) return null
      const verification = await verifyReport(db, code)
      if (!verification) return null
      const p = JSON.parse(report.payload) as ReportPayload
      return {
        code,
        type: p.type,
        typeLabel: TYPE_LABEL[p.type],
        issuedAt: p.createdAt,
        location: [p.location.locality, p.location.municipality].filter(Boolean).join(', '),
        verification,
      }
    },
  }
}

export type ReportService = ReturnType<typeof createReportService>
