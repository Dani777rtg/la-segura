// Pruebas de carga LOCALES de Parcero Seguro. SOLO localhost. Ver loadtest/README.md.
// Variables: SCENARIO=smoke|read|auth|mix|write|credits|login  VUS=n  RAMP=60s  HOLD=60s  THINK=10 (s medios entre acciones)
//            BASES=http://127.0.0.1:3100,http://127.0.0.2:3100  (reparte los VU entre procesos)
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'
import { SharedArray } from 'k6/data'

// ---- GUARDA: aborta si algún destino no es loopback ----
const BASES = (__ENV.BASES || 'http://127.0.0.1:3100').split(',').map((s) => s.trim())
const LOOPBACK = /^http:\/\/(localhost|127(\.\d{1,3}){3}|\[::1\])(:\d+)?$/
for (const b of BASES) {
  if (!LOOPBACK.test(b)) throw new Error(`ABORTADO: BASE_URL no es localhost/127.x/[::1]: ${b}`)
}

const SCENARIO = __ENV.SCENARIO || 'smoke'
const VUS = Number(__ENV.VUS || 10)
const RAMP = __ENV.RAMP || '30s'
const HOLD = __ENV.HOLD || '30s'
const THINK = Number(__ENV.THINK || 10)

// Un elemento por token: SharedArray no copia los 50.000 tokens a cada VU (si no, ~20 MB por VU).
const tokens = new SharedArray('tokens', () => JSON.parse(open('../data/users.json')).tokens)
const small = new SharedArray('small', () => { const d = JSON.parse(open('../data/users.json')); return [{ hot: d.hot, loginPhones: d.loginPhones, password: d.password }] })
const data = small[0]
const status = new Counter('status_by_code')

const ramp = (exec) => ({
  executor: 'ramping-vus',
  exec,
  startVUs: 0,
  stages: [
    { duration: RAMP, target: VUS },
    { duration: HOLD, target: VUS },
    { duration: '10s', target: 0 },
  ],
  gracefulRampDown: '15s',
  gracefulStop: '15s',
})

const THRESHOLDS = {
  // Criterios propuestos por el equipo de pruebas (no son objetivos del producto).
  read: { 'http_req_failed': ['rate<0.01'], 'http_req_duration': ['p(95)<500', 'p(99)<1500'] },
  auth: { 'http_req_failed': ['rate<0.01'], 'http_req_duration': ['p(95)<600', 'p(99)<2000'] },
  mix: { 'http_req_failed': ['rate<0.01'], 'http_req_duration': ['p(95)<800', 'p(99)<2500'] },
  write: { 'http_req_failed': ['rate<0.01'], 'http_req_duration': ['p(95)<1000', 'p(99)<3000'] },
  credits: { 'status_by_code{code:500}': ['count==0'], 'status_by_code{code:200}': ['count>=0'], 'status_by_code{code:402}': ['count>=0'], 'status_by_code{code:429}': ['count>=0'], 'http_req_duration': ['p(95)<2000'] },
  login: { 'http_req_failed': ['rate<0.01'], 'http_req_duration': ['p(95)<2000'] },
  smoke: { 'http_req_failed': ['rate<0.01'] },
}

const scenarios = {
  smoke: { executor: 'per-vu-iterations', exec: 'mix', vus: 5, iterations: 5, maxDuration: '1m' },
  read: ramp('read'),
  auth: ramp('auth'),
  mix: ramp('mix'),
  write: ramp('write'),
  login: {
    executor: 'constant-arrival-rate',
    exec: 'login',
    rate: VUS,
    timeUnit: '1s',
    duration: HOLD,
    preAllocatedVUs: Math.max(50, VUS * 2),
    maxVUs: Math.max(200, VUS * 20),
  },
  // Rafaga simultanea de 20 gastos sobre el mismo usuario (saldo 10), uno por VU caliente.
  credits: {
    executor: 'per-vu-iterations',
    exec: 'credits',
    vus: Math.min(VUS, data.hot.length),
    iterations: 1,
    maxDuration: '2m',
  },
}

// Condición de parada: error > 5 % (tras 20 s) aborta la prueba.
const thr = THRESHOLDS[SCENARIO]
if (SCENARIO !== 'credits') thr['http_req_failed'] = [...(thr['http_req_failed'] || []), { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }]

export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  thresholds: thr,
  discardResponseBodies: true,
  noConnectionReuse: false,
  userAgent: 'parcero-loadtest/1.0',
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const base = () => BASES[__VU % BASES.length]
// Una IP "de usuario" distinta por VU (el servidor confía en X-Forwarded-For, como tras Cloud Run).
// ROT=1 (pruebas de techo de rendimiento): IP y usuario cambian en cada iteración para no chocar con límites por IP/usuario.
const ROT = __ENV.ROT === '1'
const ipN = () => (ROT ? (__VU * 1000003 + __ITER * 7919) % 16777216 : __VU)
const ip = () => { const n = ipN(); return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}` }
const hdr = (extra = {}) => ({ 'X-Forwarded-For': ip(), ...extra })
const authHdr = (extra = {}) => hdr({ Cookie: `ps_session=${tokens[ROT ? Math.floor(Math.random() * tokens.length) : (__VU - 1) % tokens.length]}`, ...extra })
const think = () => sleep(THINK * (0.5 + Math.random()))
const rec = (res, name) => {
  status.add(1, { code: String(res.status) })
  return check(res, { [`${name} 200`]: (r) => r.status === 200 || r.status === 201 })
}
const QUERIES = ['med', 'bog', 'cali', 'barran', 'cart', 'sint', 'sant', 'pere']
const TEXTS = [
  'Me escribieron del banco diciendo que mi cuenta se bloquea y piden mi clave en http://bancolomb1a-seguro.xyz urgente',
  'Un amigo me pide el codigo de 6 digitos que me llego por mensaje, dice que se equivoco de numero',
  'Me ofrecen un prestamo aprobado sin papeleo, solo debo consignar 150 mil de seguro al 3105551234',
  'Hola, la reunion es manana a las 3pm en la oficina, no olvides el informe',
]
const LOOKUPS = ['3105551234', 'https://bancolomb1a-seguro.xyz/login', '3201112233', 'http://tienda-barata.top']

const ONLY = __ENV.ONLY // ONLY=territory|geojson|munis|health|me|posts|credits|lookup|analyze|post: aísla un endpoint
const pickWeighted = (items) => {
  if (ONLY) return A[ONLY]
  let r = Math.random() * items.reduce((n, [, w]) => n + w, 0)
  for (const [f, w] of items) if ((r -= w) <= 0) return f
  return items[0][0]
}

const A = {
  territory: () => rec(http.get(`${base()}/api/territory`, { headers: hdr(), tags: { name: 'GET /api/territory' } }), 'territory'),
  geojson: () => rec(http.get(`${base()}/api/territory/bogota-geojson`, { headers: hdr(), tags: { name: 'GET /api/territory/bogota-geojson' } }), 'geojson'),
  munis: () => rec(http.get(`${base()}/api/locations/municipalities?q=${QUERIES[Math.floor(Math.random() * QUERIES.length)]}`, { headers: hdr(), tags: { name: 'GET /api/locations/municipalities' } }), 'munis'),
  health: () => rec(http.get(`${base()}/api/health`, { headers: hdr(), tags: { name: 'GET /api/health' } }), 'health'),
  me: () => rec(http.get(`${base()}/api/auth/me`, { headers: authHdr(), tags: { name: 'GET /api/auth/me' } }), 'me'),
  posts: () => rec(http.get(`${base()}/api/posts`, { headers: authHdr(), tags: { name: 'GET /api/posts' } }), 'posts'),
  credits: () => rec(http.get(`${base()}/api/credits`, { headers: authHdr(), tags: { name: 'GET /api/credits' } }), 'credits'),
  lookup: () => rec(http.get(`${base()}/api/lookup?q=${encodeURIComponent(LOOKUPS[Math.floor(Math.random() * LOOKUPS.length)])}`, { headers: authHdr(), tags: { name: 'GET /api/lookup' } }), 'lookup'),
  analyze: () =>
    rec(http.post(`${base()}/api/analyze`, JSON.stringify({ text: TEXTS[Math.floor(Math.random() * TEXTS.length)] }), { headers: authHdr({ 'Content-Type': 'application/json' }), tags: { name: 'POST /api/analyze' } }), 'analyze'),
  post: () =>
    rec(http.post(`${base()}/api/posts`, JSON.stringify({ kind: 'intentaron', text: 'Me llego un mensaje sospechoso pidiendo un codigo, no lo compartan con nadie.' }), { headers: authHdr({ 'Content-Type': 'application/json' }), tags: { name: 'POST /api/posts' } }), 'post'),
}

export function read() {
  pickWeighted([[A.territory, 45], [A.geojson, 10], [A.munis, 35], [A.health, 10]])()
  think()
}
export function auth() {
  pickWeighted([[A.me, 40], [A.posts, 30], [A.credits, 20], [A.lookup, 10]])()
  think()
}
// Mezcla realista de sesion: 55 % lectura publica, 33 % autenticada ligera, 12 % escritura (analizar / publicar).
export function mix() {
  pickWeighted([
    [A.territory, 20], [A.geojson, 5], [A.munis, 22], [A.health, 8],
    [A.me, 14], [A.posts, 10], [A.credits, 6], [A.lookup, 3],
    [A.analyze, 10], [A.post, 2],
  ])()
  think()
}
export function write() {
  pickWeighted([[A.analyze, 85], [A.post, 15]])()
  think()
}

// Login real (scrypt): usuario y celular conocidos, una IP distinta por iteracion para esquivar el limite por (ip, celular).
export function login() {
  const i = (__ITER + __VU * 7919) % data.loginPhones.length
  const res = http.post(`${BASES[__ITER % BASES.length]}/api/auth/login`, JSON.stringify({ phone: data.loginPhones[i], password: data.password }), {
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.9.${(__ITER >> 8) & 255}.${__ITER & 255}` },
    tags: { name: 'POST /api/auth/login' },
  })
  rec(res, 'login')
}

// 20 peticiones simultaneas gastando del mismo usuario (saldo 10, coste 1): como mucho 10 deben cobrar.
export function credits() {
  const u = data.hot[(__VU - 1) % data.hot.length]
  const reqs = []
  for (let i = 0; i < 20; i++) {
    reqs.push({
      method: 'POST',
      url: `${base()}/api/analyze`,
      body: JSON.stringify({ text: TEXTS[i % 3] }),
      params: { headers: hdr({ Cookie: `ps_session=${u.token}`, 'Content-Type': 'application/json' }), tags: { name: 'POST /api/analyze (hot)' }, responseCallback: http.expectedStatuses(200, 402, 429) },
    })
  }
  for (const r of http.batch(reqs)) status.add(1, { code: String(r.status) })
}
