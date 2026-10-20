import type { Duplex } from 'node:stream'
import { connect as tlsConnect } from 'node:tls'
import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import { withTimeout } from '../../core/poll'
import { activeApplication, isLive, DEFAULT_MEDIA_RECEIVER, mediaFromUrl, type PlayUrlMeta } from './mapping'
import { FrameDecoder, NS_CONNECTION, NS_HEARTBEAT, NS_MEDIA, NS_RECEIVER, RECEIVER_ID, SENDER_ID, encodeFrame, jsonMessage, type CastMessage } from './protocol'
import { inboundSchema, mediaStatusSchema, receiverStatusSchema, type MediaStatus, type ReceiverApplication, type ReceiverStatus } from './types'

// A Cast connection to ONE device: TLS socket (device-specific certificate, not signed by a public
// authority), CONNECT to the receiver, PING / PONG heartbeat, and two channels:
//  - `receiver` (volume, current app): the receiver PUSHES a RECEIVER_STATUS on every change once
//    we are connected;
//  - `media`: to open towards the transportId of the running app, which then pushes its MEDIA_STATUS.
// A request carries a `requestId` and the response echoes it: it is the ack `execute` waits for.

export type SocketFactory = (host: string, port: number) => Promise<Duplex>

/** Real TLS socket, resolved once the handshake is done. */
export const tlsSocketFactory: SocketFactory = (host, port) => new Promise((resolve, reject) => {
  const socket = tlsConnect({ host, port, rejectUnauthorized: false }, () => { socket.off('error', reject); resolve(socket) })
  socket.once('error', reject)
})

export interface CastConnectionOptions {
  host: string
  port: number
  connect: SocketFactory
  clock: Clock
  logger: Logger
  onReceiverStatus(status: ReceiverStatus): void
  /** `media` missing = no more session (app closed, queue finished). */
  onMediaStatus(media: MediaStatus | undefined, app: ReceiverApplication | undefined): void
  onClose(reason: string): void
  heartbeatMs?: number
  requestTimeoutMs?: number
  /** Rate for re-reading the position during playback (the receiver does not push it on its own). */
  mediaPollMs?: number
}

const DEFAULT_HEARTBEAT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 5000
const DEFAULT_MEDIA_POLL_MS = 10_000
/** "Previous" past this point in the track goes back to its start, as on a remote control. */
const RESTART_AFTER_S = 3

interface Pending { resolve(msg: Record<string, unknown>): void; reject(err: Error): void }

export class CastConnection {
  private socket: Duplex | null = null
  private readonly decoder = new FrameDecoder()
  private requestId = 0
  private readonly pending = new Map<number, Pending>()
  private heartbeat: unknown = null
  private mediaPoll: unknown = null
  private lastSeen = 0
  private closed = false
  /** True once a playback state has been published (even "nothing playing"): the first RECEIVER_STATUS must do it. */
  private mediaReported = false
  /** Current app (excluding the idle screen) and known media session. */
  app: ReceiverApplication | undefined = undefined
  media: MediaStatus | undefined = undefined
  lastReceiverStatus: ReceiverStatus | undefined = undefined
  lastMediaRaw: unknown = undefined
  /** Clock time of the last media state received: the known position dates from then. */
  private mediaAt = 0

  constructor(private readonly opts: CastConnectionOptions) {}

  /** Connects, announces itself, starts the heartbeat and returns the receiver's first state. */
  async open(): Promise<ReceiverStatus> {
    const { clock } = this.opts
    const socket = await withTimeout(this.opts.connect(this.opts.host, this.opts.port), this.timeoutMs, clock, `connect ${this.opts.host}`)
    this.socket = socket
    this.lastSeen = clock.now()
    socket.on('data', (chunk: Buffer) => this.onData(chunk))
    socket.on('error', (err: Error) => this.close(`socket error: ${err.message}`))
    socket.on('close', () => this.close('socket closed'))
    socket.on('end', () => this.close('socket ended'))
    this.send(jsonMessage(SENDER_ID, RECEIVER_ID, NS_CONNECTION, { type: 'CONNECT' }))
    const hb = this.opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
    this.heartbeat = clock.setInterval(() => {
      if (clock.now() - this.lastSeen > hb * 3) { this.close('heartbeat timeout'); return }
      this.send(jsonMessage(SENDER_ID, RECEIVER_ID, NS_HEARTBEAT, { type: 'PING' }))
    }, hb)
    this.mediaPoll = clock.setInterval(() => {
      if (this.app?.transportId && this.media?.playerState === 'PLAYING') this.send(jsonMessage(SENDER_ID, this.app.transportId, NS_MEDIA, { type: 'GET_STATUS', requestId: this.nextId() }))
    }, this.opts.mediaPollMs ?? DEFAULT_MEDIA_POLL_MS)
    const reply = await this.request(RECEIVER_ID, NS_RECEIVER, { type: 'GET_STATUS' })
    return receiverStatusSchema.parse(reply.status)
  }

  get isOpen(): boolean { return this.socket !== null && !this.closed }

  /** Volume (0–1) and/or mute; the receiver answers with a full RECEIVER_STATUS. */
  async setVolume(volume: { level?: number; muted?: boolean }): Promise<void> {
    await this.request(RECEIVER_ID, NS_RECEIVER, { type: 'SET_VOLUME', volume })
  }

  /**
   * Closes the app on screen (`STOP` of its session, receiver channel): the Chromecast goes back to its
   * home screen. It is the only possible "stop" for an app without a media channel (native Netflix).
   */
  async stopApp(): Promise<void> {
    if (!this.app) throw new PluginError('UNSUPPORTED_COMMAND', 'nothing is on screen')
    await this.request(RECEIVER_ID, NS_RECEIVER, { type: 'STOP', sessionId: this.app.sessionId })
  }

  /** PLAY / PAUSE / STOP on the current media session. */
  async mediaCommand(type: 'PLAY' | 'PAUSE' | 'STOP'): Promise<void> {
    const { transportId, media } = this.requireMedia()
    await this.request(transportId, NS_MEDIA, { type, mediaSessionId: media.mediaSessionId })
  }

  /** Next (+1) or previous (−1) track in the app's queue. */
  async queueJump(jump: 1 | -1): Promise<void> {
    const { transportId, media } = this.requireMedia()
    this.refuseOnLive('there is no previous or next track')
    await this.request(transportId, NS_MEDIA, { type: 'QUEUE_UPDATE', mediaSessionId: media.mediaSessionId, jump })
  }

  /** Move within the track (SEEK); the receiver answers with a media state carrying the new position. */
  async seek(positionS: number): Promise<void> {
    const { transportId, media } = this.requireMedia()
    this.refuseOnLive('there is nothing to seek through')
    await this.request(transportId, NS_MEDIA, { type: 'SEEK', mediaSessionId: media.mediaSessionId, currentTime: Math.max(0, positionS) })
  }

  /**
   * Launches the default media receiver if it is not already there, then `LOAD`s the URL. It is
   * step 2 of the plugin: MP3 / HLS / radio, not YouTube Music (the protocol has no account).
   * Optional `meta`: title / artist / cover for the screen and Kasbah's `nowPlaying`.
   */
  async playUrl(url: string, meta?: PlayUrlMeta): Promise<void> {
    if (this.app?.appId !== DEFAULT_MEDIA_RECEIVER) {
      await this.request(RECEIVER_ID, NS_RECEIVER, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER })
    }
    const transportId = this.app?.transportId
    if (!transportId) throw new PluginError('UNSUPPORTED_COMMAND', 'default media receiver did not start')
    await this.request(transportId, NS_MEDIA, { type: 'LOAD', autoplay: true, currentTime: 0, media: mediaFromUrl(url, meta) })
  }

  /** Estimated position (s): last reading, advanced by the elapsed time if it is playing. */
  estimatedPositionS(): number {
    const media = this.media
    if (!media) return 0
    const base = media.currentTime ?? 0
    return media.playerState === 'PLAYING' ? base + (this.opts.clock.now() - this.mediaAt) / 1000 : base
  }

  /**
   * "Previous" as on a remote control: past the first few seconds, we go back to the START of the
   * track (SEEK to 0); otherwise to the previous track in the queue.
   */
  async previous(): Promise<void> {
    this.requireMedia()
    if (this.estimatedPositionS() > RESTART_AFTER_S) return this.seek(0)
    await this.queueJump(-1)
  }

  /**
   * A LIVE stream has no start to go back to, no end, no neighboring track: SEEK and QUEUE_UPDATE
   * cut the stream and leave the receiver with a dead session, which the app cannot restart
   * (observed on the franceinfo radio on a Nest Mini: "previous" stopped the live stream for good).
   * The app, for its part, reports these commands as accepted — we do not believe it, we refuse to
   * send.
   */
  private refuseOnLive(what: string): void {
    if (isLive(this.media)) throw new PluginError('UNSUPPORTED_COMMAND', `${what} on a live stream`)
  }

  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    const { clock } = this.opts
    clock.clearInterval(this.heartbeat)
    clock.clearInterval(this.mediaPoll)
    for (const p of this.pending.values()) p.reject(new PluginError('DEVICE_UNAVAILABLE', `connection closed (${reason})`))
    this.pending.clear()
    try { this.socket?.destroy() } catch { /* already closed */ }
    this.socket = null
    this.opts.onClose(reason)
  }

  // ---- interne -------------------------------------------------------------------------------

  private get timeoutMs(): number { return this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS }

  private nextId(): number { this.requestId += 1; return this.requestId }

  private requireMedia(): { transportId: string; media: MediaStatus } {
    if (!this.app?.transportId || !this.media) throw new PluginError('UNSUPPORTED_COMMAND', 'nothing is playing on this device')
    return { transportId: this.app.transportId, media: this.media }
  }

  private send(msg: CastMessage): void {
    if (!this.socket || this.closed) return
    this.socket.write(encodeFrame(msg))
  }

  /** Sends a numbered request and waits for the response carrying the same number. */
  private request(destination: string, namespace: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.isOpen) return Promise.reject(new PluginError('DEVICE_UNAVAILABLE', 'not connected'))
    const requestId = this.nextId()
    const p = new Promise<Record<string, unknown>>((resolve, reject) => { this.pending.set(requestId, { resolve, reject }) })
    this.send(jsonMessage(SENDER_ID, destination, namespace, { ...body, requestId }))
    return withTimeout(p, this.timeoutMs, this.opts.clock, `${body.type} on ${this.opts.host}`)
      .finally(() => this.pending.delete(requestId))
  }

  private onData(chunk: Buffer): void {
    this.lastSeen = this.opts.clock.now()
    let messages: CastMessage[]
    try { messages = this.decoder.push(chunk) }
    catch (err) { this.close(`undecodable frame: ${(err as Error).message}`); return }
    for (const m of messages) this.onMessage(m)
  }

  private onMessage(m: CastMessage): void {
    if (!m.payload) return
    let parsed: unknown
    try { parsed = JSON.parse(m.payload) } catch { this.opts.logger.debug({ namespace: m.namespace }, 'non-JSON cast payload ignored'); return }
    const inbound = inboundSchema.safeParse(parsed)
    if (!inbound.success) return
    const msg = inbound.data
    switch (m.namespace) {
      case NS_HEARTBEAT:
        if (msg.type === 'PING') this.send(jsonMessage(SENDER_ID, m.sourceId, NS_HEARTBEAT, { type: 'PONG' }))
        return
      case NS_CONNECTION:
        // the app closed our media channel: no more session; the receiver itself: everything is over
        if (msg.type === 'CLOSE') {
          if (m.sourceId === RECEIVER_ID) this.close('closed by receiver')
          else if (m.sourceId === this.app?.transportId) this.setMedia(undefined)
        }
        return
      case NS_RECEIVER:
        if (msg.type === 'RECEIVER_STATUS') this.onReceiverStatus(msg.status, msg.requestId)
        else this.settle(msg.requestId, msg)
        return
      case NS_MEDIA:
        if (msg.type === 'MEDIA_STATUS') this.onMediaStatus(msg.status, msg.requestId)
        else this.settle(msg.requestId, msg)
        return
      default:
        return
    }
  }

  private onReceiverStatus(raw: unknown, requestId: number | undefined): void {
    const status = receiverStatusSchema.safeParse(raw)
    if (!status.success) { this.opts.logger.warn({ issues: status.error.issues }, 'RECEIVER_STATUS with an unexpected shape ignored'); return }
    this.lastReceiverStatus = status.data
    this.opts.onReceiverStatus(status.data)                 // volume first, playback next
    const app = activeApplication(status.data)
    // by `sessionId` and not `transportId`: an app without a media channel (native Netflix) has none
    const changed = app?.sessionId !== this.app?.sessionId
    this.app = app
    if (changed || !this.mediaReported) {
      // new app (or no more app): (re)open the media channel towards it and ask for its session;
      // without `transportId` there is nobody to talk to, the "on screen" state is published by `setMedia`
      this.setMedia(undefined)
      if (app?.transportId) {
        this.send(jsonMessage(SENDER_ID, app.transportId, NS_CONNECTION, { type: 'CONNECT' }))
        this.send(jsonMessage(SENDER_ID, app.transportId, NS_MEDIA, { type: 'GET_STATUS', requestId: this.nextId() }))
      }
    }
    this.resolve(requestId, { status: status.data })
  }

  private onMediaStatus(raw: unknown, requestId: number | undefined): void {
    this.lastMediaRaw = raw
    // `status` is an ARRAY of sessions (empty when nothing plays anymore); we follow the first
    const first = Array.isArray(raw) ? raw[0] : undefined
    const media = first === undefined ? undefined : mediaStatusSchema.safeParse(first)
    if (media && !media.success) { this.opts.logger.warn({ issues: media.error.issues }, 'MEDIA_STATUS with an unexpected shape ignored'); return }
    let next = media?.data
    // The receiver only includes `media` when it CHANGES (Cast reference): a pause, a resume or a
    // position arrive without it. Same session → we keep the known track, otherwise it would vanish on
    // every pause (seen on a Nest Hub: "Nothing playing · Paused").
    if (next && next.media == null && this.media && this.media.mediaSessionId === next.mediaSessionId) next = { ...next, media: this.media.media }
    this.setMedia(next)
    this.resolve(requestId, { status: raw })
  }

  private setMedia(media: MediaStatus | undefined): void {
    this.media = media
    this.mediaAt = this.opts.clock.now()
    this.mediaReported = true
    this.opts.onMediaStatus(media, this.app)
  }

  private resolve(requestId: number | undefined, value: Record<string, unknown>): void {
    if (requestId === undefined) return
    this.pending.get(requestId)?.resolve(value)
  }

  /** Response that is not a state: INVALID_REQUEST, LOAD_FAILED, INVALID_PLAYER_STATE, ERROR… */
  private settle(requestId: number | undefined, msg: { type: string; reason?: string }): void {
    if (requestId === undefined) return
    this.pending.get(requestId)?.reject(new PluginError('UNSUPPORTED_COMMAND', `receiver answered ${msg.type}${msg.reason ? ` (${msg.reason})` : ''}`))
  }
}
