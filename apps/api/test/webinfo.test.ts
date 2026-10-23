import { describe, expect, it } from 'vitest'
import { inspectLink, isPublicIp } from '../src/gateways/webinfo.ts'

describe('visita segura de enlaces', () => {
  it('nunca entra a direcciones internas (metadatos de la nube, red privada, localhost)', async () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
      expect(isPublicIp(ip)).toBe(false)
    }
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(await inspectLink('http://169.254.169.254/latest/meta-data')).toBeNull()
    expect(await inspectLink('http://127.0.0.1:3000/api/health')).toBeNull()
    expect(await inspectLink('file:///etc/passwd')).toBeNull()
  })
})
