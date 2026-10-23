import { createHash } from 'node:crypto'
import { asc, desc, eq, sql } from 'drizzle-orm'
import type { Executor } from '../../db/client.ts'
import { ledgerEntries, reports } from '../../db/schema.ts'

export const GENESIS_HASH = '0'.repeat(64)
// Clave del candado que serializa las escrituras en la cadena.
const LEDGER_LOCK = 7_430_001

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** JSON con las llaves ordenadas: el mismo contenido siempre produce el mismo texto y el mismo hash. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const computeEntryHash = (idx: number, prevHash: string, payloadHash: string, createdAt: Date) =>
  sha256(`${idx}|${prevHash}|${payloadHash}|${createdAt.toISOString()}`)

/** Agrega una entrada al final de la cadena. Debe llamarse dentro de una transacción. */
export async function appendEntry(ex: Executor, reportId: number, payloadHash: string) {
  // Un candado por transacción evita que dos reportes simultáneos tomen el mismo "anterior".
  await ex.execute(sql`SELECT pg_advisory_xact_lock(${LEDGER_LOCK})`)
  const [last] = await ex.select().from(ledgerEntries).orderBy(desc(ledgerEntries.idx)).limit(1)
  const idx = (last?.idx ?? 0) + 1
  const prevHash = last?.entryHash ?? GENESIS_HASH
  const createdAt = new Date()
  const entryHash = computeEntryHash(idx, prevHash, payloadHash, createdAt)
  await ex.insert(ledgerEntries).values({ idx, reportId, payloadHash, prevHash, entryHash, createdAt })
  return { idx, prevHash, entryHash, createdAt }
}

export type Verification = {
  valid: boolean
  idx: number
  entryHash: string
  prevHash: string
  payloadHash: string
  recordedAt: string
  /** Hash de la última entrada: cualquier cambio anterior lo altera. */
  headHash: string
  totalEntries: number
  problem?: string
}

/**
 * Recalcula todo desde cero: el hash del contenido del reporte, el hash de la entrada
 * y el encadenamiento completo hasta el inicio. No confía en nada de lo almacenado.
 */
export async function verifyReport(ex: Executor, code: string): Promise<Verification | null> {
  const [report] = await ex.select().from(reports).where(eq(reports.code, code))
  if (!report) return null

  const chain = await ex.select().from(ledgerEntries).orderBy(asc(ledgerEntries.idx))
  const target = chain.find((e) => e.reportId === report.id)
  if (!target) return null

  let problem: string | undefined
  if (sha256(report.payload) !== report.payloadHash || report.payloadHash !== target.payloadHash) {
    problem = 'El contenido del reporte no coincide con su huella'
  }
  let prev = GENESIS_HASH
  for (const e of chain) {
    if (e.prevHash !== prev || computeEntryHash(e.idx, e.prevHash, e.payloadHash, e.createdAt) !== e.entryHash) {
      problem ??= `La cadena está alterada en la entrada ${e.idx}`
    }
    prev = e.entryHash
  }

  return {
    valid: !problem,
    idx: target.idx,
    entryHash: target.entryHash,
    prevHash: target.prevHash,
    payloadHash: target.payloadHash,
    recordedAt: target.createdAt.toISOString(),
    headHash: prev,
    totalEntries: chain.length,
    problem,
  }
}
