import dgram from 'node:dgram'
import os from 'node:os'
import type { Logger } from 'pino'
import { parseSsdpHeaders } from './mapping'

// Découverte SSDP des ZonePlayer Sonos (UDP 1900, multicast 239.255.255.250). Capturé le
// 2026-09-19 : une socket liée à 0.0.0.0 envoie sur la carte APIPA et reste muette. On ouvre
// donc UNE socket par IPv4 (ou celle de SONOS_SSDP_INTERFACE), comme le probe qui a trouvé
// les deux enceintes.

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

export interface DiscoveredSonos {
  uuid: string
  host: string
}

export interface SonosDiscovery {
  start(onUp: (player: DiscoveredSonos) => void): void
  refresh(): void
  stop(): void
}

function ipv4Addresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address)
    }
  }
  return out
}

function openSocket(bindAddr: string, onUp: (player: DiscoveredSonos) => void, logger: Logger): dgram.Socket {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('error', (err) => logger.warn({ err, bindAddr }, 'SSDP socket failed'))
  socket.on('message', (msg) => {
    const found = parseSsdpHeaders(msg.toString())
    if (found) onUp(found)
  })
  socket.bind(0, bindAddr, () => {
    try { socket.setBroadcast(true) } catch { /* pile Windows */ }
    try { socket.setMulticastTTL(2) } catch { /* idem */ }
    try { socket.addMembership(MULTICAST, bindAddr) } catch { /* déjà membre */ }
    try { socket.send(Buffer.from(MSEARCH), SSDP_PORT, MULTICAST) } catch (err) { logger.warn({ err, bindAddr }, 'SSDP send failed') }
  })
  return socket
}

export function createSsdpDiscovery(opts: { iface?: string; logger: Logger }): SonosDiscovery {
  const sockets: dgram.Socket[] = []
  let onUp: ((player: DiscoveredSonos) => void) | null = null

  const sendAll = () => {
    const buf = Buffer.from(MSEARCH)
    for (const socket of sockets) {
      try { socket.send(buf, SSDP_PORT, MULTICAST) } catch (err) { opts.logger.warn({ err }, 'SSDP send failed') }
    }
  }

  return {
    start(cb) {
      onUp = cb
      const addrs = opts.iface ? [opts.iface] : ipv4Addresses()
      if (addrs.length === 0) opts.logger.warn('SSDP: no IPv4 interface to bind')
      for (const addr of addrs) sockets.push(openSocket(addr, (p) => onUp?.(p), opts.logger))
    },
    refresh() { sendAll() },
    stop() {
      for (const socket of sockets) {
        try { socket.close() } catch { /* déjà fermé */ }
      }
      sockets.length = 0
      onUp = null
    },
  }
}
