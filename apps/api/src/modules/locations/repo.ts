import { asc, eq, sql } from 'drizzle-orm'
import type { Executor } from '../../db/client.ts'
import { localities, municipalities } from '../../db/schema.ts'
import { normalizeText } from '../../lib/phone.ts'

export const BOGOTA_CODE = '11001'

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&')

/** Autocompletado: primero los que empiezan por el texto, luego los que lo contienen. */
export async function searchMunicipalities(ex: Executor, query: string, limit = 8) {
  const q = escapeLike(normalizeText(query))
  return ex
    .select({ code: municipalities.code, name: municipalities.name, dept: municipalities.dept })
    .from(municipalities)
    .where(sql`${municipalities.nameNorm} LIKE ${'%' + q + '%'}`)
    .orderBy(sql`(${municipalities.nameNorm} LIKE ${q + '%'}) DESC`, asc(municipalities.name))
    .limit(limit)
}

export async function municipalityExists(ex: Executor, code: string) {
  const [row] = await ex.select({ code: municipalities.code }).from(municipalities).where(eq(municipalities.code, code))
  return Boolean(row)
}

export async function listLocalities(ex: Executor) {
  return ex.select({ id: localities.id, name: localities.name }).from(localities).orderBy(asc(localities.id))
}

export async function localityExists(ex: Executor, id: number) {
  const [row] = await ex.select({ id: localities.id }).from(localities).where(eq(localities.id, id))
  return Boolean(row)
}
