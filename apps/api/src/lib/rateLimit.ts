import { sql } from 'drizzle-orm'
import type { Executor } from '../db/client.ts'
import { tooMany } from './errors.ts'

// Ventana fija en Postgres: el estado se comparte entre instancias de Cloud Run
// (security-review y backend-patterns de ECC: nada de contadores en memoria).
// Cuenta el intento y lanza 429 si se supera `max` dentro de `windowSec`.
export async function hit(db: Executor, key: string, max: number, windowSec: number, message: string) {
  const res = await db.execute(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      window_start = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => ${windowSec})
                          THEN now() ELSE rate_limits.window_start END,
      count = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => ${windowSec})
                   THEN 1 ELSE rate_limits.count + 1 END
    RETURNING count, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => ${windowSec}) - now())))::int AS retry_after
  `)
  const row = res.rows[0] as { count: number; retry_after: number }
  if (row.count > max) throw tooMany(message, Math.max(row.retry_after, 1))
}
