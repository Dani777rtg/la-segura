import { sql } from 'drizzle-orm'
import type { Db } from '../../db/client.ts'

const BOGOTA = '11001'

type Overview = {
  windowDays: number
  minCell: number
  total: number
  bogotaTotal: number
  localities: Array<{ id: number; name: string; count: number | null }>
  municipalities: Array<{ code: string; name: string; dept: string; lat: number; lon: number; count: number }>
  byType: Array<{ fraudType: string; count: number }>
  daily: Array<{ date: string; count: number }>
  includesDemo: boolean
}

type Cell = { cell: string; count: number; people: number }
type Detail = { cell: string; fraud_type: string; day: string; n: number }

// Mapa territorial: solo conteos agregados y anónimos.
// Una celda se publica únicamente si reúne casos de al menos `minCell` PERSONAS distintas (no solo casos),
// y todos los totales, tipos y días se calculan SOLO con celdas visibles: así no se puede deducir
// el valor de una celda oculta restando (anonimato con supresión complementaria).
export function createTerritoryService(db: Db, minCell = 3, cacheSec = 0) {
  const WHERE = sql`c.created_at > now() - interval '30 days' AND c.risk <> 'bajo'`
  const CELL = sql`CASE WHEN c.municipality_code = ${BOGOTA} THEN 'L:' || coalesce(c.locality_id::text, '0') ELSE 'M:' || c.municipality_code END`

  // Caché de unos segundos con una sola consulta en vuelo: miles de personas viendo el mapa a la vez
  // cuestan una sola agregación en Postgres (en las pruebas de carga era el cuello de botella).
  let cached: { at: number; value: Promise<Overview> } | null = null

  async function compute(): Promise<Overview> {
      const [cellRows, detailRows, municipalityRows, localityRows, demo] = await Promise.all([
        db.execute(sql`
          SELECT ${CELL} AS cell, count(*)::int AS count, count(DISTINCT c.user_id)::int AS people
          FROM cases c WHERE ${WHERE} GROUP BY 1`),
        db.execute(sql`
          SELECT ${CELL} AS cell, c.fraud_type, to_char(c.created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS n
          FROM cases c WHERE ${WHERE} GROUP BY 1, 2, 3`),
        db.execute(sql`SELECT code, name, dept, lat, lon FROM municipalities WHERE lat IS NOT NULL`),
        db.execute(sql`SELECT id, name FROM localities ORDER BY id`),
        db.execute(sql`SELECT EXISTS (SELECT 1 FROM cases c JOIN users u ON u.id = c.user_id WHERE u.is_demo) AS has_demo`),
      ])

      const visible = new Map((cellRows.rows as Cell[]).filter((c) => c.people >= minCell).map((c) => [c.cell, c.count]))

      const localities = (localityRows.rows as Array<{ id: number; name: string }>).map((l) => ({
        ...l,
        count: visible.get(`L:${l.id}`) ?? null, // null = no hay suficientes personas distintas: no se publica
      }))
      const municipalities = (municipalityRows.rows as Array<{ code: string; name: string; dept: string; lat: number; lon: number }>)
        .filter((m) => m.code !== BOGOTA && visible.has(`M:${m.code}`))
        .map((m) => ({ ...m, count: visible.get(`M:${m.code}`)! }))

      // Tipos y días: únicamente a partir de celdas visibles.
      const byTypeMap = new Map<string, number>()
      const dailyMap = new Map<string, number>()
      for (const d of detailRows.rows as Detail[]) {
        if (!visible.has(d.cell)) continue
        byTypeMap.set(d.fraud_type, (byTypeMap.get(d.fraud_type) ?? 0) + d.n)
        dailyMap.set(d.day, (dailyMap.get(d.day) ?? 0) + d.n)
      }
      const today = new Date()
      const daily = Array.from({ length: 14 }, (_, i) => {
        const date = new Date(today.getTime() - (13 - i) * 86_400_000).toISOString().slice(0, 10)
        return { date, count: dailyMap.get(date) ?? 0 }
      })

      const bogotaTotal = localities.reduce((n, l) => n + (l.count ?? 0), 0)
      return {
        windowDays: 30,
        minCell,
        total: bogotaTotal + municipalities.reduce((n, m) => n + m.count, 0),
        bogotaTotal,
        localities,
        municipalities,
        byType: [...byTypeMap].map(([fraudType, count]) => ({ fraudType, count })).sort((a, b) => b.count - a.count),
        daily,
        includesDemo: Boolean((demo.rows[0] as { has_demo: boolean }).has_demo),
      }
  }

  return {
    overview(): Promise<Overview> {
      if (cacheSec <= 0) return compute()
      if (cached && Date.now() - cached.at < cacheSec * 1000) return cached.value
      const value = compute()
      cached = { at: Date.now(), value }
      // Si falla, no se guarda el error en la caché.
      value.catch(() => { if (cached?.value === value) cached = null })
      return value
    },

    /** Polígonos de las 20 localidades para pintar el mapa de Bogotá. */
    async bogotaGeoJson() {
      const rows = await db.execute(sql`SELECT id, name, geojson FROM localities WHERE geojson IS NOT NULL ORDER BY id`)
      return {
        type: 'FeatureCollection' as const,
        features: (rows.rows as Array<{ id: number; name: string; geojson: unknown }>).map((r) => ({
          type: 'Feature' as const,
          properties: { id: r.id, name: r.name },
          geometry: r.geojson,
        })),
      }
    },
  }
}

export type TerritoryService = ReturnType<typeof createTerritoryService>
