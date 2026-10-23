// Generador ligero de "usuarios virtuales" para niveles que k6 no cabe en la RAM de este equipo (k6 ~1,1 MB/VU).
// Cada VU = una sesión con SU PROPIA conexión HTTP keep-alive y la misma mezcla que k6/parcero.js (escenario mix).
// SOLO loopback. Uso: node loadtest/sessions.mjs --vus 10000 --ramp 60 --hold 60 --think 10 --targets 4 --procs 4 --out results/x.json
import { fork } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { fileURLToPath } from 'node:url'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 ? process.argv[i + 1] : d
}
const VUS = Number(arg('vus', 1000))
const RAMP = Number(arg('ramp', 60))
const HOLD = Number(arg('hold', 60))
const THINK = Number(arg('think', 10))
const TARGETS = Number(arg('targets', 4))
const PROCS = Number(arg('procs', 4))
const OUT = arg('out', '')
const MODE = arg('mode', 'mix') // mix | read
const REQ_TIMEOUT_MS = 30_000
// GUARDA: solo 127.0.0.1..127.0.0.9 puerto 3100.
if (TARGETS < 1 || TARGETS > 9) throw new Error('ABORTADO: --targets entre 1 y 9 (solo 127.0.0.x)')

const WEIGHTS = [
  ['territory', 20], ['geojson', 5], ['munis', 22], ['health', 8],
  ['me', 14], ['posts', 10], ['credits', 6], ['lookup', 3], ['analyze', 10], ['post', 2],
]
const READ_ONLY = [['territory', 45], ['geojson', 10], ['munis', 35], ['health', 10]]
const QUERIES = ['med', 'bog', 'cali', 'barran', 'cart', 'sint', 'sant', 'pere']
const TEXTS = [
  'Me escribieron del banco diciendo que mi cuenta se bloquea y piden mi clave en http://bancolomb1a-seguro.xyz urgente',
  'Un amigo me pide el codigo de 6 digitos que me llego por mensaje, dice que se equivoco de numero',
  'Me ofrecen un prestamo aprobado sin papeleo, solo debo consignar 150 mil de seguro al 3105551234',
  'Hola, la reunion es manana a las 3pm en la oficina, no olvides el informe',
]
const LOOKUPS = ['3105551234', 'https://bancolomb1a-seguro.xyz/login', '3201112233', 'http://tienda-barata.top']

if (!process.send) {
  // ---------------- proceso principal: reparte VUs y agrega ----------------
  const t0 = Date.now()
  const agg = { sent: 0, ok: 0, status: {}, errors: {}, hist: new Array(64).fill(0), maxMs: 0, activeVus: 0, peakVus: 0, peakConns: 0 }
  const kids = []
  for (let p = 0; p < PROCS; p++) {
    const k = fork(fileURLToPath(import.meta.url), process.argv.slice(2), { env: { ...process.env, PROC: String(p) } })
    k.on('message', (m) => kids[p].last = m)
    kids.push(Object.assign(k, { last: null }))
  }
  const merge = () => {
    const a = { sent: 0, ok: 0, status: {}, errors: {}, hist: new Array(64).fill(0), maxMs: 0, vus: 0, conns: 0 }
    for (const k of kids) {
      const m = k.last
      if (!m) continue
      a.sent += m.sent; a.ok += m.ok; a.vus += m.vus; a.conns += m.conns; a.maxMs = Math.max(a.maxMs, m.maxMs)
      m.hist.forEach((c, i) => (a.hist[i] += c))
      for (const [c, n] of Object.entries(m.status)) a.status[c] = (a.status[c] ?? 0) + n
      for (const [c, n] of Object.entries(m.errors)) a.errors[c] = (a.errors[c] ?? 0) + n
    }
    return a
  }
  const pct = (hist, q) => {
    const total = hist.reduce((x, y) => x + y, 0)
    let acc = 0
    for (let i = 0; i < hist.length; i++) { acc += hist[i]; if (acc >= total * q) return Math.round(2 ** (i / 4)) }
    return 0
  }
  let prevSent = 0
  const tick = setInterval(() => {
    const a = merge()
    agg.peakVus = Math.max(agg.peakVus, a.vus)
    agg.peakConns = Math.max(agg.peakConns, a.conns)
    const el = Math.round((Date.now() - t0) / 1000)
    console.log(`[${el}s] vus=${a.vus} conns=${a.conns} reqs=${a.sent} (+${Math.round((a.sent - prevSent) / 5)}/s) ok=${a.ok} p95~${pct(a.hist, 0.95)}ms err=${JSON.stringify(a.errors)} st=${JSON.stringify(a.status)}`)
    prevSent = a.sent
  }, 5000)
  let done = 0
  for (const k of kids) k.on('exit', () => {
    if (++done < PROCS) return
    clearInterval(tick)
    const a = merge()
    const secs = (Date.now() - t0) / 1000
    const bad = a.sent - a.ok
    const res = {
      vusRequested: VUS, peakVus: agg.peakVus, peakConns: agg.peakConns, think: THINK, ramp: RAMP, hold: HOLD, targets: TARGETS, procs: PROCS,
      requests: a.sent, rps: Math.round(a.sent / secs), errPct: +((100 * bad) / Math.max(1, a.sent)).toFixed(2),
      p50: pct(a.hist, 0.5), p95: pct(a.hist, 0.95), p99: pct(a.hist, 0.99), maxMs: Math.round(a.maxMs), status: a.status, errors: a.errors,
      note: 'percentiles con histograma logaritmico (resolucion ~19 %)',
    }
    console.log('RESULT ' + JSON.stringify(res))
    if (OUT) writeFileSync(OUT, JSON.stringify(res, null, 1))
  })
} else {
  // ---------------- worker ----------------
  const P = Number(process.env.PROC)
  const data = JSON.parse(readFileSync(fileURLToPath(new URL('./data/users.json', import.meta.url)), 'utf8'))
  const tokens = data.tokens
  const st = { sent: 0, ok: 0, status: {}, errors: {}, hist: new Array(64).fill(0), maxMs: 0, vus: 0, conns: 0 }
  let stopping = false
  const bucket = (ms) => Math.min(63, Math.max(0, Math.floor(Math.log2(Math.max(1, ms)) * 4)))
  const pick = (items) => {
    let r = Math.random() * items.reduce((n, [, w]) => n + w, 0)
    for (const [f, w] of items) if ((r -= w) <= 0) return f
    return items[0][0]
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let openConns = 0

  function request(vu, method, path, body, token) {
    return new Promise((resolve) => {
      const t = performance.now()
      const n = vu.id
      const headers = { 'X-Forwarded-For': `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, Connection: 'keep-alive' }
      if (token) headers.Cookie = `ps_session=${token}`
      if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body) }
      st.sent++
      let finished = false
      const finish = (code, err) => {
        if (finished) return
        finished = true
        const ms = performance.now() - t
        st.hist[bucket(ms)]++
        st.maxMs = Math.max(st.maxMs, ms)
        if (err) st.errors[err] = (st.errors[err] ?? 0) + 1
        else {
          st.status[code] = (st.status[code] ?? 0) + 1
          if (code === 200 || code === 201) st.ok++
        }
        resolve()
      }
      const req = http.request({ host: vu.host, port: 3100, method, path, headers, agent: vu.agent, timeout: REQ_TIMEOUT_MS }, (res) => {
        res.on('data', () => {})
        res.on('end', () => finish(res.statusCode))
        res.on('error', (e) => finish(0, e.code ?? 'res_error'))
      })
      req.on('timeout', () => { req.destroy(); finish(0, 'timeout') })
      req.on('error', (e) => finish(0, e.code ?? 'error'))
      req.end(body)
    })
  }

  async function runVu(i) {
    const id = i + 1
    const vu = {
      id,
      host: `127.0.0.${(id % TARGETS) + 1}`,
      agent: new http.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1 }),
    }
    vu.agent.on?.('free', () => {})
    const token = tokens[(id - 1) % tokens.length]
    const actions = {
      territory: () => request(vu, 'GET', '/api/territory'),
      geojson: () => request(vu, 'GET', '/api/territory/bogota-geojson'),
      munis: () => request(vu, 'GET', `/api/locations/municipalities?q=${QUERIES[Math.floor(Math.random() * 8)]}`),
      health: () => request(vu, 'GET', '/api/health'),
      me: () => request(vu, 'GET', '/api/auth/me', null, token),
      posts: () => request(vu, 'GET', '/api/posts', null, token),
      credits: () => request(vu, 'GET', '/api/credits', null, token),
      lookup: () => request(vu, 'GET', `/api/lookup?q=${encodeURIComponent(LOOKUPS[Math.floor(Math.random() * 4)])}`, null, token),
      analyze: () => request(vu, 'POST', '/api/analyze', JSON.stringify({ text: TEXTS[Math.floor(Math.random() * 4)] }), token),
      post: () => request(vu, 'POST', '/api/posts', JSON.stringify({ kind: 'intentaron', text: 'Me llego un mensaje sospechoso pidiendo un codigo, no lo compartan con nadie.' }), token),
    }
    st.vus++
    while (!stopping) {
      await actions[pick(MODE === 'read' ? READ_ONLY : WEIGHTS)]()
      await sleep(THINK * 1000 * (0.5 + Math.random()))
    }
    vu.agent.destroy()
    st.vus--
  }

  const mine = []
  for (let i = P; i < VUS; i += PROCS) mine.push(i)
  const report = setInterval(() => {
    process.send({ ...st, conns: st.vus })
  }, 2000)
  const startAt = Date.now()
  // Rampa lineal: lanza los VUs repartidos en RAMP segundos.
  ;(async () => {
    for (let k = 0; k < mine.length; k++) {
      const target = ((k + 1) / mine.length) * RAMP * 1000
      const wait = startAt + target - Date.now()
      if (wait > 0 && k % 20 === 0) await sleep(wait)
      runVu(mine[k])
    }
    await sleep(Math.max(0, startAt + (RAMP + HOLD) * 1000 - Date.now()))
    stopping = true
    await sleep(Math.min(REQ_TIMEOUT_MS, 8000))
    clearInterval(report)
    process.send({ ...st, conns: 0 }, () => process.exit(0))
  })()
}
