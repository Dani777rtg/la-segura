import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { loadConfigForScripts } from './seed-config.ts'
import { createDb } from './client.ts'
import { localities, municipalities } from './schema.ts'
import { normalizeText } from '../lib/phone.ts'

// Localidades oficiales de Bogotá (numeración del Distrito).
const BOGOTA_LOCALITIES = [
  'Usaquén', 'Chapinero', 'Santa Fe', 'San Cristóbal', 'Usme', 'Tunjuelito', 'Bosa', 'Kennedy', 'Fontibón',
  'Engativá', 'Suba', 'Barrios Unidos', 'Teusaquillo', 'Los Mártires', 'Antonio Nariño', 'Puente Aranda',
  'La Candelaria', 'Rafael Uribe Uribe', 'Ciudad Bolívar', 'Sumapaz',
]

type DivipolaRow = { cod_dpto: string; dpto: string; cod_mpio: string; nom_mpio: string; latitud?: string; longitud?: string }

// DIVIPOLA en datos.gov.co: 1.122 municipios con código, departamento y coordenadas.
async function fetchMunicipalities(appToken?: string): Promise<DivipolaRow[]> {
  const res = await fetch('https://www.datos.gov.co/resource/gdxc-w37w.json?$limit=2000', {
    headers: appToken ? { 'X-App-Token': appToken } : {},
  })
  if (!res.ok) throw new Error(`datos.gov.co respondió ${res.status}`)
  return (await res.json()) as DivipolaRow[]
}

const num = (v?: string) => (v ? Number(v.replace(',', '.')) : null)

const { databaseUrl, datosGovToken } = loadConfigForScripts()
const { db, pool } = createDb(databaseUrl)

const rows = await fetchMunicipalities(datosGovToken)
for (let i = 0; i < rows.length; i += 200) {
  await db
    .insert(municipalities)
    .values(
      rows.slice(i, i + 200).map((r) => ({
        code: r.cod_mpio,
        deptCode: r.cod_dpto,
        dept: r.dpto,
        name: r.nom_mpio,
        nameNorm: normalizeText(r.nom_mpio),
        lat: num(r.latitud),
        lon: num(r.longitud),
      })),
    )
    .onConflictDoNothing()
}
await db
  .insert(localities)
  .values(BOGOTA_LOCALITIES.map((name, i) => ({ id: i + 1, name })))
  .onConflictDoNothing()

// Polígonos oficiales (datosabiertos.bogota.gov.co, CC-BY 4.0): JSON de Esri → GeoJSON simplificado.
type EsriFeature = { attributes: { LocCodigo: string }; geometry: { rings: number[][][] } }
const esri = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/loca.json', import.meta.url)), 'utf8')) as {
  features: EsriFeature[]
}
const round = (n: number) => Math.round(n * 1e4) / 1e4
for (const f of esri.features) {
  const polygons = f.geometry.rings.map((ring) => {
    const pts = ring.map(([x, y]) => [round(x!), round(y!)] as [number, number])
    return [pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1]![0] || p[1] !== pts[i - 1]![1])]
  })
  await db
    .update(localities)
    .set({ geojson: { type: 'MultiPolygon', coordinates: polygons } })
    .where(eq(localities.id, Number(f.attributes.LocCodigo)))
}

console.log(`Sembrados ${rows.length} municipios y ${BOGOTA_LOCALITIES.length} localidades`)
await pool.end()
