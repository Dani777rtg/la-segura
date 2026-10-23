// Resume resultados de k6 (summary.json) + monitor (mon.csv) en una fila. Uso: node loadtest/summarize.mjs results/<nombre> [...]
import { existsSync, readFileSync } from 'node:fs'

for (const base of process.argv.slice(2)) {
  const sj = `${base}.summary.json`
  const m = existsSync(sj) ? JSON.parse(readFileSync(sj, 'utf8')).metrics : null
  const row = { run: base.split(/[\\/]/).pop() }
  if (m) {
    const d = m.http_req_duration
    row.vusMax = m.vus_max?.max ?? m.vus?.max
    row.reqs = m.http_reqs?.count
    row.rps = Math.round(m.http_reqs?.rate)
    row.p50 = Math.round(d?.med)
    row.p95 = Math.round(d?.['p(95)'])
    row.p99 = Math.round(d?.['p(99)'])
    row.max = Math.round(d?.max)
    row.errPct = +((m.http_req_failed?.value ?? 0) * 100).toFixed(2)
    row.checksFailPct = m.checks ? +((1 - m.checks.value) * 100).toFixed(2) : undefined
  }
  const mon = `${base}.mon.csv`
  if (existsSync(mon)) {
    const rows = readFileSync(mon, 'utf8').split('\n').slice(1).filter((l) => /^\d/.test(l)).map((l) => l.split(','))
    const num = (i) => rows.map((r) => Number(r[i])).filter((x) => !Number.isNaN(x))
    row.sysCpuMax = Math.max(...num(1))
    row.memMax = Math.max(...num(2))
    row.k6CpuCoresMax = +(Math.max(...num(3)) / 100).toFixed(1)
    row.k6RssMbMax = Math.max(...num(4))
    row.tcpMax = Math.max(...num(rows[0].length - 1))
    const srv = rows.flatMap((r) => r[5].split(' | ').map((s) => s.split('/').map(Number)))
    row.srvCpuMax = Math.max(...srv.map((s) => s[0]).filter((x) => !Number.isNaN(x)))
    row.srvRssMbMax = Math.max(...srv.map((s) => s[1]).filter((x) => !Number.isNaN(x)))
    row.loopMaxMs = Math.max(...srv.map((s) => s[3]).filter((x) => !Number.isNaN(x)))
    row.poolWaitMax = Math.max(...srv.map((s) => s[6]).filter((x) => !Number.isNaN(x)))
    row.srvTimeouts = rows.reduce((n, r) => n + (r[5].match(/timeout/g)?.length ?? 0), 0)
    row.pgCpuMax = Math.max(...rows.map((r) => Number(r[7])).filter((x) => !Number.isNaN(x)))
    row.pgConnMax = Math.max(...rows.map((r) => Number(r[6].split('/')[0])).filter((x) => !Number.isNaN(x)))
  }
  console.log(JSON.stringify(row))
}
