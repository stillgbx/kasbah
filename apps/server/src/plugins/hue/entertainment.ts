import type { EventEmitter } from 'node:events'
import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import type { ChannelColor, LightArea, LightStream, SavedLights } from '../../core/lightStreamBridge'
import type { HueClient } from './client'
import type { HueEntertainmentConfiguration, HueLight, HuePutBody } from './types'

// Hue Entertainment API: colour frames streamed over DTLS (UDP 2100) to an "entertainment
// configuration" (an area set up in the Hue app). CLIP v2 only starts and stops the stream; the
// frames themselves never go through HTTP. The bridge streams one area at a time, and drops a
// stream that has been silent for 10 s.
//
// Frame (API v2): "HueStream", version 2.0, sequence, colour space, the area's UUID (36 ASCII
// characters), then 7 bytes per channel: channel id + R, G, B on 16 bits big-endian.

export type { ChannelColor }

const HEADER = Buffer.from('HueStream', 'ascii')
const HEADER_LEN = 16
const UUID_LEN = 36
const CHANNEL_LEN = 7
/** The bridge reads at most 20 channels per frame. */
export const MAX_CHANNELS = 20
export const DTLS_PORT = 2100
/** Silence after which the last frame is sent again: well within the bridge's 10 s. */
const KEEPALIVE_MS = 1000
/**
 * One handshake attempt. `node-dtls-client` never retransmits a lost flight (`retransmitHandshake`
 * adds it for the ClientHellos); a dead handshake is cut short and tried again. A good handshake on the local
 * network takes a few tens of milliseconds. Measured on the real bridge: a handshake cut after its
 * second answer leaves the bridge deaf to any new one for 2 to 3 s, unless the area is stopped and
 * started again through CLIP — then the next handshake goes through at once.
 */
const CONNECT_TIMEOUT_MS = 1500
const HANDSHAKE_ATTEMPTS = 3
/** An unanswered ClientHello is sent again this often (mbedTLS, which Hue Sync uses, retransmits too). */
const RETRANSMIT_MS = 500
const MAX_RETRANSMITS = 10
const RECORD_HEADER_LEN = 13
/**
 * Record sequence number of the first resent record: above the few the library uses for the whole
 * handshake in epoch 0, and within its replay window (it drops answers above 127; the bridge's answer
 * carries the number of the record it answers).
 */
const RETRANSMIT_FIRST_SEQ = 16

const to16 = (v: number) => Math.round(Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0)) * 0xffff)

export function encodeFrame(configId: string, sequence: number, channels: readonly ChannelColor[]): Buffer {
  if (configId.length !== UUID_LEN) throw new Error(`entertainment configuration id must be a ${UUID_LEN}-character UUID`)
  const list = channels.slice(0, MAX_CHANNELS)
  const buf = Buffer.alloc(HEADER_LEN + UUID_LEN + list.length * CHANNEL_LEN)
  HEADER.copy(buf, 0)
  buf[9] = 0x02          // API version 2.0
  buf[10] = 0x00
  buf[11] = sequence & 0xff
  // 12-13 reserved, 14 colour space (0 = RGB), 15 reserved: all zero
  buf.write(configId, HEADER_LEN, 'ascii')
  let o = HEADER_LEN + UUID_LEN
  for (const c of list) {
    buf[o] = c.id & 0xff
    buf.writeUInt16BE(to16(c.r), o + 1)
    buf.writeUInt16BE(to16(c.g), o + 3)
    buf.writeUInt16BE(to16(c.b), o + 5)
    o += CHANNEL_LEN
  }
  return buf
}

export function toLightArea(cfg: HueEntertainmentConfiguration): LightArea {
  return {
    id: cfg.id,
    name: cfg.metadata?.name ?? cfg.id,
    channels: cfg.channels.map((c) => ({ id: c.channel_id, x: c.position.x, y: c.position.y, z: c.position.z })),
  }
}

/** Hue light rids of an area. */
export function areaLights(cfg: HueEntertainmentConfiguration): string[] {
  return cfg.light_services.filter((s) => s.rtype === 'light').map((s) => s.rid)
}

/** The lights of an area before a stream: the PUT that brings each one back. */
export interface HueSavedLights extends SavedLights {
  lights: { id: string; body: HuePutBody }[]
}

/** Transition when the lights get their state back after the music sync. */
const RESTORE_TRANSITION_MS = 1000

/**
 * PUT that brings a light back to `saved`, its state before a stream. A light that was off only
 * gets switched off: the bridge does not take a colour or a brightness for a light that is off.
 */
export function restoreBody(saved: HueLight): HuePutBody {
  const dynamics = { duration: RESTORE_TRANSITION_MS }
  if (saved.on?.on === false) return { on: { on: false }, dynamics }
  const body: HuePutBody = { on: { on: true }, dynamics }
  if (saved.dimming) body.dimming = { brightness: saved.dimming.brightness }
  const ct = saved.color_temperature
  if (ct?.mirek_valid && typeof ct.mirek === 'number') body.color_temperature = { mirek: ct.mirek }
  else if (saved.color?.xy) body.color = { xy: saved.color.xy }
  return body
}

/**
 * The area for a room. At least half its lights are in the room: an area drawn over an open space
 * (a lamp of the next room in it) still serves, that lamp following the music too; one that is
 * mostly elsewhere does not. Preferred, in order: no light outside the room, the most room lights,
 * the fewest outside, the most channels. `roomLights` = Hue light rids.
 */
export function pickArea(areas: readonly HueEntertainmentConfiguration[], roomLights: ReadonlySet<string>): HueEntertainmentConfiguration | undefined {
  let best: { area: HueEntertainmentConfiguration; key: number[] } | undefined
  for (const a of areas) {
    const lights = a.light_services.filter((s) => s.rtype === 'light').map((s) => s.rid)
    const inside = lights.filter((rid) => roomLights.has(rid)).length
    if (inside === 0 || inside * 2 < lights.length || a.channels.length === 0) continue
    const outside = lights.length - inside
    const key = [outside === 0 ? 1 : 0, inside, -outside, a.channels.length]
    if (!best || isGreater(key, best.key)) best = { area: a, key }
  }
  return best?.area
}

/** Lexicographic comparison of two keys of the same length. */
function isGreater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

/** What the stream needs from a DTLS socket (`node-dtls-client`'s, or a fake in the tests). */
export interface DtlsSocket extends EventEmitter {
  send(data: Buffer): void
  close(): void
  /** The plain UDP socket underneath (`node-dtls-client`'s): only read to tell a failed handshake apart. */
  udp?: EventEmitter
}
export type DtlsConnect = (opts: { host: string; port: number; identity: string; psk: Buffer }) => DtlsSocket

type UdpSend = (msg: Buffer | Uint8Array, ...rest: unknown[]) => void

/** Every record of the datagram is in epoch 0 (plaintext): the ClientHellos, not the encrypted Finished. */
function isPlaintextFlight(buf: Buffer): boolean {
  let records = 0
  for (let i = 0; i + RECORD_HEADER_LEN <= buf.length; i += RECORD_HEADER_LEN + buf.readUInt16BE(i + 11)) {
    if (buf.readUInt16BE(i + 3) !== 0) return false
    records++
  }
  return records > 0
}

/**
 * DTLS retransmission, which `node-dtls-client` lacks: a plaintext handshake flight left unanswered
 * is sent again every RETRANSMIT_MS, with new record sequence numbers, until an answer comes.
 * Measured on the real bridge (2026-11-07): after a stream ends it ignores, for 15 s to over 3 min,
 * the ClientHello carrying its cookie — but answers the same message resent 500 ms later, every time.
 * Encrypted flights are not resent: the sequence number is part of what their records authenticate.
 */
export function retransmitHandshake(socket: DtlsSocket, clock: Clock): void {
  const udp = socket.udp as (EventEmitter & { send?: UdpSend }) | undefined
  if (!udp || typeof udp.send !== 'function') return
  const send = udp.send.bind(udp)
  let flight: { buf: Buffer; rest: unknown[] } | null = null
  let timer: unknown = null
  let resent = 0
  let done = false
  const disarm = () => { if (timer !== null) clock.clearTimeout(timer); timer = null }
  const arm = () => {
    disarm()
    if (done || !flight || resent >= MAX_RETRANSMITS) return
    timer = clock.setTimeout(() => {
      timer = null
      if (done || !flight) return
      const again = Buffer.from(flight.buf)
      for (let i = 0; i + RECORD_HEADER_LEN <= again.length; i += RECORD_HEADER_LEN + again.readUInt16BE(i + 11)) {
        again.writeUIntBE(RETRANSMIT_FIRST_SEQ + resent++, i + 5, 6)
      }
      try { send(again, ...flight.rest) } catch { done = true; return }   // socket closed meanwhile
      arm()
    }, RETRANSMIT_MS)
  }
  udp.send = (msg, ...rest) => {
    const buf = Buffer.from(msg)
    flight = !done && isPlaintextFlight(buf) ? { buf, rest } : null
    arm()
    send(msg, ...rest)
  }
  // ahead of the library's own listener: an answer stops the timer before the next flight starts its own
  udp.prependListener('message', disarm)
  for (const event of ['connected', 'error', 'close']) socket.once(event, () => { done = true; disarm() })
}

export async function defaultDtlsConnect(opts: { host: string; port: number; identity: string; psk: Buffer }): Promise<DtlsSocket> {
  const { dtls } = await import('node-dtls-client')
  return dtls.createSocket({
    type: 'udp4', address: opts.host, port: opts.port, timeout: CONNECT_TIMEOUT_MS,
    psk: { [opts.identity]: opts.psk },
    ciphers: ['TLS_PSK_WITH_AES_128_GCM_SHA256'],
  }) as unknown as DtlsSocket
}

export interface OpenStreamOpts {
  client: HueClient
  area: LightArea
  host: string
  appKey: string
  /** 32 hex characters, from the pairing. */
  clientKey: string
  connect: (opts: { host: string; port: number; identity: string; psk: Buffer }) => DtlsSocket | Promise<DtlsSocket>
  clock: Clock
  logger: Logger
}

/** The stream, plus what only the plugin may do: end it from outside (the bridge said it stopped). */
export interface HueLightStream extends LightStream {
  /** Ends the stream as if the bridge had closed it: `onEnded` callbacks get `reason`. */
  abort(reason: string): Promise<void>
}

/** How often the event loop is sampled during the handshake (a late timer = a busy process). */
const LAG_SAMPLE_MS = 100

/** Starts the area, opens the DTLS session, and returns the stream once the handshake is done. */
export async function openStream(o: OpenStreamOpts): Promise<HueLightStream> {
  await o.client.entertainmentAction(o.area.id, 'start')
  let socket: DtlsSocket
  // A failed handshake says only "timed out". Two things tell its causes apart: whether the bridge
  // answered at all (key or network), and how late the timers ran (a process too busy to read the
  // answers before its own timeout fires)
  let packets = 0
  /** Tries the bridge did not answer at all. */
  let unanswered = 0
  let maxLagMs = 0
  let sampler: unknown = null
  const sample = (expected: number) => {
    sampler = o.clock.setTimeout(() => {
      maxLagMs = Math.max(maxLagMs, o.clock.now() - expected)
      sample(o.clock.now() + LAG_SAMPLE_MS)
    }, LAG_SAMPLE_MS)
  }
  sample(o.clock.now() + LAG_SAMPLE_MS)
  const attempt = async (): Promise<DtlsSocket> => {
    const s = await o.connect({ host: o.host, port: DTLS_PORT, identity: o.appKey, psk: Buffer.from(o.clientKey, 'hex') })
    retransmitHandshake(s, o.clock)
    let got = 0
    s.udp?.on('message', () => { packets++; got++ })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = o.clock.setTimeout(() => reject(new Error('DTLS handshake timed out')), CONNECT_TIMEOUT_MS + 500)
        s.once('connected', () => { o.clock.clearTimeout(timer); resolve() })
        s.once('error', (err: Error) => { o.clock.clearTimeout(timer); reject(err) })
      })
      return s
    } catch (err) {
      if (got === 0) unanswered++
      try { s.close() } catch { /* the library already closed it */ }
      throw err
    }
  }
  let attempts = 0
  try {
    for (;;) {
      attempts++
      try {
        socket = await attempt()
        break
      } catch (err) {
        // only silence is worth another try: an alert (wrong key) would be answered the same way
        if (attempts >= HANDSHAKE_ATTEMPTS || !/timed out/i.test((err as Error).message)) throw err
        o.logger.debug({ area: o.area.id, attempts, packets }, 'Hue: DTLS handshake timed out, trying again')
        // the half-done handshake would keep the bridge deaf: stopping and starting the area clears it
        await o.client.entertainmentAction(o.area.id, 'stop').catch(() => {})
        await o.client.entertainmentAction(o.area.id, 'start')
      }
    }
    if (attempts > 1) o.logger.info({ area: o.area.id, attempts }, 'Hue: DTLS handshake done after a retry')
  } catch (err) {
    await o.client.entertainmentAction(o.area.id, 'stop').catch(() => {})
    // measured on a real bridge: after a stream ends, it answers the first message of a new handshake
    // and then nothing, for 15 s to over 3 min, whatever the client does (area restarted, same port…)
    const refused = unanswered === 0 && /timed out/i.test((err as Error).message)
      ? ': the bridge answered the first message of each try only, as it does for 15 s to 3 min after a stream ended'
      : ''
    const why = `${(err as Error).message} (${attempts} attempt(s), ${packets} packet(s) from the bridge, timers up to ${Math.round(maxLagMs)} ms late)${refused}`
    o.logger.warn({ host: o.host, area: o.area.id, attempts, packets, maxLagMs: Math.round(maxLagMs) }, 'Hue: DTLS handshake failed')
    throw new Error(why, { cause: err })
  } finally {
    if (sampler !== null) o.clock.clearTimeout(sampler)
  }

  let seq = 0
  let last: readonly ChannelColor[] | null = null
  let lastSentAt = o.clock.now()
  let closed = false
  const ended: ((reason: string) => void)[] = []

  const write = (colors: readonly ChannelColor[]) => {
    // the library throws on a socket it closed itself (fatal alert, UDP error): end the stream,
    // never let it escape into a timer callback
    try { socket.send(encodeFrame(o.area.id, seq++, colors)) }
    catch (err) { void finish(`sending failed (${(err as Error).message})`); return }
    lastSentAt = o.clock.now()
  }
  const keepalive = () => {
    if (closed) return
    if (last && o.clock.now() - lastSentAt >= KEEPALIVE_MS) write(last)
    keepTimer = o.clock.setTimeout(keepalive, KEEPALIVE_MS)
  }
  let keepTimer: unknown = o.clock.setTimeout(keepalive, KEEPALIVE_MS)

  const finish = async (reason: string | null) => {
    if (closed) return
    closed = true
    o.clock.clearTimeout(keepTimer)
    try { socket.close() } catch { /* already gone */ }
    await o.client.entertainmentAction(o.area.id, 'stop').catch((err) => o.logger.debug({ err }, 'Hue: stopping the stream failed'))
    if (reason) for (const cb of ended) cb(reason)
  }
  socket.on('error', (err: Error) => { o.logger.warn({ err }, 'Hue entertainment stream failed'); void finish(err.message) })
  socket.on('close', () => { void finish('stream closed by the bridge') })

  return {
    area: o.area,
    send(colors) {
      if (closed) return
      last = colors
      write(colors)
    },
    close: () => finish(null),
    abort: (reason) => finish(reason),
    onEnded(cb) { ended.push(cb) },
  }
}
