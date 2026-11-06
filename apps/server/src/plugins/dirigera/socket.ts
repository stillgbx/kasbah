import { randomUUID } from 'node:crypto'
import type { ConnectionOptions } from 'node:tls'
import type { Logger } from 'pino'
import { WebSocket, type ClientOptions } from 'ws'
import { createBackoff } from '../../core/backoff'
import type { Clock } from '../../core/clock'
import { pinnedTlsConnect, type TlsPin } from '../../core/tls-pin'

// Event socket of the DIRIGERA hub (wss://<hub>:8443/v1), authenticated by the token on the
// handshake (`Authorization: Bearer`, hence the `ws` package: Node's native WebSocket sets no
// header). The handshake goes through the pinned TLS connection: the token is only written once the
// certificate matched. The hub pushes each state change; events missed during a cut are not
// replayed, so the plugin re-reads everything on reconnection (`onOpen(true)`).
// The keep-alive is an APPLICATION message (`type: 'ping'`, the hub answers `pong`), not a WebSocket
// ping frame: that is what the `dirigera` library sends every 30 s.

export const PING_MS = 30_000

/** The subset of `ws.WebSocket` used here; injectable by the tests. */
export interface WsLike {
  on(event: 'open', fn: () => void): unknown
  on(event: 'message', fn: (data: unknown) => void): unknown
  on(event: 'close', fn: (code?: number) => void): unknown
  on(event: 'error', fn: (err: Error) => void): unknown
  send(data: string): void
  terminate(): void
}

const pingMessage = (now: number) => JSON.stringify({
  id: randomUUID(), specversion: '1.1.0', source: 'urn:kasbah:dirigera', time: new Date(now).toISOString(), type: 'ping', data: null,
})
export type WsFactory = (url: string, headers: Record<string, string>, pin: TlsPin | undefined) => WsLike

// `ws` hands `createConnection` the TLS options of the handshake (host, port, servername)
const pinnedConnection = (pin: TlsPin) =>
  ((options: ConnectionOptions) => pinnedTlsConnect(options, pin)) as unknown as ClientOptions['createConnection']

const defaultFactory: WsFactory = (url, headers, pin) => new WebSocket(url, {
  headers,
  ...(pin ? { createConnection: pinnedConnection(pin) } : { rejectUnauthorized: false }),
}) as unknown as WsLike

export interface DirigeraSocketOptions {
  url: string
  token: string
  pin?: TlsPin
  clock: Clock
  signal: AbortSignal
  logger: Logger
  onEvent: (message: unknown) => void
  /** Connection (re)established; `reconnected` = events may have been missed. */
  onOpen: (reconnected: boolean) => void
  onClose: () => void
  factory?: WsFactory
}

export class DirigeraSocket {
  private ws: WsLike | null = null
  private pingTimer: unknown = null
  private retryTimer: unknown = null
  private stopped = false
  private everOpened = false
  private _connected = false
  private readonly backoff = createBackoff({ initialMs: 2_000, maxMs: 60_000 })

  constructor(private readonly opts: DirigeraSocketOptions) {}

  get connected(): boolean { return this._connected }

  start(): void {
    this.stopped = false
    this.opts.signal.addEventListener('abort', () => this.stop(), { once: true })
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.pingTimer) { this.opts.clock.clearInterval(this.pingTimer); this.pingTimer = null }
    if (this.retryTimer) { this.opts.clock.clearTimeout(this.retryTimer); this.retryTimer = null }
    const ws = this.ws
    this.ws = null
    this._connected = false
    try { ws?.terminate() } catch { /* already closed */ }
  }

  private connect(): void {
    if (this.stopped) return
    let ws: WsLike
    try { ws = (this.opts.factory ?? defaultFactory)(this.opts.url, { Authorization: `Bearer ${this.opts.token}` }, this.opts.pin) }
    catch (err) {
      this.opts.logger.warn({ err: (err as Error).message }, 'DIRIGERA socket could not open')
      this.scheduleRetry()
      return
    }
    this.ws = ws
    ws.on('open', () => {
      if (this.ws !== ws) return
      this._connected = true
      const reconnected = this.everOpened
      this.everOpened = true
      this.backoff.reset()
      this.pingTimer = this.opts.clock.setInterval(() => {
        try { ws.send(pingMessage(this.opts.clock.now())) } catch { /* closed in the meantime */ }
      }, PING_MS)
      this.opts.onOpen(reconnected)
    })
    ws.on('message', (data) => {
      if (this.ws !== ws) return
      let json: unknown
      try { json = JSON.parse(String(data)) } catch { this.opts.logger.debug('DIRIGERA socket: frame is not JSON'); return }
      this.opts.onEvent(json)
    })
    ws.on('error', (err) => {
      if (this.ws === ws) this.opts.logger.warn({ err: err.message }, 'DIRIGERA socket error')
    })
    ws.on('close', (code) => {
      if (this.ws !== ws) return
      this.ws = null
      const wasConnected = this._connected
      this._connected = false
      if (this.pingTimer) { this.opts.clock.clearInterval(this.pingTimer); this.pingTimer = null }
      if (wasConnected) this.opts.onClose()
      if (this.stopped) return
      this.opts.logger.info({ code }, 'DIRIGERA socket closed, reconnecting')
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return
    this.retryTimer = this.opts.clock.setTimeout(() => { this.retryTimer = null; this.connect() }, this.backoff.next())
  }
}
