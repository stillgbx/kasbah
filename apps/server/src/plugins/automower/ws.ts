import type { Logger } from 'pino'
import { WebSocket } from 'ws'
import { createBackoff } from '../../core/backoff'
import type { Clock } from '../../core/clock'

// Event stream of the Automower Connect API: a WebSocket authenticated by the account's token
// (`Authorization: Bearer` on the handshake — hence the `ws` package: Node's native `WebSocket`
// does not allow setting a header). The vendor pushes battery, activity, schedule, position,
// cutting height there as soon as they change: that is what makes the robot LIVE on screen without
// spending the REST quota (21 000 requests per 7-day window), which now only serves to resync.
//
// What the connection needs to hold:
//  - a PING every minute (the server cuts a silent connection);
//  - RECONNECTING: the vendor closes the connection after about two hours, and a household's
//    network drops whenever it likes. Retry with backoff (5 s → 5 min); each reconnection
//    requests a fresh token, the old one may have expired in the meantime;
//  - a first message `{ ready: true, connectionId }` that says nothing about the robot — then the
//    `{ id, type, attributes }` events (V2 format).
// Events missed during a cut are NOT replayed: it is up to the plugin to re-read the full state on
// reconnection (`onOpen`).

export const WS_URL = 'wss://ws.openapi.husqvarna.dev/v1'
export const PING_MS = 60_000

/** The subset of `ws.WebSocket` we use; injectable by the tests. */
export interface WsLike {
  on(event: 'open', fn: () => void): unknown
  on(event: 'message', fn: (data: unknown) => void): unknown
  on(event: 'close', fn: (code?: number, reason?: unknown) => void): unknown
  on(event: 'error', fn: (err: Error) => void): unknown
  ping(): void
  close(): void
  terminate(): void
}
export type WsFactory = (url: string, headers: Record<string, string>) => WsLike

const defaultFactory: WsFactory = (url, headers) => new WebSocket(url, { headers }) as unknown as WsLike

export interface AutomowerSocketOptions {
  token: (signal: AbortSignal) => Promise<string>
  clock: Clock
  signal: AbortSignal
  logger: Logger
  onEvent: (message: unknown) => void
  /** Connection (re)established; `reconnected` says whether events may have been missed before. */
  onOpen?: (reconnected: boolean) => void
  onClose?: () => void
  url?: string
  factory?: WsFactory
  pingMs?: number
}

export class AutomowerSocket {
  private ws: WsLike | null = null
  private pingTimer: unknown = null
  private retryTimer: unknown = null
  private stopped = false
  private everOpened = false
  private _connected = false
  private readonly backoff = createBackoff({ initialMs: 5_000, maxMs: 300_000 })

  constructor(private readonly opts: AutomowerSocketOptions) {}

  get connected(): boolean { return this._connected }

  start(): void {
    this.stopped = false
    this.opts.signal.addEventListener('abort', () => this.stop(), { once: true })
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearTimers()
    const ws = this.ws
    this.ws = null
    this._connected = false
    try { ws?.terminate() } catch { /* already closed */ }
  }

  private clearTimers(): void {
    if (this.pingTimer) { this.opts.clock.clearInterval(this.pingTimer); this.pingTimer = null }
    if (this.retryTimer) { this.opts.clock.clearTimeout(this.retryTimer); this.retryTimer = null }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return
    let token: string
    try {
      token = await this.opts.token(this.opts.signal)
    } catch (err) {
      this.opts.logger.warn({ err }, 'Automower websocket: no token, retrying later')
      this.scheduleRetry()
      return
    }
    if (this.stopped) return
    const ws = (this.opts.factory ?? defaultFactory)(this.opts.url ?? WS_URL, { Authorization: `Bearer ${token}` })
    this.ws = ws
    ws.on('open', () => {
      if (this.ws !== ws) return
      this._connected = true
      const reconnected = this.everOpened
      this.everOpened = true
      this.backoff.reset()
      this.pingTimer = this.opts.clock.setInterval(() => { try { ws.ping() } catch { /* closed in the meantime */ } }, this.opts.pingMs ?? PING_MS)
      this.opts.logger.info({ reconnected }, 'Automower websocket connected')
      this.opts.onOpen?.(reconnected)
    })
    ws.on('message', (data) => {
      if (this.ws !== ws) return
      const text = typeof data === 'string' ? data : String(data)
      if (!text.trim()) return
      let json: unknown
      try { json = JSON.parse(text) } catch { this.opts.logger.debug({ text: text.slice(0, 200) }, 'Automower websocket: not JSON'); return }
      this.opts.onEvent(json)
    })
    ws.on('error', (err) => {
      if (this.ws !== ws) return
      this.opts.logger.warn({ err: err.message }, 'Automower websocket error')
    })
    ws.on('close', (code) => {
      if (this.ws !== ws) return
      this.ws = null
      const wasConnected = this._connected
      this._connected = false
      if (this.pingTimer) { this.opts.clock.clearInterval(this.pingTimer); this.pingTimer = null }
      if (wasConnected) this.opts.onClose?.()
      if (this.stopped) return
      this.opts.logger.info({ code }, 'Automower websocket closed, reconnecting')
      this.scheduleRetry()
    })
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer) return
    const delay = this.backoff.next()
    this.retryTimer = this.opts.clock.setTimeout(() => { this.retryTimer = null; void this.connect() }, delay)
  }
}
