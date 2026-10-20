import dgram from 'node:dgram'
import os from 'node:os'
import type { Logger } from 'pino'
import { discoveryPayloadSchema } from './types'

// Discovery of iRobot robots on the LAN: an `irobotmcs` datagram BROADCAST on UDP/5678, and each
// robot answers with its identity card in JSON.
//
// This is what avoids putting an IP address in configuration: the robot is found where it is, and
// an address changed by DHCP catches up on its own at the next round. The BLID returned here is
// the key that links the robot on the network to the password obtained through the account
// (`auth.ts`).

const PORT = 5678
const PROBE = 'irobotmcs'

export interface DiscoveredRobot {
  /** Vendor identifier, stable: it's our `externalId` and the MQTT identifier. */
  blid: string
  ip: string
  /** Name given in the iRobot app. */
  name: string | null
  sku: string | null
  sw: string | null
  /** `mqtt` expected: a robot that announces anything else has no local broker. */
  proto: string | null
  cap: Record<string, unknown>
}

/**
 * Reads a robot's answer. Pure, hence testable on the captured frame.
 *
 * Two generations of robots: recent ones give `robotid`, older ones only put the BLID in
 * `hostname` (`Roomba-<blid>`). The address returned by the robot wins over the datagram's: it's
 * the one it believes it has, and it's the one the broker listens on.
 */
export function parseDiscovery(text: string, fromIp: string): DiscoveredRobot | null {
  if (text === PROBE) return null // our own broadcast comes back on the loopback
  let body: unknown
  try { body = JSON.parse(text) } catch { return null }
  const parsed = discoveryPayloadSchema.safeParse(body)
  if (!parsed.success) return null
  const p = parsed.data
  const blid = p.robotid ?? (p.hostname?.includes('-') ? p.hostname.slice(p.hostname.indexOf('-') + 1) : undefined)
  if (!blid) return null
  return {
    blid,
    ip: p.ip ?? fromIp,
    name: p.robotname ?? null,
    sku: p.sku ?? null,
    sw: p.sw ?? null,
    proto: p.proto ?? null,
    cap: p.cap ?? {},
  }
}

/** Broadcast addresses of the physical IPv4 interfaces, plus the general broadcast as a last resort. */
export function broadcastAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const out = new Set<string>()
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal) continue
      const ip = i.address.split('.').map(Number)
      const mask = i.netmask.split('.').map(Number)
      if (ip.length !== 4 || mask.length !== 4) continue
      out.add(ip.map((o, k) => (o & mask[k]!) | (~mask[k]! & 255)).join('.'))
    }
  }
  out.add('255.255.255.255')
  return [...out]
}

export interface DiscoverOptions {
  /** Listening time. A robot answers within a few tens of milliseconds; 4 s covers a wake-up. */
  timeoutMs?: number
  signal?: AbortSignal
  logger?: Logger
}

/**
 * Broadcasts and collects for `timeoutMs`. Three spaced sends: UDP gets lost, and a robot sleeping
 * on its dock sometimes answers the second one. Never throws — a network that refuses broadcast
 * returns an empty list, and the plugin will say so in its health rather than falling over.
 */
export async function discoverRobots(opts: DiscoverOptions = {}): Promise<DiscoveredRobot[]> {
  const timeoutMs = opts.timeoutMs ?? 4000
  const found = new Map<string, DiscoveredRobot>()

  return new Promise<DiscoveredRobot[]>((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    const timers: NodeJS.Timeout[] = []
    let done = false

    const finish = () => {
      if (done) return
      done = true
      for (const t of timers) clearTimeout(t)
      opts.signal?.removeEventListener('abort', finish)
      try { socket.close() } catch { /* already closed */ }
      resolve([...found.values()])
    }

    socket.on('error', (err) => { opts.logger?.warn({ err }, 'iRobot discovery socket failed'); finish() })
    socket.on('message', (msg, rinfo) => {
      const robot = parseDiscovery(msg.toString(), rinfo.address)
      if (robot) found.set(robot.blid, robot)
    })

    socket.bind(PORT, () => {
      try { socket.setBroadcast(true) } catch { /* some stacks refuse, we try anyway */ }
      const targets = broadcastAddresses()
      for (let n = 0; n < 3; n++) {
        timers.push(setTimeout(() => {
          for (const t of targets) socket.send(PROBE, PORT, t, () => { /* UDP loss: harmless */ })
        }, n * 700))
      }
      timers.push(setTimeout(finish, timeoutMs))
    })

    if (opts.signal?.aborted) finish()
    else opts.signal?.addEventListener('abort', finish, { once: true })
  })
}
