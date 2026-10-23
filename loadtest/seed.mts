// Siembra la BD AISLADA parcero_load (solo local, sin red externa): migraciones, municipios/localidades sintéticos,
// datos demo (reutiliza seed-demo del repo), usuarios sintéticos con saldo y tokens de sesión firmados.
// Uso (desde apps/api):  node --import tsx ../../loadtest/seed.mts [numUsuarios=50000]
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import jwt from 'jsonwebtoken'
import { sql } from 'drizzle-orm'
import { createDb } from '../apps/api/src/db/client.ts'
import { runMigrations } from '../apps/api/src/db/migrate.ts'
import { hashPassword } from '../apps/api/src/lib/password.ts'
import { normalizeText } from '../apps/api/src/lib/phone.ts'

const URL_DB = 'postgres://parcero:parcero_dev_only@127.0.0.1:15432/parcero_load'
const u = new URL(process.env.DATABASE_URL ?? URL_DB)
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.pathname !== '/parcero_load') {
  console.error('ABORTADO: solo contra localhost / parcero_load')
  process.exit(1)
}
const N = Number(process.argv[2] ?? 50000)
const HOT = 500
const JWT_SECRET = 'jwt-secret-solo-para-pruebas-de-carga-locales-0123456789'
const LOGIN_PASSWORD = 'clave-segura-1'

await runMigrations(u.toString())
const { db, pool } = createDb(u.toString())

// Municipios: 14 reales (nombre y código DIVIPOLA) + sintéticos hasta 1.122.
const REAL: Array<[string, string, string, number, number]> = [
  ['11001', 'Bogotá, D.C.', 'Bogotá D.C.', 4.711, -74.0721],
  ['05001', 'Medellín', 'Antioquia', 6.2442, -75.5812],
  ['76001', 'Cali', 'Valle del Cauca', 3.4516, -76.532],
  ['08001', 'Barranquilla', 'Atlántico', 10.9685, -74.7813],
  ['13001', 'Cartagena de Indias', 'Bolívar', 10.391, -75.4794],
  ['68001', 'Bucaramanga', 'Santander', 7.1254, -73.1198],
  ['54001', 'Cúcuta', 'Norte de Santander', 7.8939, -72.5078],
  ['25754', 'Soacha', 'Cundinamarca', 4.5794, -74.2168],
  ['66001', 'Pereira', 'Risaralda', 4.8133, -75.6961],
  ['47001', 'Santa Marta', 'Magdalena', 11.2408, -74.199],
  ['73001', 'Ibagué', 'Tolima', 4.4389, -75.2322],
  ['50001', 'Villavicencio', 'Meta', 4.142, -73.6266],
  ['17001', 'Manizales', 'Caldas', 5.0703, -75.5138],
  ['52001', 'Pasto', 'Nariño', 1.2136, -77.2811],
]
const rows = REAL.map(([code, name, dept, lat, lon]) => ({ code, deptCode: code.slice(0, 2), dept, name, lat, lon }))
for (let i = rows.length; i < 1122; i++) {
  const d = 5 + (i % 30)
  rows.push({
    code: String(d).padStart(2, '0') + String(100 + i).padStart(3, '0'),
    deptCode: String(d).padStart(2, '0'),
    dept: `Departamento ${d}`,
    name: `Municipio Sintético ${i}`,
    lat: 1 + (i % 100) / 10,
    lon: -77 + (i % 70) / 10,
  })
}
for (let i = 0; i < rows.length; i += 200) {
  const part = rows.slice(i, i + 200)
  const json = JSON.stringify(part.map((r) => ({ ...r, norm: normalizeText(r.name) })))
  await db.execute(sql`INSERT INTO municipalities (code, dept_code, dept, name, name_norm, lat, lon)
    SELECT code, "deptCode", dept, name, norm, lat, lon FROM jsonb_to_recordset(${json}::jsonb) AS x(code text, "deptCode" text, dept text, name text, norm text, lat float8, lon float8)
    ON CONFLICT DO NOTHING`)
}

// Localidades de Bogotá con los polígonos oficiales del repo (archivo local, sin red).
const LOCS = ['Usaquén', 'Chapinero', 'Santa Fe', 'San Cristóbal', 'Usme', 'Tunjuelito', 'Bosa', 'Kennedy', 'Fontibón', 'Engativá', 'Suba', 'Barrios Unidos', 'Teusaquillo', 'Los Mártires', 'Antonio Nariño', 'Puente Aranda', 'La Candelaria', 'Rafael Uribe Uribe', 'Ciudad Bolívar', 'Sumapaz']
for (let i = 0; i < LOCS.length; i++) await db.execute(sql`INSERT INTO localities (id, name) VALUES (${i + 1}, ${LOCS[i]}) ON CONFLICT DO NOTHING`)
type Esri = { attributes: { LocCodigo: string }; geometry: { rings: number[][][] } }
const esri = JSON.parse(readFileSync(fileURLToPath(new URL('../apps/api/data/loca.json', import.meta.url)), 'utf8')) as { features: Esri[] }
const r4 = (n: number) => Math.round(n * 1e4) / 1e4
for (const f of esri.features) {
  const polys = f.geometry.rings.map((ring) => {
    const pts = ring.map(([x, y]) => [r4(x!), r4(y!)] as [number, number])
    return [pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1]![0] || p[1] !== pts[i - 1]![1])]
  })
  await db.execute(sql`UPDATE localities SET geojson = ${JSON.stringify({ type: 'MultiPolygon', coordinates: polys })}::jsonb WHERE id = ${Number(f.attributes.LocCodigo)}`)
}

// Datos demo del repo (420 casos y 12 publicaciones sintéticos) contra parcero_load.
execFileSync(process.execPath, ['--import', 'tsx', 'src/db/seed-demo.ts'], {
  cwd: fileURLToPath(new URL('../apps/api', import.meta.url)),
  env: { ...process.env, DATABASE_URL: u.toString() },
  stdio: 'inherit',
})

// Usuarios sintéticos: 573 + 9 dígitos. Normales: saldo 100.000. Calientes (libro de créditos): saldo 10.
const hash = await hashPassword(LOGIN_PASSWORD)
await db.execute(sql`DELETE FROM users WHERE phone LIKE '573%' AND is_demo = false`)
await db.execute(sql`INSERT INTO users (phone, name, password_hash, municipality_code, locality_id, phone_verified_at, is_demo)
  SELECT '573' || lpad(i::text, 9, '0'), 'Usuario Carga ' || i, ${hash}, CASE WHEN i % 3 = 0 THEN '11001' WHEN i % 3 = 1 THEN '05001' ELSE '76001' END,
         CASE WHEN i % 3 = 0 THEN 1 + (i % 20) END::smallint, now(), false
  FROM generate_series(1, ${N}) i`)
await db.execute(sql`INSERT INTO users (phone, name, password_hash, municipality_code, locality_id, phone_verified_at, is_demo)
  SELECT '5739' || lpad(i::text, 8, '0'), 'Usuario Caliente ' || i, ${hash}, '11001', (1 + (i % 20))::smallint, now(), false
  FROM generate_series(1, ${HOT}) i`)
await db.execute(sql`INSERT INTO credit_accounts (user_id, balance) SELECT id, CASE WHEN phone LIKE '5739%' THEN 10 ELSE 100000 END FROM users WHERE is_demo = false`)
await db.execute(sql`INSERT INTO credit_ledger (user_id, delta, reason, ref) SELECT id, CASE WHEN phone LIKE '5739%' THEN 10 ELSE 100000 END, 'seed', 'seed:' || id FROM users WHERE is_demo = false`)

const ids = (await db.execute(sql`SELECT id, phone FROM users WHERE is_demo = false ORDER BY phone`)).rows as Array<{ id: string; phone: string }>
const tok = (id: string) => jwt.sign({}, JWT_SECRET, { algorithm: 'HS256', subject: String(id), expiresIn: '30d' })
const normal = ids.filter((r) => !r.phone.startsWith('5739'))
const hot = ids.filter((r) => r.phone.startsWith('5739'))
writeFileSync(
  fileURLToPath(new URL('./data/users.json', import.meta.url)),
  JSON.stringify({
    tokens: normal.map((r) => tok(r.id)),
    hot: hot.map((r) => ({ id: Number(r.id), token: tok(r.id) })),
    loginPhones: normal.slice(0, 2000).map((r) => r.phone.slice(2)),
    password: LOGIN_PASSWORD,
  }),
)
await db.execute(sql`TRUNCATE rate_limits`)
await db.execute(sql`ANALYZE`)
console.log(`Listo: ${normal.length} usuarios normales, ${hot.length} calientes`)
await pool.end()
