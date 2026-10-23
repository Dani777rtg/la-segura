import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { cases, localities, users } from '../src/db/schema.ts'
import { redactPersonalData } from '../src/modules/feed/service.ts'
import { createTerritoryService } from '../src/modules/territory/service.ts'
import { createTestApp } from './helpers.ts'

const ctx = await createTestApp()
const { app, whatsapp, llm, checks, db } = ctx

let ip = 0
async function signup(phone: string, name = 'Ana Gómez', municipalityCode = '05001') {
  const remoteAddress = `10.4.0.${++ip}`
  const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload, remoteAddress })
  await post('/api/auth/register', { name, phone, password: 'clave-segura-1', municipalityCode })
  const res = await post('/api/auth/verify', { phone, code: whatsapp.sent.at(-1)!.code })
  return res.cookies.find((c) => c.name === 'ps_session')!.value
}
const as = (cookie: string) => ({ ps_session: cookie })
const publish = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/posts', cookies: as(cookie), payload })
const feed = async (cookie: string) => (await app.inject({ method: 'GET', url: '/api/posts', cookies: as(cookie) })).json()

beforeEach(async () => {
  whatsapp.reset()
  llm.moderation = null
  checks.phishing.clear()
  llm.next = { risk: 'alto', confidence: 85, fraudType: 'suplantacion_entidad', summary: 'Estafa.', reasons: [], advice: [] }
  await ctx.reset()
})
afterAll(ctx.close)

const TEXT = 'Me llamaron al 300 000 0001 diciendo que eran del banco y pidieron mi clave, escribe a juan@correo.com'

describe('feed', () => {
  it('quita celulares y correos antes de guardar', async () => {
    const cookie = await signup('3001112233')
    const res = await publish(cookie, { kind: 'intentaron', text: TEXT })
    expect(res.statusCode).toBe(201)
    expect(res.json().body).not.toContain('3000000001')
    expect(res.json().body).not.toContain('300 000 0001')
    expect(res.json().body).not.toContain('juan@correo.com')
    expect(res.json().body).toContain('5731•••••719')
  })

  it('si el moderador falla NO se publica nada (falla cerrado)', async () => {
    llm.moderation = new Error('moderador caído')
    const cookie = await signup('3001112233')
    const res = await publish(cookie, { kind: 'intentaron', text: TEXT })
    expect(res.statusCode).toBe(503)
    expect(await db.query.posts.findMany()).toHaveLength(0)
  })

  it('la depuración cubre cédulas con puntos, cuentas con guiones, teléfonos con paréntesis y enlaces', () => {
    const out = redactPersonalData('Mi cédula 1.020.345.678, cel 300 000 0001, mail a@b.co, cuenta 12-345-678901, +57 (314) 617-8719, visita http://phish.example/x?id=1')
    for (const leak of ['1.020.345.678', '12-345-678901', '(314) 617-8719', 'a@b.co', 'http://', '/x?id=1']) expect(out).not.toContain(leak)
    expect(out).toContain('[enlace: phish.example]')
    expect(out).toContain('[número]')
  })

  it('el moderador puede rechazar y entonces no se guarda nada', async () => {
    llm.moderation = { allowed: false, text: '', reason: 'No publicamos insultos' }
    const cookie = await signup('3001112233')
    const res = await publish(cookie, { kind: 'estafaron', text: 'Es un ladrón de mala muerte' })
    expect(res.statusCode).toBe(422)
    expect(res.json().message).toBe('No publicamos insultos')
    expect(await db.query.posts.findMany()).toHaveLength(0)
  })

  it('publica el texto reescrito por el moderador', async () => {
    llm.moderation = { allowed: true, text: 'Texto limpio de nombres.', reason: '' }
    const cookie = await signup('3001112233')
    expect((await publish(cookie, { kind: 'estafaron', text: 'Pedro Pérez me estafó con una tienda falsa' })).json().body).toBe('Texto limpio de nombres.')
  })

  it('el muro es anónimo: muestra "Un vecino", el lugar y las confirmaciones, nunca el nombre', async () => {
    const a = await signup('3001112233', 'María Fernanda Pérez')
    const b = await signup('3004445566', 'Luis Mora')
    await publish(a, { kind: 'intentaron', text: 'Me escribieron por WhatsApp haciéndose pasar por Nequi' })
    const id = (await feed(b)).items[0].id
    expect((await app.inject({ method: 'POST', url: `/api/posts/${id}/confirm`, cookies: as(b) })).statusCode).toBe(204)
    expect((await app.inject({ method: 'POST', url: `/api/posts/${id}/confirm`, cookies: as(b) })).statusCode).toBe(204) // idempotente

    const item = (await feed(b)).items[0]
    expect(item).toMatchObject({ author: 'Un vecino', place: 'MEDELLÍN', confirms: 1, confirmedByMe: true, mine: false, demo: false })
    expect(JSON.stringify(item)).not.toContain('María')
    expect(JSON.stringify(item)).not.toContain('Pérez')
    expect(JSON.stringify(item)).not.toContain('3001112233')

    await app.inject({ method: 'DELETE', url: `/api/posts/${id}/confirm`, cookies: as(b) })
    expect((await feed(b)).items[0].confirms).toBe(0)
  })

  it('muestra primero lo del municipio de quien mira y pagina sin repetir ni perder publicaciones', async () => {
    const local = await signup('3001110001', 'Ana Gómez')
    const far = await signup('3001110002', 'Luis Pérez', '05002')
    await publish(local, { kind: 'intentaron', text: 'Me llegó un mensaje falso del banco con un enlace raro, cuidado vecinos' })
    for (let i = 0; i < 3; i++) await publish(far, { kind: 'intentaron', text: `Mensaje falso número ${i} de una tienda que no existe, cuidado` })
    const page = await feed(local)
    expect(page.area).toBe('MEDELLÍN')
    expect(page.items[0].near).toBe(true) // la de Medellín va primero aunque sea la más vieja
    expect(page.items.slice(1).every((p: { near: boolean }) => !p.near)).toBe(true)
    // El cursor sigue el mismo orden: después de la publicación cercana vienen las 3 lejanas, sin repetir.
    const next = (await app.inject({ method: 'GET', url: `/api/posts?before=2_${page.items[0].id}`, cookies: as(local) })).json()
    expect(next.items.map((p: { id: number }) => p.id)).toEqual(page.items.slice(1).map((p: { id: number }) => p.id))
    const afterFar = (await app.inject({ method: 'GET', url: `/api/posts?before=1_${page.items[2].id}`, cookies: as(local) })).json()
    expect(afterFar.items.map((p: { id: number }) => p.id)).toEqual([page.items[3].id])
    expect((await app.inject({ method: 'GET', url: '/api/posts?before=9_abc', cookies: as(local) })).statusCode).toBe(400)
  })

  it('mi perfil muestra solo lo que yo publiqué', async () => {
    const ana = await signup('3001110011', 'Ana Gómez')
    const luis = await signup('3001110012', 'Luis Pérez')
    await publish(ana, { kind: 'intentaron', text: 'Me llegó un mensaje falso del banco, cuidado vecinos del barrio' })
    await publish(luis, { kind: 'estafaron', text: 'Me estafaron con una tienda falsa de celulares en internet' })
    const mine = (await app.inject({ method: 'GET', url: '/api/posts/mine', cookies: as(ana) })).json()
    expect(mine.items).toHaveLength(1)
    expect(mine.items[0]).toMatchObject({ mine: true, author: 'Tú' })
    expect((await app.inject({ method: 'GET', url: '/api/posts/mine' })).statusCode).toBe(401)
  })

  it('no puedes confirmar ni borrar lo de otra persona', async () => {
    const a = await signup('3001112233')
    const b = await signup('3004445566')
    await publish(a, { kind: 'intentaron', text: 'Me escribieron por WhatsApp haciéndose pasar por Nequi' })
    const id = (await feed(a)).items[0].id
    expect((await app.inject({ method: 'POST', url: `/api/posts/${id}/confirm`, cookies: as(a) })).statusCode).toBe(400)
    expect((await app.inject({ method: 'DELETE', url: `/api/posts/${id}`, cookies: as(b) })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/posts/${id}`, cookies: as(a) })).statusCode).toBe(204)
    expect((await feed(a)).items).toHaveLength(0)
  })

  it('exige sesión y limita la frecuencia de publicación', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/posts' })).statusCode).toBe(401)
    const cookie = await signup('3001112233')
    for (let i = 0; i < 10; i++) expect((await publish(cookie, { kind: 'intentaron', text: `Intento de estafa número ${i} por mensaje` })).statusCode).toBe(201)
    expect((await publish(cookie, { kind: 'intentaron', text: 'Otro intento de estafa por mensaje' })).statusCode).toBe(429)
  })
})

describe('publicar un caso analizado como alerta', () => {
  const SCAM_CASE = 'Bancolombia: confirma tu clave dinámica en https://bancolombia-seguro.xyz o llama al 300 000 0001 ya mismo'
  const analyzeCase = async (cookie: string) =>
    (await app.inject({ method: 'POST', url: '/api/analyze', cookies: as(cookie), payload: { text: SCAM_CASE } })).json().caseId as number
  const publishCase = (cookie: string, id: number) => app.inject({ method: 'POST', url: `/api/cases/${id}/publish`, cookies: as(cookie) })

  it('publica el mensaje que le llegó (sin datos personales), anónimo y una sola vez por caso', async () => {
    const a = await signup('3001112233', 'María Fernanda Pérez')
    const b = await signup('3004445566')
    const caseId = await analyzeCase(a)
    const first = await publishCase(a, caseId)
    expect(first.statusCode).toBe(201)
    expect(first.json().body).toContain('Me llegó este mensaje')
    expect(first.json().body).toContain('[enlace: bancolombia-seguro.xyz]') // se ve el dominio, sin enlace que se pueda abrir
    expect(first.json().body).not.toContain('3000000001')
    expect(first.json().body).not.toContain('https://')
    expect((await publishCase(a, caseId)).statusCode).toBe(200)
    expect(await db.query.posts.findMany()).toHaveLength(1)

    const item = (await feed(b)).items[0]
    expect(item.author).toBe('Un vecino')
    expect(JSON.stringify(item)).not.toContain('María')
  })

  it('no se puede publicar el caso de otra persona ni un caso sin señales de estafa', async () => {
    const a = await signup('3001112233')
    const b = await signup('3004445566')
    const caseId = await analyzeCase(a)
    expect((await publishCase(b, caseId)).statusCode).toBe(404)
    llm.next = { risk: 'bajo', confidence: 70, fraudType: 'ninguno', summary: 'Normal.', reasons: [], advice: [] }
    const calm = (await app.inject({ method: 'POST', url: '/api/analyze', cookies: as(a), payload: { text: 'nos vemos mañana a las tres' } })).json().caseId
    const res = await publishCase(a, calm)
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('case_not_publishable')
  })
})

describe('consulta antes de pagar', () => {
  const lookup = (cookie: string, q: string) => app.inject({ method: 'GET', url: `/api/lookup?q=${encodeURIComponent(q)}`, cookies: as(cookie) })
  const analyze = (cookie: string, text: string) => app.inject({ method: 'POST', url: '/api/analyze', cookies: as(cookie), payload: { text } })
  const SCAM = 'Soy tu hijo, mi nuevo número es 300 000 0001, mándame plata urgente'

  it('un número que nadie reportó sale "sin reportes" con aviso de que no es garantía', async () => {
    const cookie = await signup('3001112233')
    const res = await lookup(cookie, '3109998877')
    expect(res.json()).toMatchObject({ kind: 'phone', level: 'sin_reportes', reporters: 0 })
    expect(res.json().disclaimer).toContain('no significa que sea seguro')
  })

  it('sube de alerta a peligro según cuántas personas distintas lo reportaron', async () => {
    const cookies = await Promise.all(['3001110001', '3001110002', '3001110003', '3001110004'].map((p) => signup(p)))
    const asker = cookies[3]!
    await analyze(cookies[0]!, SCAM)
    expect((await lookup(asker, '300 000 0001')).json()).toMatchObject({ level: 'alerta', reporters: 1 })
    await analyze(cookies[1]!, SCAM)
    await analyze(cookies[2]!, SCAM)
    const res = (await lookup(asker, '+57 300 000 0001')).json()
    expect(res).toMatchObject({ level: 'peligro', reporters: 3, display: '5731•••••719' })
  })

  it('un enlace en la lista de phishing sale en alerta aunque nadie lo haya reportado', async () => {
    const cookie = await signup('3001112233')
    checks.phishing.add('sitio-malo.com')
    const res = await lookup(cookie, 'https://login.sitio-malo.com/pagar')
    expect(res.json()).toMatchObject({ kind: 'domain', display: 'sitio-malo.com', level: 'alerta' })
  })

  it('rechaza lo que no es celular ni enlace', async () => {
    const cookie = await signup('3001112233')
    expect((await lookup(cookie, 'hola amigo')).statusCode).toBe(400)
  })
})

describe('panel territorial', () => {
  let phoneSeq = 0
  /** `cases` casos repartidos entre `people` personas distintas (por defecto una persona por caso). */
  async function seedCases(count: number, opts: { locality: number | null; municipality: string; demo?: boolean; people?: number }) {
    const people = opts.people ?? count
    const ids: number[] = []
    for (let i = 0; i < people; i++) {
      const [u] = await db
        .insert(users)
        .values({ phone: `5730${String(++phoneSeq).padStart(7, '0')}`, name: 'X', passwordHash: 'x', municipalityCode: opts.municipality, localityId: opts.locality, isDemo: opts.demo ?? false })
        .returning({ id: users.id })
      ids.push(u!.id)
    }
    await db.insert(cases).values(
      Array.from({ length: count }, (_, i) => ({
        userId: ids[i % ids.length]!, inputText: 'x', risk: 'alto', confidence: 90, fraudType: 'suplantacion_entidad', summary: 's',
        reasons: [], advice: [], sources: [], municipalityCode: opts.municipality, localityId: opts.locality,
      })),
    )
  }
  const territory = async () => (await app.inject({ method: 'GET', url: '/api/territory' })).json()
  const bosa = (t: { localities: Array<{ id: number; count: number | null }> }) => t.localities.find((l) => l.id === 7)!.count

  it('no publica celdas con menos de 3 personas y los totales no dejan deducir lo oculto', async () => {
    await seedCases(2, { locality: 7, municipality: '11001' })
    const t = await territory()
    expect(bosa(t)).toBeNull()
    // Antes el total real (2) permitía restar y descubrir la celda oculta.
    expect(t.total).toBe(0)
    expect(t.bogotaTotal).toBe(0)
    expect(t.byType).toEqual([])
    expect(t.daily.every((d: { count: number }) => d.count === 0)).toBe(true)
  })

  it('una sola persona con muchos casos NO hace visible su celda', async () => {
    await seedCases(10, { locality: 7, municipality: '11001', people: 1 })
    expect(bosa(await territory())).toBeNull()
  })

  it('publica la celda al llegar a 3 personas distintas y las ciudades fuera de Bogotá', async () => {
    await seedCases(3, { locality: 7, municipality: '11001' })
    await db.execute(sql`UPDATE municipalities SET lat = 6.25, lon = -75.57 WHERE code = '05001'`)
    await seedCases(4, { locality: null, municipality: '05001' })
    const t = await territory()
    expect(bosa(t)).toBe(3)
    expect(t.municipalities).toEqual([expect.objectContaining({ code: '05001', count: 4 })])
    expect(t.byType[0]).toEqual({ fraudType: 'suplantacion_entidad', count: 7 })
    expect(t.total).toBe(7)
    expect(t.daily).toHaveLength(14)
  })

  it('avisa cuando incluye datos de demostración', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/territory' })).json().includesDemo).toBe(false)
    await seedCases(3, { locality: 7, municipality: '11001', demo: true })
    expect((await app.inject({ method: 'GET', url: '/api/territory' })).json().includesDemo).toBe(true)
  })

  it('no expone usuarios ni textos y es de acceso público', async () => {
    await seedCases(3, { locality: 7, municipality: '11001' })
    const res = await app.inject({ method: 'GET', url: '/api/territory' })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain('passwordHash')
    expect(res.body).not.toContain('"inputText"')
  })

  it('con caché, consultas repetidas reutilizan el resultado y las simultáneas comparten una sola agregación', async () => {
    const cached = createTerritoryService(db, 3, 60)
    await seedCases(3, { locality: 7, municipality: '11001' })
    const [a, b] = await Promise.all([cached.overview(), cached.overview()])
    expect(a).toBe(b) // misma promesa: una sola consulta en vuelo
    await seedCases(3, { locality: 8, municipality: '11001' })
    expect((await cached.overview()).localities.find((l) => l.id === 8)!.count).toBeNull() // aún no se ve (caché)
    expect((await createTerritoryService(db, 3, 0).overview()).localities.find((l) => l.id === 8)!.count).toBe(3)
  })

  it('sirve los polígonos de Bogotá como GeoJSON', async () => {
    await db.update(localities).set({ geojson: { type: 'MultiPolygon', coordinates: [[[[-74.2, 4.6], [-74.1, 4.6], [-74.1, 4.7], [-74.2, 4.6]]]] } }).where(eq(localities.id, 7))
    const res = (await app.inject({ method: 'GET', url: '/api/territory/bogota-geojson' })).json()
    expect(res.type).toBe('FeatureCollection')
    expect(res.features[0].properties).toEqual({ id: 7, name: 'Bosa' })
  })
})
