import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema.ts'

export type Db = NodePgDatabase<typeof schema>
// Lo que aceptan los repositorios: la conexión normal o una transacción en curso.
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>

export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    // Corta consultas colgadas (postgres-patterns de ECC).
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  })
  const db: Db = drizzle(pool, { schema })
  return { db, pool }
}
