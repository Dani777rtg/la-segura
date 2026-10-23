import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import { createDb } from './client.ts'

export async function runMigrations(connectionString: string) {
  const { db, pool } = createDb(connectionString)
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
  } finally {
    await pool.end()
  }
}
