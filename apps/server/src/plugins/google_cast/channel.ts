import type { Duplex } from 'node:stream'
import { connect as tlsConnect } from 'node:tls'
import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import { withTimeout } from '../../core/poll'
import { activeApplication } from './mapping'
import { FrameDecoder, NS_CONNECTION, NS_HEARTBEAT, NS_MEDIA, NS_RECEIVER, RECEIVER_ID, SENDER_ID, encodeFrame, jsonMessage, type CastMessage } from './protocol'
import { inboundSchema, mediaStatusSchema, receiverStatusSchema, type MediaStatus, type ReceiverApplication, type ReceiverStatus } from './types'

// Une connexion Cast vers UN appareil : socket TLS (certificat propre à l'appareil, non signé par
// une autorité publique), CONNECT au récepteur, battement de cœur PING / PONG, et deux canaux :
//  - `receiver` (volume, appli en cours) : le récepteur POUSSE un RECEIVER_STATUS à chaque
//    changement dès qu'on est connecté ;
//  - `media` : à ouvrir vers le transportId de l'appli qui tourne, qui pousse alors ses MEDIA_STATUS.
// Une requête porte un `requestId` et la réponse le reprend : c'est l'accusé qu'attend `execute`.

export type SocketFactory = (host: string, port: number) => Promise<Duplex>

/** Socket TLS réelle, résolue une fois la poignée de main faite. */
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
  /** `media` absent = plus de session (appli fermée, file terminée). */
  onMediaStatus(media: MediaStatus | undefined, app: ReceiverApplication | undefined): void
  onClose(reason: string): void
  heartbeatMs?: number
  requestTimeoutMs?: number
  /** Cadence de relecture de la position pendant une lecture (le récepteur ne la pousse pas seul). */
  mediaPollMs?: number
}

const DEFAULT_HEARTBEAT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 5000
const DEFAULT_MEDIA_POLL_MS = 10_000
/** « Précédent » au-delà de ce point dans le morceau revient à son début, comme sur une télécommande. */
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
  /** Vrai dès qu'on a publié un état de lecture (même « rien ne joue ») : le premier RECEIVER_STATUS doit le faire. */
  private mediaReported = false
  /** Appli en cours (hors écran de veille) et session média connue. */
  app: ReceiverApplication | undefined = undefined
  media: MediaStatus | undefined = undefined
  lastReceiverStatus: ReceiverStatus | undefined = undefined
  lastMediaRaw: unknown = undefined
  /** Horloge du dernier état média reçu : la position connue date de là. */
  private mediaAt = 0

  constructor(private readonly opts: CastConnectionOptions) {}

  /** Connecte, s'annonce, lance le battement de cœur et rend le premier état du récepteur. */
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
      if (this.app && this.media?.playerState === 'PLAYING') this.send(jsonMessage(SENDER_ID, this.app.transportId, NS_MEDIA, { type: 'GET_STATUS', requestId: this.nextId() }))
    }, this.opts.mediaPollMs ?? DEFAULT_MEDIA_POLL_MS)
    const reply = await this.request(RECEIVER_ID, NS_RECEIVER, { type: 'GET_STATUS' })
    return receiverStatusSchema.parse(reply.status)
  }

  get isOpen(): boolean { return this.socket !== null && !this.closed }

  /** Volume (0–1) et/ou muet ; le récepteur répond par un RECEIVER_STATUS complet. */
  async setVolume(volume: { level?: number; muted?: boolean }): Promise<void> {
    await this.request(RECEIVER_ID, NS_RECEIVER, { type: 'SET_VOLUME', volume })
  }

  /** PLAY / PAUSE / STOP sur la session média en cours. */
  async mediaCommand(type: 'PLAY' | 'PAUSE' | 'STOP'): Promise<void> {
    const { app, media } = this.requireMedia()
    await this.request(app.transportId, NS_MEDIA, { type, mediaSessionId: media.mediaSessionId })
  }

  /** Piste suivante (+1) ou précédente (−1) dans la file de l'appli. */
  async queueJump(jump: 1 | -1): Promise<void> {
    const { app, media } = this.requireMedia()
    await this.request(app.transportId, NS_MEDIA, { type: 'QUEUE_UPDATE', mediaSessionId: media.mediaSessionId, jump })
  }

  /** Se placer dans le morceau (SEEK) ; le récepteur répond par un état média avec la nouvelle position. */
  async seek(positionS: number): Promise<void> {
    const { app, media } = this.requireMedia()
    await this.request(app.transportId, NS_MEDIA, { type: 'SEEK', mediaSessionId: media.mediaSessionId, currentTime: Math.max(0, positionS) })
  }

  /** Position estimée (s) : dernier relevé, avancé du temps écoulé si ça joue. */
  estimatedPositionS(): number {
    const media = this.media
    if (!media) return 0
    const base = media.currentTime ?? 0
    return media.playerState === 'PLAYING' ? base + (this.opts.clock.now() - this.mediaAt) / 1000 : base
  }

  /**
   * « Précédent » comme sur une télécommande : passé les premières secondes, on revient au DÉBUT du
   * morceau (SEEK à 0) ; sinon au morceau précédent de la file.
   */
  async previous(): Promise<void> {
    const { app, media } = this.requireMedia()
    if (this.estimatedPositionS() > RESTART_AFTER_S) {
      await this.request(app.transportId, NS_MEDIA, { type: 'SEEK', mediaSessionId: media.mediaSessionId, currentTime: 0 })
      return
    }
    await this.queueJump(-1)
  }

  close(reason: string): void {
    if (this.closed) return
    this.closed = true
    const { clock } = this.opts
    clock.clearInterval(this.heartbeat)
    clock.clearInterval(this.mediaPoll)
    for (const p of this.pending.values()) p.reject(new PluginError('DEVICE_UNAVAILABLE', `connection closed (${reason})`))
    this.pending.clear()
    try { this.socket?.destroy() } catch { /* déjà fermée */ }
    this.socket = null
    this.opts.onClose(reason)
  }

  // ---- interne -------------------------------------------------------------------------------

  private get timeoutMs(): number { return this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS }

  private nextId(): number { this.requestId += 1; return this.requestId }

  private requireMedia(): { app: ReceiverApplication; media: MediaStatus } {
    if (!this.app || !this.media) throw new PluginError('UNSUPPORTED_COMMAND', 'nothing is playing on this device')
    return { app: this.app, media: this.media }
  }

  private send(msg: CastMessage): void {
    if (!this.socket || this.closed) return
    this.socket.write(encodeFrame(msg))
  }

  /** Envoie une requête numérotée et attend la réponse qui porte le même numéro. */
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
        // l'appli a fermé notre canal média : plus de session ; le récepteur lui-même : tout est fini
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
    this.opts.onReceiverStatus(status.data)                 // volume d'abord, lecture ensuite
    const app = activeApplication(status.data)
    const changed = app?.transportId !== this.app?.transportId
    this.app = app
    if (changed || !this.mediaReported) {
      // nouvelle appli (ou plus d'appli) : (r)ouvrir le canal média vers elle et lui demander sa session
      this.setMedia(undefined)
      if (app) {
        this.send(jsonMessage(SENDER_ID, app.transportId, NS_CONNECTION, { type: 'CONNECT' }))
        this.send(jsonMessage(SENDER_ID, app.transportId, NS_MEDIA, { type: 'GET_STATUS', requestId: this.nextId() }))
      }
    }
    this.resolve(requestId, { status: status.data })
  }

  private onMediaStatus(raw: unknown, requestId: number | undefined): void {
    this.lastMediaRaw = raw
    // `status` est un TABLEAU de sessions (vide quand plus rien ne joue) ; on suit la première
    const first = Array.isArray(raw) ? raw[0] : undefined
    const media = first === undefined ? undefined : mediaStatusSchema.safeParse(first)
    if (media && !media.success) { this.opts.logger.warn({ issues: media.error.issues }, 'MEDIA_STATUS with an unexpected shape ignored'); return }
    let next = media?.data
    // Le récepteur n'inclut `media` que lorsqu'il CHANGE (référence Cast) : une pause, une reprise ou une
    // position arrivent sans lui. Même session → on garde le morceau connu, sinon il disparaîtrait à
    // chaque pause (constaté sur un Nest Hub : « Rien en lecture · En pause »).
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

  /** Réponse qui n'est pas un état : INVALID_REQUEST, LOAD_FAILED, INVALID_PLAYER_STATE, ERROR… */
  private settle(requestId: number | undefined, msg: { type: string; reason?: string }): void {
    if (requestId === undefined) return
    this.pending.get(requestId)?.reject(new PluginError('UNSUPPORTED_COMMAND', `receiver answered ${msg.type}${msg.reason ? ` (${msg.reason})` : ''}`))
  }
}
