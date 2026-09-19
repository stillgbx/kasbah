import dgram from 'node:dgram'
import os from 'node:os'
import type { Logger } from 'pino'
import { discoveryPayloadSchema } from './types'

// Découverte des robots iRobot sur le LAN : un datagramme `irobotmcs` en DIFFUSION sur UDP/5678,
// et chaque robot répond par sa carte d'identité en JSON.
//
// C'est ce qui évite de mettre une adresse IP en configuration : le robot est trouvé là où il est,
// et une adresse changée par le DHCP se rattrape toute seule au tour suivant. Le BLID rendu ici
// est la clé qui relie le robot du réseau au mot de passe obtenu par le compte (`auth.ts`).

const PORT = 5678
const PROBE = 'irobotmcs'

export interface DiscoveredRobot {
  /** Identifiant fabricant, stable : c'est notre `externalId` et l'identifiant MQTT. */
  blid: string
  ip: string
  /** Nom donné dans l'appli iRobot. */
  name: string | null
  sku: string | null
  sw: string | null
  /** `mqtt` attendu : un robot qui annonce autre chose n'a pas de courtier local. */
  proto: string | null
  cap: Record<string, unknown>
}

/**
 * Lit une réponse de robot. Pur, donc testable sur la trame capturée.
 *
 * Deux générations de robots : les récents donnent `robotid`, les anciens ne mettent le BLID que
 * dans `hostname` (`Roomba-<blid>`). L'adresse rendue par le robot prime sur celle du datagramme :
 * c'est celle qu'il croit avoir, et c'est celle que le courtier écoute.
 */
export function parseDiscovery(text: string, fromIp: string): DiscoveredRobot | null {
  if (text === PROBE) return null // notre propre diffusion revient sur la boucle locale
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

/** Adresses de diffusion des interfaces IPv4 physiques, plus la diffusion générale en dernier recours. */
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
  /** Durée d'écoute. Un robot répond en quelques dizaines de millisecondes ; 4 s couvre un réveil. */
  timeoutMs?: number
  signal?: AbortSignal
  logger?: Logger
}

/**
 * Diffuse et collecte pendant `timeoutMs`. Trois envois espacés : l'UDP se perd, et un robot qui
 * dort sur sa base répond parfois au deuxième. Ne lève jamais — un réseau qui refuse la diffusion
 * rend une liste vide, et le plugin le dira dans sa santé plutôt que de tomber.
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
      try { socket.close() } catch { /* déjà fermé */ }
      resolve([...found.values()])
    }

    socket.on('error', (err) => { opts.logger?.warn({ err }, 'iRobot discovery socket failed'); finish() })
    socket.on('message', (msg, rinfo) => {
      const robot = parseDiscovery(msg.toString(), rinfo.address)
      if (robot) found.set(robot.blid, robot)
    })

    socket.bind(PORT, () => {
      try { socket.setBroadcast(true) } catch { /* certaines piles refusent, on tente quand même */ }
      const targets = broadcastAddresses()
      for (let n = 0; n < 3; n++) {
        timers.push(setTimeout(() => {
          for (const t of targets) socket.send(PROBE, PORT, t, () => { /* perte d'UDP : sans conséquence */ })
        }, n * 700))
      }
      timers.push(setTimeout(finish, timeoutMs))
    })

    if (opts.signal?.aborted) finish()
    else opts.signal?.addEventListener('abort', finish, { once: true })
  })
}
