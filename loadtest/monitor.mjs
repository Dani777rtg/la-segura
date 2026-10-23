// Monitor de recursos durante una prueba. Uso: node loadtest/monitor.mjs <salida.csv> <numServidores>
// Cada 5 s: CPU/memoria del equipo, CPU/RSS de k6, métricas de cada servidor, conexiones de Postgres.
// Condición de parada: CPU o memoria del equipo > 95 % durante 30 s seguidos -> mata k6.
import { execFile, execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)
const [out, nStr] = process.argv.slice(2)
const N = Number(nStr ?? 1)
writeFileSync(out, 't,sysCpu,memUsedPct,k6CpuPct,k6RssMb,srv(cpu%/rssMB/loopP99ms/loopMax/poolTotal/idle/waiting),pg(total/active/idleInTx),pgContainerCpu%,tcpEstablished\n')

const cpuTimes = () => os.cpus().reduce((a, c) => ({ idle: a.idle + c.times.idle, total: a.total + Object.values(c.times).reduce((x, y) => x + y, 0) }), { idle: 0, total: 0 })
let prev = cpuTimes()
let prevK6 = null
let hot = 0
const t0 = Date.now()
const ps = (cmd) => run('powershell', ['-NoProfile', '-Command', cmd]).then((r) => r.stdout.trim()).catch(() => '')

while (true) {
  await new Promise((r) => setTimeout(r, 5000))
  const cur = cpuTimes()
  const sysCpu = Math.round(100 * (1 - (cur.idle - prev.idle) / (cur.total - prev.total)))
  prev = cur
  const memUsedPct = Math.round(100 * (1 - os.freemem() / os.totalmem()))
  const k6 = (await ps("$p=Get-Process k6 -ErrorAction SilentlyContinue; if($p){ '{0} {1}' -f ($p|Measure-Object CPU -Sum).Sum, [int](($p|Measure-Object WorkingSet64 -Sum).Sum/1MB) }")).split(' ')
  let k6Cpu = 0
  const k6Rss = Number(k6[1] ?? 0)
  if (k6[0]) {
    const c = Number(k6[0].replace(',', '.'))
    if (prevK6 !== null) k6Cpu = Math.round(((c - prevK6) / 5) * 100 / os.cpus().length * os.cpus().length) // % de un núcleo
    prevK6 = c
  }
  const srv = []
  for (let i = 1; i <= N; i++) {
    try {
      const m = await (await fetch(`http://127.0.0.${i}:3100/__load/metrics`, { signal: AbortSignal.timeout(3000) })).json()
      srv.push(`${m.cpuPct}/${m.rssMb}/${m.loopP99ms.toFixed(0)}/${m.loopMaxMs.toFixed(0)}/${m.pool.total}/${m.pool.idle}/${m.pool.waiting}`)
    } catch { srv.push('timeout') }
  }
  const pg = await ps("docker exec hackatonbogota-db-1 psql -U parcero -d parcero_load -tAc \"select count(*)||'/'||count(*) filter (where state='active')||'/'||count(*) filter (where state like 'idle in%') from pg_stat_activity where datname='parcero_load'\"")
  const pgCpu = (await ps("docker stats --no-stream --format '{{.CPUPerc}}' hackatonbogota-db-1")).replace("%", "")
  const tcp = await ps("(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Measure-Object).Count")
  appendFileSync(out, `${Math.round((Date.now() - t0) / 1000)},${sysCpu},${memUsedPct},${k6Cpu},${k6Rss},${srv.join(' | ')},${pg},${pgCpu},${tcp}\n`)

  hot = sysCpu > 95 || memUsedPct > 95 ? hot + 5 : 0
  if (hot >= 30) {
    appendFileSync(out, 'PARADA: CPU/memoria > 95 % durante 30 s; se mata k6\n')
    try { execFileSync('taskkill', ['/F', '/IM', 'k6.exe']) } catch {}
    hot = 0
  }
}
