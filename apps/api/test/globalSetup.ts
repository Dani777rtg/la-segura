import { createDb } from '../src/db/client.ts'
import { runMigrations } from '../src/db/migrate.ts'
import { localities, municipalities } from '../src/db/schema.ts'

const URL = 'postgres://parcero:parcero_dev_only@127.0.0.1:15432/parcero_test'

export default async function setup() {
  await runMigrations(URL)
  const { db, pool } = createDb(URL)
  await db
    .insert(municipalities)
    .values([
      { code: '11001', deptCode: '11', dept: 'BOGOTÁ, D.C.', name: 'BOGOTÁ, D.C.', nameNorm: 'bogota, d.c.' },
      { code: '05001', deptCode: '05', dept: 'ANTIOQUIA', name: 'MEDELLÍN', nameNorm: 'medellin' },
      { code: '05002', deptCode: '05', dept: 'ANTIOQUIA', name: 'ABEJORRAL', nameNorm: 'abejorral' },
    ])
    .onConflictDoNothing()
  await db.insert(localities).values([{ id: 7, name: 'Bosa' }, { id: 8, name: 'Kennedy' }]).onConflictDoNothing()
  await pool.end()
}
