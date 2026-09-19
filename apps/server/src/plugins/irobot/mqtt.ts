import mqtt, { type MqttClient } from 'mqtt'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'

// Lien LOCAL avec un robot iRobot : son propre courtier MQTT, en TLS sur le port 8883.
//
// Le robot est à la fois le courtier et le seul appareil dessus. Il s'authentifie avec son BLID en
// identifiant ET en mot de passe d'utilisateur, le mot de passe étant celui obtenu une fois par le
// compte (`auth.ts`). Le certificat est signé par une autorité iRobot maison, au nom du robot :
// invérifiable depuis ici, donc `rejectUnauthorized: false` — le secret qui protège la liaison est
// le mot de passe, pas la chaîne de certification. Relevé sur le parc : TLS 1.3,
// `TLS_AES_256_GCM_SHA384`, aucun chiffre hérité à réactiver.
//
// LE ROBOT PARLE EN DELTAS. Il ne republie pas son ombre entière à chaque changement : il envoie le
// fragment qui bouge, parfois une seule clé. Un mappage appliqué au seul fragment reçu ne peut donc
// pas décider d'un état qui dépend de deux champs (l'activité tient à `phase` ET `cycle`). D'où
// l'accumulation d'une ombre complète par robot, et le mappage appliqué à ELLE.
//
// UNE SEULE SESSION À LA FOIS, ET C'EST LE PREMIER ARRIVÉ QUI LA GARDE. Mesuré le 19/09 : un second
// client présenté pendant qu'un premier tenait le lien reçoit `ECONNREFUSED` — au niveau TCP, avant
// même MQTT — tandis que le premier continue de recevoir sans être inquiété.
//
// Ce que cela implique, et qui dépasse ce fichier : tant que le serveur Kasbah tient le lien, un
// AUTRE client local ne peut pas parler au robot. L'appli du fabricant passe normalement par le
// cloud, donc elle n'en souffre pas ; mais si elle bascule en local (même réseau), elle se heurtera
// à nous. Non vérifié avec l'appli elle-même — il faudrait l'ouvrir pendant qu'un lien est établi.
//
// `reconnectPeriod` reste utile pour l'inverse : si quelqu'un nous précède, ou si le robot coupe,
// on retente jusqu'à reprendre la main.

const PORT = 8883
/** Le courtier du robot coupe au-delà ; en deçà, on le réveille pour rien. */
const KEEPALIVE_S = 60
const CONNECT_TIMEOUT_MS = 15_000
const RECONNECT_MS = 10_000

/** Topics par lesquels le robot pousse son ombre. `#` couvre les deux générations et les variantes. */
const SUBSCRIBE_TOPIC = '#'
/** Topic des commandes. Le robot n'accuse pas réception : il répond par un changement d'ombre. */
const COMMAND_TOPIC = 'cmd'

export type RobotShadow = Record<string, unknown>

export interface RobotConnectionOptions {
  blid: string
  password: string
  ip: string
  /** Appelé à chaque fragment reçu, avec l'ombre ACCUMULÉE (jamais le seul fragment). */
  onShadow?: (shadow: RobotShadow) => void
  onConnected?: () => void
  onDisconnected?: (reason: string) => void
  logger?: Logger
  signal?: AbortSignal
  /** Injecté par les tests : remplace l'ouverture réelle du client MQTT. */
  connectImpl?: typeof mqtt.connect
}

/**
 * Fusion profonde d'un fragment dans l'ombre. Un objet se fond clé à clé, tout le reste REMPLACE —
 * un tableau rendu par le robot est une valeur entière (la liste des zones d'une carte), pas une
 * suite à compléter.
 */
export function mergeShadow(base: RobotShadow, patch: unknown): RobotShadow {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: RobotShadow = { ...base }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const prev = out[k]
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && prev !== null && typeof prev === 'object' && !Array.isArray(prev)) {
      out[k] = mergeShadow(prev as RobotShadow, v)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * Extrait le fragment d'état d'un message. Le robot publie tantôt `{state:{reported:{…}}}` (forme
 * d'ombre AWS), tantôt l'objet nu sur ses topics propres. Rendre `null` plutôt que lever : un topic
 * inattendu ne doit pas couper la liaison.
 */
export function extractReported(payload: string): unknown {
  let body: unknown
  try { body = JSON.parse(payload) } catch { return null }
  if (body === null || typeof body !== 'object') return null
  const state = (body as Record<string, unknown>).state
  if (state !== null && typeof state === 'object') {
    const reported = (state as Record<string, unknown>).reported
    if (reported !== null && typeof reported === 'object') return reported
    return state
  }
  return body
}

export interface RobotConnection {
  readonly blid: string
  readonly connected: boolean
  /** L'ombre accumulée depuis l'ouverture. Vide tant que le robot n'a rien dit. */
  shadow(): RobotShadow
  /** Publie une commande et rend la main dès que le courtier l'a acceptée. */
  command(name: string, extra?: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

/**
 * Ouvre la liaison. Ne lève pas : la connexion se fait en tâche de fond et se retente toute seule,
 * `connected` disant où l'on en est. Un robot éteint n'est pas une panne du plugin.
 */
export function connectRobot(opts: RobotConnectionOptions): RobotConnection {
  let shadow: RobotShadow = {}
  let connected = false
  let closed = false

  const connectFn = opts.connectImpl ?? mqtt.connect
  const client: MqttClient = connectFn(`mqtts://${opts.ip}:${PORT}`, {
    clientId: opts.blid,
    username: opts.blid,
    password: opts.password,
    protocolVersion: 4,
    keepalive: KEEPALIVE_S,
    reconnectPeriod: RECONNECT_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
    clean: false,
    // certificat iRobot au nom du robot, signé par une autorité maison : invérifiable ici
    rejectUnauthorized: false,
  })

  client.on('connect', () => {
    connected = true
    client.subscribe(SUBSCRIBE_TOPIC, { qos: 0 }, (err) => {
      if (err) opts.logger?.warn({ err, blid: opts.blid }, 'iRobot subscribe failed')
    })
    opts.onConnected?.()
  })

  client.on('message', (_topic, payload) => {
    const reported = extractReported(payload.toString())
    if (reported === null) return
    const next = mergeShadow(shadow, reported)
    if (next === shadow) return
    shadow = next
    opts.onShadow?.(shadow)
  })

  client.on('close', () => {
    if (!connected) return
    connected = false
    opts.onDisconnected?.('closed')
  })
  client.on('error', (err) => {
    // robot éteint, réseau coupé, ou quelqu'un tient déjà la session : rien d'anormal, on retentera
    opts.logger?.debug({ err: err.message, blid: opts.blid }, 'iRobot link error')
  })

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    connected = false
    await new Promise<void>((resolve) => { client.end(true, {}, () => resolve()) })
  }

  if (opts.signal?.aborted) void close()
  else opts.signal?.addEventListener('abort', () => { void close() }, { once: true })

  return {
    blid: opts.blid,
    get connected() { return connected },
    shadow: () => shadow,
    async command(name: string, extra: Record<string, unknown> = {}): Promise<void> {
      if (closed) throw new PluginError('DEVICE_UNAVAILABLE', `iRobot ${opts.blid} link is closed`)
      if (!connected) throw new PluginError('DEVICE_UNAVAILABLE', `iRobot ${opts.blid} is not reachable on the network`)
      const body = JSON.stringify({
        command: name,
        // le robot attend des SECONDES, pas des millisecondes
        time: Math.floor(Date.now() / 1000),
        initiator: 'localApp',
        ...extra,
      })
      await new Promise<void>((resolve, reject) => {
        client.publish(COMMAND_TOPIC, body, { qos: 0 }, (err) => {
          if (err) reject(new PluginError('UPSTREAM_ERROR', `iRobot refused command ${name}: ${err.message}`))
          else resolve()
        })
      })
    },
    close,
  }
}
