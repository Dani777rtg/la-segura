import { and, desc, eq } from 'drizzle-orm'
import type { Executor } from '../../db/client.ts'
import { cases, localities, municipalities, reports } from '../../db/schema.ts'

export type Report = typeof reports.$inferSelect

export async function getOwnCase(ex: Executor, caseId: number, userId: number) {
  const [row] = await ex.select().from(cases).where(and(eq(cases.id, caseId), eq(cases.userId, userId)))
  return row
}

export async function locationNames(ex: Executor, municipalityCode: string, localityId: number | null) {
  const [m] = await ex
    .select({ name: municipalities.name, dept: municipalities.dept })
    .from(municipalities)
    .where(eq(municipalities.code, municipalityCode))
  const [l] = localityId
    ? await ex.select({ name: localities.name }).from(localities).where(eq(localities.id, localityId))
    : []
  return { municipality: m?.name ?? municipalityCode, department: m?.dept ?? '', locality: l?.name }
}

export async function findReportByCase(ex: Executor, caseId: number) {
  const [row] = await ex.select().from(reports).where(eq(reports.caseId, caseId))
  return row
}

export async function findReportOwned(ex: Executor, id: number, userId: number) {
  const [row] = await ex.select().from(reports).where(and(eq(reports.id, id), eq(reports.userId, userId)))
  return row
}

export async function findReportByCode(ex: Executor, code: string) {
  const [row] = await ex.select().from(reports).where(eq(reports.code, code))
  return row
}

export async function listReports(ex: Executor, userId: number) {
  return ex
    .select({ id: reports.id, code: reports.code, type: reports.type, caseId: reports.caseId, createdAt: reports.createdAt })
    .from(reports)
    .where(eq(reports.userId, userId))
    .orderBy(desc(reports.id))
    .limit(50)
}

export async function insertReport(ex: Executor, data: typeof reports.$inferInsert) {
  const [row] = await ex.insert(reports).values(data).onConflictDoNothing({ target: reports.caseId }).returning()
  return row
}
