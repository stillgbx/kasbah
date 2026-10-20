/**
 * SURVEY (throwaway): finds the Sonos speakers on the LAN and captures what the local doors
 * really return — SSDP, HTTP :1400, read-only SOAP, WebSocket :1443. Used to decide the
 * plugin's door (UPnP vs WS vs cloud) from a capture, not from the spec.
 *
 *   npx tsx tools/sonos-probe.mts           # SSDP then probe of each reply
 *   npx tsx tools/sonos-probe.mts 192.168.1.12 # known IP, SSDP in addition
 *
 * Read-only: no transport command is sent.
 */
import dgram from 'node:dgram'
import os from 'node:os'
import { request as httpRequest } from 'node:http'
import { WebSocket } from 'ws'

const argIp = process.argv[2]
const SSDP_WAIT_MS = 4000
const HTTP_TIMEOUT_MS = 5000
const WS_WAIT_MS = 4000
const MULTICAST = '239.255.255.250'
const SSDP_PORT = 1900

const MSEARCH = [
  'M-SEARCH * HTTP/1.1',
  `HOST: ${MULTICAST}:${SSDP_PORT}`,
  'MAN: "ssdp:discover"',
  'MX: 2',
  'ST: urn:schemas-upnp-org:device:ZonePlayer:1',
  '',
  '',
].join('\r\n')

function log(title: string, body?: string): void {
  console.log(`\n=== ${title} ===`)
  if (body !== undefined) console.log(body.length > 4000 ? `${body.slice(0, 4000)}\n… (${body.length} octets)` : body)
}

function ipv4Ifaces(): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = []
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push({ name, address: i.address })
    }
  }
  return out
}

function parseSsdpLocation(msg: string): string | undefined {
  const line = msg.split(/\r?\n/).find((l) => /^location:/i.test(l))
  const value = line?.slice(line.indexOf(':') + 1).trim()
  if (!value) return undefined
  try { return new URL(value).hostname } catch { return undefined }
}

async function ssdpOnInterface(address: string): Promise<string[]> {
  const found = new Set<string>()
  await new Promise<void>((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const finish = () => { try { socket.close() } catch { /* already closed */ }; resolve() }
    socket.on('error', (err) => { console.log(`SSDP ${address} erreur: ${err.message}`); finish() })
    socket.on('message', (buf, rinfo) => {
      const text = buf.toString()
      if (!/sonos|zoneplayer|upnp:rootdevice/i.test(text)) return
      const host = parseSsdpLocation(text) ?? rinfo.address
      if (!found.has(host)) {
        found.add(host)
        console.log(`SSDP ← ${host} (via ${address})\n${text.split(/\r?\n/).slice(0, 10).join('\n')}`)
      }
    })
    socket.bind(0, address, () => {
      try { socket.setBroadcast(true) } catch { /* pile Windows */ }
      try { socket.setMulticastTTL(2) } catch { /* idem */ }
      try { socket.addMembership(MULTICAST, address) } catch { /* already a member */ }
      const buf = Buffer.from(MSEARCH)
      socket.send(buf, SSDP_PORT, MULTICAST)
      socket.send(buf, SSDP_PORT, '255.255.255.255')
      socket.send(buf, SSDP_PORT, address.replace(/\.\d+$/, '.255'))
      setTimeout(finish, SSDP_WAIT_MS)
    })
  })
  return [...found]
}

async function ssdpDiscover(): Promise<string[]> {
  const ifaces = ipv4Ifaces()
  log('interfaces IPv4', ifaces.map((i) => `${i.name} ${i.address}`).join('\n') || '(aucune)')
  const found = new Set<string>()
  for (const i of ifaces) {
    for (const ip of await ssdpOnInterface(i.address)) found.add(ip)
  }
  return [...found]
}

/** Fallback if multicast is filtered: a Sonos listens on HTTP :1400. */
async function scanPort1400(prefix: string): Promise<string[]> {
  const found: string[] = []
  const batch = 40
  log(`scan ${prefix}.1-254:1400`)
  for (let start = 1; start <= 254; start += batch) {
    const end = Math.min(254, start + batch - 1)
    await Promise.all(Array.from({ length: end - start + 1 }, (_, k) => {
      const ip = `${prefix}.${start + k}`
      return new Promise<void>((resolve) => {
        const req = httpRequest({ hostname: ip, port: 1400, path: '/status/zp', method: 'GET', timeout: 800 }, (res) => {
          res.resume()
          found.push(ip)
          console.log(`:1400 ouvert ${ip} (${res.statusCode})`)
          resolve()
        })
        req.on('timeout', () => { req.destroy(); resolve() })
        req.on('error', () => resolve())
        req.end()
      })
    }))
  }
  return found
}

function httpGet(url: string): Promise<{ status: number; body: string; headers: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'GET', timeout: HTTP_TIMEOUT_MS }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: Object.entries(res.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n'),
      }))
    })
    req.on('timeout', () => { req.destroy(); reject(new Error(`timeout ${url}`)) })
    req.on('error', reject)
    req.end()
  })
}

function soap(ip: string, path: string, urn: string, action: string, innerXml: string): Promise<{ status: number; body: string }> {
  const envelope = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${urn}">${innerXml}</u:${action}></s:Body></s:Envelope>`
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: ip,
      port: 1400,
      path,
      method: 'POST',
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        SOAPAction: `"${urn}#${action}"`,
        'Content-Length': Buffer.byteLength(envelope),
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => { req.destroy(); reject(new Error(`SOAP timeout ${action}`)) })
    req.on('error', reject)
    req.write(envelope)
    req.end()
  })
}

async function probeHttp(ip: string): Promise<void> {
  for (const path of ['/status/info', '/status/zp', '/xml/device_description.xml']) {
    try {
      const r = await httpGet(`http://${ip}:1400${path}`)
      log(`GET :1400${path} → ${r.status}`, r.body)
    } catch (err) {
      log(`GET :1400${path} ÉCHEC`, (err as Error).message)
    }
  }
}

async function probeSoap(ip: string): Promise<void> {
  const rc = 'urn:schemas-upnp-org:service:RenderingControl:1'
  const av = 'urn:schemas-upnp-org:service:AVTransport:1'
  const zg = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1'
  const calls: [string, string, string, string][] = [
    ['/MediaRenderer/RenderingControl/Control', rc, 'GetVolume', '<InstanceID>0</InstanceID><Channel>Master</Channel>'],
    ['/MediaRenderer/RenderingControl/Control', rc, 'GetMute', '<InstanceID>0</InstanceID><Channel>Master</Channel>'],
    ['/MediaRenderer/AVTransport/Control', av, 'GetTransportInfo', '<InstanceID>0</InstanceID>'],
    ['/MediaRenderer/AVTransport/Control', av, 'GetPositionInfo', '<InstanceID>0</InstanceID>'],
    ['/MediaRenderer/AVTransport/Control', av, 'GetMediaInfo', '<InstanceID>0</InstanceID>'],
    ['/ZoneGroupTopology/Control', zg, 'GetZoneGroupState', ''],
  ]
  for (const [path, urn, action, inner] of calls) {
    try {
      const r = await soap(ip, path, urn, action, inner)
      log(`SOAP ${action} → ${r.status}`, r.body)
    } catch (err) {
      log(`SOAP ${action} ÉCHEC`, (err as Error).message)
    }
  }
}

function probeWs(ip: string, withKey: boolean): Promise<string> {
  return new Promise((resolve) => {
    const headers: Record<string, string> = { 'Sec-WebSocket-Protocol': 'v1.api.smartspeaker.audio' }
    if (withKey) headers['X-Sonos-Api-Key'] = 'probe'
    const ws = new WebSocket(`wss://${ip}:1443/websocket/api`, {
      rejectUnauthorized: false,
      handshakeTimeout: HTTP_TIMEOUT_MS,
      headers,
    })
    const lines: string[] = []
    const finish = (why: string) => {
      lines.push(`fin: ${why}`)
      try { ws.close() } catch { /* already closed */ }
      resolve(lines.join('\n'))
    }
    ws.on('upgrade', (res) => lines.push(`upgrade ${res.statusCode} ${JSON.stringify(res.headers)}`))
    ws.on('unexpectedResponse', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => finish(`HTTP ${res.statusCode} ${Buffer.concat(chunks).toString('utf8').slice(0, 500)}`))
    })
    ws.on('open', () => {
      lines.push('open')
      ws.send(JSON.stringify([{ namespace: 'groups', command: 'getGroups' }, {}]))
    })
    ws.on('message', (data) => lines.push(`message ${String(data).slice(0, 1500)}`))
    ws.on('error', (err) => lines.push(`erreur ${err.message}`))
    ws.on('close', (code, reason) => finish(`close ${code} ${reason.toString()}`))
    setTimeout(() => finish('timeout'), WS_WAIT_MS)
  })
}

async function probePlayer(ip: string): Promise<void> {
  log(`enceinte ${ip}`)
  await probeHttp(ip)
  await probeSoap(ip)
  log('WSS :1443 sans clé', await probeWs(ip, false))
  log('WSS :1443 avec X-Sonos-Api-Key=probe', await probeWs(ip, true))
}

const ips = new Set<string>()
if (argIp) ips.add(argIp)
for (const ip of await ssdpDiscover()) ips.add(ip)
if (ips.size === 0) {
  const lan = ipv4Ifaces().find((i) => !i.address.startsWith('169.254'))
  if (lan) {
    const prefix = lan.address.split('.').slice(0, 3).join('.')
    for (const ip of await scanPort1400(prefix)) ips.add(ip)
  }
}
if (ips.size === 0) {
  log('aucune enceinte trouvée (SSDP muet, :1400 fermé, pas d\'IP en argument)')
  process.exit(1)
}
for (const ip of ips) await probePlayer(ip)
log('fin du relevé')
