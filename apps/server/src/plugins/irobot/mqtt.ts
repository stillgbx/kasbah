import { MqttClient } from 'mqtt'
import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import { pinnedTlsConnect, type TlsPin } from '../../core/tls-pin'

// LOCAL link with an iRobot robot: its own MQTT broker, over TLS on port 8883.
//
// The robot is both the broker and the only device on it. It authenticates with its BLID as client
// identifier AND as user name, the password being the one obtained once through the account
// (`auth.ts`). The certificate is signed by an in-house iRobot authority, in the robot's name:
// unverifiable from here, hence no chain verification — but the certificate is pinned on first use
// (`core/tls-pin.ts`), and the CONNECT carrying the password only leaves once it matched. Recorded
// on the device set: TLS 1.3, `TLS_AES_256_GCM_SHA384`, no legacy cipher to re-enable.
//
// THE ROBOT SPEAKS IN DELTAS. It doesn't republish its whole shadow on every change: it sends the
// fragment that moves, sometimes a single key. A mapping applied to the received fragment alone
// therefore can't decide a state that depends on two fields (the activity depends on `phase` AND
// `cycle`). Hence the accumulation of a full shadow per robot, and the mapping applied to IT.
//
// ONLY ONE SESSION AT A TIME, AND THE FIRST TO ARRIVE KEEPS IT. Measured on 09/19: a second client
// presenting itself while a first one held the link gets `ECONNREFUSED` — at the TCP level, before
// MQTT even — while the first keeps receiving undisturbed.
//
// What this implies, beyond this file: as long as the Kasbah server holds the link, ANOTHER local
// client can't talk to the robot. The vendor's app normally goes through the cloud, so it doesn't
// suffer from it; but if it switches to local (same network), it will run into us. Not verified
// with the app itself — it would have to be opened while a link is established.
//
// `reconnectPeriod` remains useful for the reverse: if someone gets there before us, or if the
// robot cuts off, we retry until we take back control.

const PORT = 8883
/** The robot's broker cuts off beyond this; below it, we wake it up for nothing. */
const KEEPALIVE_S = 60
const CONNECT_TIMEOUT_MS = 15_000
const RECONNECT_MS = 10_000

/** Topics through which the robot pushes its shadow. `#` covers both generations and the variants. */
const SUBSCRIBE_TOPIC = '#'
/** Command topic. The robot doesn't acknowledge receipt: it answers with a shadow change. */
const COMMAND_TOPIC = 'cmd'

export type RobotShadow = Record<string, unknown>

export interface RobotConnectionOptions {
  blid: string
  password: string
  ip: string
  /** Injected by tests: the broker port. */
  port?: number
  /** The robot certificate must match it before the password is sent. */
  pin: TlsPin
  /** Called on every fragment received, with the ACCUMULATED shadow (never the fragment alone). */
  onShadow?: (shadow: RobotShadow) => void
  onConnected?: () => void
  onDisconnected?: (reason: string) => void
  logger?: Logger
  signal?: AbortSignal
}

/**
 * Deep merge of a fragment into the shadow. An object merges key by key, everything else REPLACES —
 * an array returned by the robot is a whole value (the list of zones of a map), not a sequence to
 * extend.
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

/** The real shadow is a few levels deep; `mergeShadow` recurses once per level. */
const MAX_DEPTH = 32

/** Is `value` nested deeper than `max`? Walked without recursion: the input is what is in doubt. */
function deeperThan(value: unknown, max: number): boolean {
  const stack: [unknown, number][] = [[value, 0]]
  while (stack.length) {
    const [v, depth] = stack.pop()!
    if (v === null || typeof v !== 'object') continue
    if (depth >= max) return true
    for (const child of Object.values(v)) stack.push([child, depth + 1])
  }
  return false
}

/**
 * Extracts the state fragment of a message. The robot publishes sometimes `{state:{reported:{…}}}`
 * (AWS shadow shape), sometimes the bare object on its own topics. Return `null` rather than throw:
 * an unexpected topic must not cut the link. A message nested beyond any real shadow is dropped
 * too: merging it would overflow the stack.
 */
export function extractReported(payload: string): unknown {
  let body: unknown
  try { body = JSON.parse(payload) } catch { return null }
  if (body === null || typeof body !== 'object' || deeperThan(body, MAX_DEPTH)) return null
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
  /** The shadow accumulated since opening. Empty as long as the robot hasn't said anything. */
  shadow(): RobotShadow
  /** Publishes a command and returns as soon as the broker has accepted it. */
  command(name: string, extra?: Record<string, unknown>): Promise<void>
  close(): Promise<void>
}

/**
 * Opens the link. Doesn't throw: the connection happens in the background and retries on its own,
 * with `connected` telling where things stand. A switched-off robot is not a plugin failure.
 */
export function connectRobot(opts: RobotConnectionOptions): RobotConnection {
  let shadow: RobotShadow = {}
  let connected = false
  let closed = false

  // built by hand rather than `mqtt.connect`: its TLS stream cannot wait for the pin
  const client = new MqttClient(() => pinnedTlsConnect({ host: opts.ip, port: opts.port ?? PORT }, opts.pin), {
    clientId: opts.blid,
    username: opts.blid,
    password: opts.password,
    protocolVersion: 4,
    keepalive: KEEPALIVE_S,
    reconnectPeriod: RECONNECT_MS,
    connectTimeout: CONNECT_TIMEOUT_MS,
    clean: false,
  })

  client.on('connect', () => {
    connected = true
    client.subscribe(SUBSCRIBE_TOPIC, { qos: 0 }, (err) => {
      if (err) opts.logger?.warn({ err, blid: opts.blid }, 'iRobot subscribe failed')
    })
    opts.onConnected?.()
  })

  // mqtt.js emits from its packet pump: an exception here would escape it and stop the process
  client.on('message', (_topic, payload) => {
    try {
      const reported = extractReported(payload.toString())
      if (reported === null) return
      const next = mergeShadow(shadow, reported)
      if (next === shadow) return
      shadow = next
      opts.onShadow?.(shadow)
    } catch (err) {
      opts.logger?.warn({ err, blid: opts.blid }, 'iRobot message dropped')
    }
  })

  client.on('close', () => {
    if (!connected) return
    connected = false
    opts.onDisconnected?.('closed')
  })
  client.on('error', (err) => {
    // robot switched off, network down, or someone already holds the session: nothing abnormal, we'll retry
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
        // the robot expects SECONDS, not milliseconds
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
