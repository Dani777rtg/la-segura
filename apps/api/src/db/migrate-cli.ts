import { sql } from 'drizzle-orm'
import { loadConfig } from '../config.ts'
import { createDb } from './client.ts'
import { runMigrations } from './migrate.ts'

const { DATABASE_URL } = loadConfig()
await runMigrations(DATABASE_URL)
console.log('Migraciones aplicadas')

// Producción: la app corre con un usuario sin privilegios de propietario (hallazgo A-06 de la auditoría).
// Puede leer y escribir datos, pero NO modificar, borrar ni vaciar el registro de reportes y su cadena de hashes.
const appUser = process.env.APP_DB_USER
if (appUser) {
  if (!/^[a-z_][a-z0-9_]*$/.test(appUser)) throw new Error('APP_DB_USER inválido')
  const { db, pool } = createDb(DATABASE_URL)
  const user = sql.raw(`"${appUser}"`)
  // Cloud SQL crea los usuarios como miembros de cloudsqlsuperuser: se le quita a la cuenta de la app (si no se puede, no es fatal).
  await db.execute(sql`REVOKE cloudsqlsuperuser FROM ${user}`).catch(() => console.log('Aviso: no se pudo revocar cloudsqlsuperuser (puede no existir en este servidor)'))
  await db.execute(sql`ALTER ROLE ${user} NOCREATEROLE NOCREATEDB`).catch(() => undefined)
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO ${user}`)
  await db.execute(sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${user}`)
  await db.execute(sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${user}`)
  await db.execute(sql`REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries, reports FROM ${user}`)
  await pool.end()
  console.log(`Permisos aplicados a ${appUser}`)
}
