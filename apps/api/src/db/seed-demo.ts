// DATOS DE DEMOSTRACIÓN (sintéticos). No son casos reales: no existen cifras públicas por localidad.
// Todos los usuarios creados llevan is_demo = true y la interfaz los rotula como ejemplos.
import { inArray, sql } from 'drizzle-orm'
import { loadConfigForScripts } from './seed-config.ts'
import { createDb } from './client.ts'
import { cases, localities, municipalities, posts, users } from './schema.ts'
import { normalizeText } from '../lib/phone.ts'

const { databaseUrl } = loadConfigForScripts()
const { db, pool } = createDb(databaseUrl)

// Pesos aproximados de actividad: Bosa, Kennedy y Ciudad Bolívar arriba para contar la historia del reto.
const BOGOTA_WEIGHTS: Record<string, number> = {
  Bosa: 14, Kennedy: 12, 'Ciudad Bolívar': 10, Suba: 9, Engativá: 8, Usme: 6, 'San Cristóbal': 4, 'Rafael Uribe Uribe': 4,
  Fontibón: 3, 'Puente Aranda': 3, Tunjuelito: 3, Usaquén: 3, Chapinero: 2, 'Santa Fe': 2, 'Barrios Unidos': 2,
  'Los Mártires': 2, 'Antonio Nariño': 2, Teusaquillo: 1, 'La Candelaria': 1,
}
const CITY_WEIGHTS: Record<string, number> = {
  medellin: 12, cali: 10, barranquilla: 8, cartagena: 5, bucaramanga: 4, cucuta: 4, soacha: 4, pereira: 3, 'santa marta': 3,
  ibague: 3, villavicencio: 3, manizales: 2, pasto: 2,
}
const TYPES: Array<[string, number, string]> = [
  ['suplantacion_entidad', 35, 'Mensaje de un supuesto banco pidiendo confirmar la clave en un enlace.'],
  ['robo_whatsapp', 20, 'Piden el código de 6 dígitos que llegó por mensaje para "verificar" la cuenta.'],
  ['pago_falso', 12, 'Dijeron haber pagado (con captura) y el dinero nunca llegó a la cuenta.'],
  ['prestamo_falso', 12, 'Oferta de préstamo aprobado sin papeleo que pide un depósito previo.'],
  ['tienda_falsa', 10, 'Tienda en línea con precios muy bajos que no entrega el producto.'],
  ['citacion_falsa', 6, 'Correo con una supuesta citación judicial y un archivo adjunto.'],
  ['inversion_falsa', 5, 'Promesa de duplicar el dinero en una semana con una inversión segura.'],
]

const pick = <T,>(weights: Array<[T, number]>): T => {
  let r = Math.random() * weights.reduce((n, [, w]) => n + w, 0)
  for (const [v, w] of weights) if ((r -= w) <= 0) return v
  return weights[0]![0]
}

// Reinicio idempotente: solo borra lo que este script creó.
const demoUsers = db.select({ id: users.id }).from(users).where(sql`${users.isDemo}`)
await db.delete(cases).where(inArray(cases.userId, demoUsers))
await db.delete(posts).where(inArray(posts.userId, demoUsers))
await db.delete(users).where(sql`${users.isDemo}`)

const locs = await db.select().from(localities)
const munis = await db.select({ code: municipalities.code, nameNorm: municipalities.nameNorm }).from(municipalities)
const cityCode = (n: string) => munis.find((m) => m.nameNorm === n)?.code

type Place = { municipality: string; locality: number | null }
const places: Array<[Place, number]> = [
  ...locs.map((l): [Place, number] => [{ municipality: '11001', locality: l.id }, BOGOTA_WEIGHTS[l.name] ?? 0]),
  ...Object.entries(CITY_WEIGHTS).flatMap(([n, w]): Array<[Place, number]> => {
    const code = cityCode(normalizeText(n))
    return code ? [[{ municipality: code, locality: null }, w]] : []
  }),
].filter(([, w]) => w > 0)

let phoneSeq = 0
const demoUser = async (place: Place, name: string) => {
  const [u] = await db
    .insert(users)
    .values({
      phone: `5799${String(1_000_000 + ++phoneSeq)}`, // no es un celular válido: no puede iniciar sesión
      name,
      passwordHash: 'demo-sin-acceso',
      municipalityCode: place.municipality,
      localityId: place.locality,
      phoneVerifiedAt: new Date(),
      isDemo: true,
    })
    .returning({ id: users.id })
  return u!.id
}

const FIRST = ['Laura', 'Camilo', 'Diana', 'Andrés', 'Paola', 'Jhon', 'Sandra', 'Mateo', 'Yesenia', 'Brayan', 'Marcela', 'Éver']
const total = 420
// Varias personas sintéticas por zona: el mapa solo publica celdas con >= 3 personas distintas.
const PEOPLE_PER_PLACE = 5
const usersByPlace = new Map<string, number[]>()
const rows: Array<typeof cases.$inferInsert> = []
for (let i = 0; i < total; i++) {
  const place = pick(places)
  const key = `${place.municipality}:${place.locality}`
  if (!usersByPlace.has(key)) {
    const ids: number[] = []
    for (let k = 0; k < PEOPLE_PER_PLACE; k++) ids.push(await demoUser(place, `${FIRST[(usersByPlace.size + k) % FIRST.length]} (ejemplo)`))
    usersByPlace.set(key, ids)
  }
  const people = usersByPlace.get(key)!
  const userId = people[Math.floor(Math.random() * people.length)]!
  const [fraudType, , text] = pick(TYPES.map((t): [(typeof TYPES)[number], number] => [t, t[1]]))
  // Más casos en los días recientes (curva decreciente) para que la gráfica se vea natural.
  const daysAgo = Math.min(29, Math.floor(-Math.log(1 - Math.random()) * 9))
  rows.push({
    userId,
    channel: 'web',
    inputText: `[Ejemplo] ${text}`,
    risk: Math.random() < 0.7 ? 'alto' : 'medio',
    confidence: 60 + Math.floor(Math.random() * 38),
    fraudType,
    summary: 'Caso de demostración.',
    reasons: [],
    advice: [],
    sources: [],
    municipalityCode: place.municipality,
    localityId: place.locality,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000 - Math.floor(Math.random() * 80_000_000)),
  })
}
for (let i = 0; i < rows.length; i += 100) await db.insert(cases).values(rows.slice(i, i + 100))

// Publicaciones de ejemplo: todas anónimas ("Un vecino"), con el mensaje exacto que llegó (como se publica desde
// WhatsApp o la app), sin nombres de personas y con los números enmascarados. Los enlaces se muestran como texto.
// [tipo, tipo de estafa, texto, lugar: número = localidad de Bogotá, texto = municipio]
const POSTS: Array<[string, string, string, number | string]> = [
  ['intentaron', 'suplantacion_entidad', 'Me llegó este mensaje: «Bancolombia: tu cuenta será bloqueada hoy a las 6:00 p.m. Para evitarlo verifica tus datos en [enlace: bancolombia-verificacion.xyz] e ingresa tu clave dinámica». No entré y llamé al banco: era falso.', 7],
  ['estafaron', 'robo_whatsapp', 'Me llegó este mensaje: «Hola, me equivoqué y te llegó un código de 6 números a tu celular, ¿me lo reenvías porfa? Es urgente». Lo mandé y me robaron el WhatsApp. No pasen ese código a nadie.', 8],
  ['intentaron', 'robo_whatsapp', 'Me llegó este mensaje: «Hola ma, soy yo, cambié de número porque se me dañó el celular. Necesito que me consignes 350 mil urgente a este Nequi 312•••0199, mañana te los devuelvo». Llamé a mi hijo a su número de siempre: no era él.', 7],
  ['intentaron', 'suplantacion_entidad', 'Me llegó este mensaje: «Servientrega: su paquete está retenido. Pague $12.900 de envío en [enlace: servientrega-envios.top] antes de 24 horas o será devuelto». Yo no esperaba ningún paquete.', 19],
  ['intentaron', 'inversion_falsa', 'Me llegó este mensaje: «FELICITACIONES! Su número fue seleccionado en el sorteo de Claro 🎁 Ganó un iPhone 15, reclámelo en [enlace: premios-claro.top]». Claro no regala celulares por mensaje.', 'medellin'],
  ['intentaron', 'prestamo_falso', 'Me llegó este mensaje: «Préstamo aprobado por $2.000.000 sin centrales de riesgo ni papeleo. Para desembolsar envía foto de tu cédula y paga $150.000 de seguro al 310•••8877». Es gota a gota digital, no caigan.', 10],
  ['estafaron', 'pago_falso', 'Me llegó este mensaje: «Te consigné por error 150 mil, ya te mandé el comprobante, devuélvemelos a este número 300•••4567 porfa». Les devolví la plata y la consignación nunca había llegado. Revisen su app del banco, no la foto.', 'cali'],
  ['intentaron', 'citacion_falsa', 'Me llegó este correo: «Fiscalía General de la Nación: tiene una citación por proceso penal en su contra. Descargue el expediente en [enlace: fiscalia-notificaciones.online]». La Fiscalía no notifica así.', 11],
  ['estafaron', 'suplantacion_entidad', 'Me llamaron diciendo: «Le hablamos de seguridad de su banco, detectamos una compra sospechosa de $1.200.000; para cancelarla díganos la clave dinámica que le va a llegar». Se la di y perdí 380 mil pesos.', 5],
  ['intentaron', 'inversion_falsa', 'Me llegó este mensaje: «Trabaja desde casa ganando $2.000.000 al mes dando likes. Solo paga $50.000 de inscripción por Nequi y empiezas hoy». Me salí del grupo y bloqueé el número.', 'barranquilla'],
  ['intentaron', 'suplantacion_entidad', 'Me llegó este mensaje: «Nequi: tu cuenta se bloqueará. Para evitarlo envía el código que te llegó al 310•••4567 o entra a [enlace: nequi-seguro.top]». Nequi nunca pide códigos.', 4],
  ['intentaron', 'sim_swapping', 'Me llegó este mensaje: «Movistar: su solicitud de portabilidad fue aprobada. Si no la hizo, responda con el código que le enviamos para cancelarla». Me quedé sin señal de repente: fui al operador y frené el duplicado de la SIM.', 6],
  ['intentaron', 'suplantacion_entidad', 'Me llegó este mensaje: «DIAN: usted tiene una deuda pendiente por $890.000. Pague hoy en [enlace: dian-pagos-en-linea.xyz] para evitar embargo». La DIAN no manda enlaces de pago así.', 'bucaramanga'],
  ['intentaron', 'tienda_falsa', 'Vi este anuncio: «iPhone 15 Pro nuevo a $1.500.000, envío gratis, solo pago anticipado por Nequi. [enlace: tecno-ofertas-col.shop]». La página tenía dos semanas de creada.', 9],
]
for (const [kind, fraudType, body, where] of POSTS) {
  const place: Place = typeof where === 'number' ? { municipality: '11001', locality: where } : { municipality: cityCode(where) ?? '11001', locality: cityCode(where) ? null : 7 }
  const userId = await demoUser(place, `${FIRST[Math.floor(Math.random() * FIRST.length)]} (ejemplo)`)
  await db.insert(posts).values({
    userId, kind, body, fraudType, municipalityCode: place.municipality, localityId: place.locality, anonymous: true,
    createdAt: new Date(Date.now() - Math.floor(Math.random() * 9 * 86_400_000)),
  })
}

console.log(`Datos de demostración: ${rows.length} casos, ${POSTS.length} publicaciones, ${phoneSeq} usuarios sintéticos`)
await pool.end()
