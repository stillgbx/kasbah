import { once } from 'node:events'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isPublicIp, publicFetch } from './outbound'

describe('isPublicIp', () => {
  it('refuses the machine, the local network, link-local, carrier-grade NAT and multicast', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
      '::1', '::', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1', '::ffff:127.0.0.1', 'pas une ip']) {
      expect(isPublicIp(ip), ip).toBe(false)
    }
  })

  it('accepts the Internet', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2001:4860:4860::8888', '::ffff:8.8.8.8']) expect(isPublicIp(ip), ip).toBe(true)
  })
})

describe('publicFetch', () => {
  let server: Server | undefined
  afterEach(async () => { if (server) await new Promise((ok) => server!.close(ok)); server = undefined })

  const local = async () => {
    let hits = 0
    server = createServer((_req, res) => { hits++; res.end('secret local page') })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, hits: () => hits }
  }

  it('never reaches a local address, written as an IP or as a name resolving to it', async () => {
    const { url, hits } = await local()
    await expect(publicFetch(url)).rejects.toThrow(/not a public address/)
    await expect(publicFetch(url.replace('127.0.0.1', 'localhost'))).rejects.toThrow()
    await expect(publicFetch('http://[::1]:9/')).rejects.toThrow(/not a public address/)
    expect(hits()).toBe(0)
  })
})
