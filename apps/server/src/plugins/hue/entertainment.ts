import type { EventEmitter } from 'node:events'
import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import type { ChannelColor, LightArea, LightStream } from '../../core/lightStreamBridge'
import type { HueClient } from './client'
import type { HueEntertainmentConfiguration } from './types'

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
const CONNECT_TIMEOUT_MS = 3000

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

/**
 * The area for a room: all its lights are in the room (a light next door would blink in the wrong
 * room), it covers the most room lights, then has the most channels. `roomLights` = Hue light rids.
 */
export function pickArea(areas: readonly HueEntertainmentConfiguration[], roomLights: ReadonlySet<string>): HueEntertainmentConfiguration | undefined {
  let best: HueEntertainmentConfiguration | undefined
  for (const a of areas) {
    const lights = a.light_services.filter((s) => s.rtype === 'light').map((s) => s.rid)
    if (lights.length === 0 || !lights.every((rid) => roomLights.has(rid)) || a.channels.length === 0) continue
    const bestLights = best?.light_services.length ?? 0
    if (!best || lights.length > bestLights || (lights.length === bestLights && a.channels.length > best.channels.length)) best = a
  }
  return best
}

/** What the stream needs from a DTLS socket (`node-dtls-client`'s, or a fake in the tests). */
export interface DtlsSocket extends EventEmitter {
  send(data: Buffer): void
  close(): void
}
export type DtlsConnect = (opts: { host: string; port: number; identity: string; psk: Buffer }) => DtlsSocket

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

/** Starts the area, opens the DTLS session, and returns the stream once the handshake is done. */
export async function openStream(o: OpenStreamOpts): Promise<HueLightStream> {
  await o.client.entertainmentAction(o.area.id, 'start')
  let socket: DtlsSocket
  try {
    socket = await o.connect({ host: o.host, port: DTLS_PORT, identity: o.appKey, psk: Buffer.from(o.clientKey, 'hex') })
    await new Promise<void>((resolve, reject) => {
      const timer = o.clock.setTimeout(() => reject(new Error('DTLS handshake timed out')), CONNECT_TIMEOUT_MS + 500)
      socket.once('connected', () => { o.clock.clearTimeout(timer); resolve() })
      socket.once('error', (err: Error) => { o.clock.clearTimeout(timer); reject(err) })
    })
  } catch (err) {
    await o.client.entertainmentAction(o.area.id, 'stop').catch(() => {})
    throw err
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
