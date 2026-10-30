import type { Logger } from 'pino'
import type { Clock } from '../../core/clock'

// Client of Home Assistant's WebSocket API (`/api/websocket`). A single connection serves the
// reads (states, registries), the subscriptions (`state_changed` events) and the commands
// (`call_service`). Automatic reconnection with a growing wait; each request is bounded.

/** The bit of the standard WebSocket we need (Node 22 provides a global one). */
export interface WsLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
}
export type WsFactory = (url: string) => WsLike

export interface HaSocketOptions {
  /** HTTP base of Home Assistant (`http://192.168.1.10:8123`): the WebSocket address derives from it. */
  baseUrl: string
  token: string
  logger: Logger
  clock: Clock
  signal: AbortSignal
  /** Max delay of a request (ms). */
  requestTimeoutMs?: number
  wsFactory?: WsFactory
  /** Called on each authenticated connection (the first and each reconnection). */
  onReady: (isReconnect: boolean) => void | Promise<void>
  /** Event received on a subscription (`subscribe_events`). */
  onEvent: (event: HaEvent) => void
  /** Called when the connection drops. */
  onDown: (reason: string) => void
}

export interface HaEvent {
  event_type: string
  data: Record<string, unknown>
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: unknown
}

export class HaError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'HaError'
  }
}

export function wsUrlOf(baseUrl: string): string {
  const u = new URL(baseUrl)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/api/websocket`
  return u.toString()
}

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

export class HaSocket {
  private ws: WsLike | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private authed = false
  private everReady = false
  private attempts = 0
  private retryTimer: unknown = null
  private readonly timeoutMs: number

  constructor(private readonly opts: HaSocketOptions) {
    this.timeoutMs = opts.requestTimeoutMs ?? 10_000
    opts.signal.addEventListener('abort', () => this.close(), { once: true })
  }

  get connected(): boolean { return this.authed }

  start(): void {
    if (this.opts.signal.aborted) return
    const factory: WsFactory = this.opts.wsFactory ?? ((url) => new WebSocket(url) as unknown as WsLike)
    let ws: WsLike
    try { ws = factory(wsUrlOf(this.opts.baseUrl)) }
    catch (err) { this.scheduleRetry((err as Error).message); return }
    this.ws = ws
    ws.onmessage = (ev) => this.onMessage(ev.data)
    ws.onerror = () => { /* onclose always follows */ }
    ws.onclose = () => {
      if (this.ws !== ws) return
      const wasAuthed = this.authed
      this.authed = false
      this.ws = null
      this.failAll(new HaError('DISCONNECTED', 'Home Assistant connection closed'))
      if (wasAuthed) this.opts.onDown('connection closed')
      this.scheduleRetry('connection closed')
    }
  }

  /** Sends a numbered request and waits for its `result` answer. */
  call<T = unknown>(msg: Record<string, unknown>): Promise<T> {
    const ws = this.ws
    if (!ws || !this.authed) return Promise.reject(new HaError('DISCONNECTED', 'Home Assistant not connected'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = this.opts.clock.setTimeout(() => {
        this.pending.delete(id)
        reject(new HaError('TIMEOUT', `Home Assistant did not answer ${String(msg.type)} in ${this.timeoutMs} ms`))
      }, this.timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      ws.send(JSON.stringify({ ...msg, id }))
    })
  }

  close(): void {
    if (this.retryTimer !== null) { this.opts.clock.clearTimeout(this.retryTimer); this.retryTimer = null }
    const ws = this.ws
    this.ws = null
    this.authed = false
    this.failAll(new HaError('DISCONNECTED', 'closed'))
    try { ws?.close() } catch { /* already closed */ }
  }

  private scheduleRetry(reason: string): void {
    if (this.opts.signal.aborted || this.retryTimer !== null) return
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)]!
    this.attempts++
    this.opts.logger.warn({ reason, retryInMs: delay }, 'Home Assistant connection lost, retrying')
    this.retryTimer = this.opts.clock.setTimeout(() => { this.retryTimer = null; this.start() }, delay)
  }

  private failAll(err: Error): void {
    for (const p of this.pending.values()) { this.opts.clock.clearTimeout(p.timer); p.reject(err) }
    this.pending.clear()
  }

  private onMessage(raw: unknown): void {
    let msg: Record<string, unknown>
    try { msg = JSON.parse(String(raw)) as Record<string, unknown> }
    catch { this.opts.logger.debug('unparseable Home Assistant frame'); return }
    switch (msg.type) {
      case 'auth_required':
        this.ws?.send(JSON.stringify({ type: 'auth', access_token: this.opts.token }))
        return
      case 'auth_ok': {
        this.authed = true
        this.attempts = 0
        const isReconnect = this.everReady
        this.everReady = true
        void Promise.resolve(this.opts.onReady(isReconnect)).catch((err) => this.opts.logger.warn({ err }, 'Home Assistant sync failed'))
        return
      }
      case 'auth_invalid':
        // the token is refused: no use insisting in a loop, retry at the slowest pace
        this.opts.logger.error('Home Assistant rejected the access token')
        this.attempts = BACKOFF_MS.length
        this.opts.onDown('access token rejected')
        this.ws?.close()
        return
      case 'result': {
        const p = this.pending.get(msg.id as number)
        if (!p) return
        this.pending.delete(msg.id as number)
        this.opts.clock.clearTimeout(p.timer)
        if (msg.success) p.resolve(msg.result)
        else {
          const e = (msg.error ?? {}) as { code?: string; message?: string }
          p.reject(new HaError(e.code ?? 'unknown_error', e.message ?? 'Home Assistant error'))
        }
        return
      }
      case 'event':
        if (msg.event && typeof msg.event === 'object') this.opts.onEvent(msg.event as HaEvent)
        return
      default:
        return
    }
  }
}
