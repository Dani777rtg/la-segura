import { and, ne, or, sql, eq } from 'drizzle-orm'
import type { Executor } from '../../db/client.ts'
import { cases, indicators } from '../../db/schema.ts'
import type { IndicatorKind } from '../../lib/indicator.ts'

export type NewCase = typeof cases.$inferInsert
export type NewIndicator = { kind: IndicatorKind; valueHash: string; display: string }

export async function insertCase(ex: Executor, data: NewCase) {
  const [row] = await ex.insert(cases).values(data).returning({ id: cases.id })
  return row!.id
}

export async function insertIndicators(ex: Executor, caseId: number, userId: number, items: NewIndicator[]) {
  if (items.length === 0) return
  await ex
    .insert(indicators)
    .values(items.map((i) => ({ ...i, caseId, userId })))
    .onConflictDoNothing()
}

/** Cuántas personas distintas (aparte de quien consulta) reportaron alguno de estos indicadores. */
export async function countOtherReporters(
  ex: Executor,
  items: Array<{ kind: IndicatorKind; valueHash: string }>,
  excludeUserId: number,
) {
  if (items.length === 0) return 0
  const match = or(...items.map((i) => and(eq(indicators.kind, i.kind), eq(indicators.valueHash, i.valueHash))))
  const [row] = await ex
    .select({ n: sql<number>`count(distinct ${indicators.userId})::int` })
    .from(indicators)
    .where(and(match, ne(indicators.userId, excludeUserId)))
  return row?.n ?? 0
}
