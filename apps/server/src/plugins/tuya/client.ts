import { EventEmitter } from 'node:events'
import TuyAPI from 'tuyapi'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import type { TuyaDps } from './types'

// Local tuyapi connection (protocol 3.5) with a reconnection loop.
//
// Pitfalls measured on the CREATE:
//  3 — never poll a single DP (`get({dps})` → ECONNRESET): subscribe to `data` / `dp-refresh`
//  4 — the full state arrives on connection (`issueRefreshOnConnect: true`)
//  5 — the connection drops without warning → reconnection loop (~700 ms)

const RECONNECT_MS = 700

export interface TuyaSocketEvents {
  data: (payload: { dps?: TuyaDps }) => void
  'dp-refresh': (payload: { dps?: TuyaDps }) => void
  disconnected: () => void
  error: (err: Error) => void
  connected: () => void
}

/** Minimal injectable socket — the real one goes through `tuyapi`. */
export interface TuyaSocket {
  connect(): Promise<void>
  disconnect(): void
  set(opts: { dps: number; set: unknown }): Promise<unknown>
  on<K extends keyof TuyaSocketEvents>(event: K, cb: TuyaSocketEvents[K]): void
  removeListener?<K extends keyof TuyaSocketEvents>(event: K, cb: TuyaSocketEvents[K]): void
}

export interface TuyaSocketOptions {
  id: string
  key: string
  ip: string
  version: string
}

export type TuyaSocketFactory = (opts: TuyaSocketOptions) => TuyaSocket

export interface DeviceSessionOptions {
  id: string
  key: string
  ip: string
  version: string
  createSocket: TuyaSocketFactory
  clock: Clock
  signal: AbortSignal
  /** Delay between two reconnection attempts (injectable for tests). */
  reconnectMs?: number
  onDps: (dps: TuyaDps) => void
  onConnectionChange: (connected: boolean) => void
  /** Reason of the last failed connection attempt (unreachable host, refused key…). */
  onConnectError?: (message: string) => void
  logger?: { warn(obj: unknown, msg?: string): void; debug(obj: unknown, msg?: string): void }
}

/**
   * One session per physical device: accumulates the DPs (full frames on connection,
   * then deltas), reconnects in a loop as long as the plugin lives.
 */
export class DeviceSession {
  private socket: TuyaSocket | null = null
  private dps: TuyaDps = {}
  private running = false
  private loopPromise: Promise<void> | null = null
  private lastConnectError: string | null = null
  private readonly reconnectMs: number

  constructor(private readonly opts: DeviceSessionOptions) {
    this.reconnectMs = opts.reconnectMs ?? RECONNECT_MS
  }

  /** Accumulated DP state (read-only). */
  snapshot(): TuyaDps {
    return { ...this.dps }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.loopPromise = this.loop()
  }

  async stop(): Promise<void> {
    this.running = false
    try { this.socket?.disconnect() } catch { /* already closed */ }
    this.socket = null
    this.opts.onConnectionChange(false)
    await this.loopPromise?.catch(() => undefined)
    this.loopPromise = null
  }

  /**
   * Writes a DP, bounded by `signal` (plugin + command timeout).
   * Does NOT wait for the effect — that's what `waitForDps` does.
   */
  async write(dps: number, set: unknown, signal: AbortSignal): Promise<void> {
    const sock = this.socket
    if (!sock) throw new PluginError('DEVICE_UNAVAILABLE', `tuya ${this.opts.id} is not connected`)
    if (signal.aborted) throw new PluginError('DEVICE_UNAVAILABLE', 'write aborted')
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup()
        reject(new PluginError('TIMEOUT', `tuya write dp ${dps} aborted`))
      }
      const cleanup = () => signal.removeEventListener('abort', onAbort)
      signal.addEventListener('abort', onAbort, { once: true })
      sock.set({ dps, set }).then(() => { cleanup(); resolve() }, (err: unknown) => {
        cleanup()
        reject(err instanceof PluginError ? err : new PluginError('UPSTREAM_ERROR', String(err), { cause: err }))
      })
    })
  }

  /**
   * Waits until the accumulated state contains the expected values (proof of effect, not the acknowledgment).
   * Also resolves if `signal` is aborted — "carry on past the cap".
   */
  waitForDps(expected: { dps: number; set: unknown }[], signal: AbortSignal): Promise<boolean> {
    if (expected.every((w) => (this.dps[String(w.dps)] ?? this.dps[w.dps as unknown as keyof TuyaDps]) === w.set)) {
      return Promise.resolve(true)
    }
    return new Promise((resolve) => {
      const check = () => {
        if (expected.every((w) => (this.dps[String(w.dps)] ?? this.dps[w.dps as unknown as keyof TuyaDps]) === w.set)) {
          cleanup()
          resolve(true)
        }
      }
      const onAbort = () => { cleanup(); resolve(false) }
      const onUpdate = () => check()
      const cleanup = () => {
        signal.removeEventListener('abort', onAbort)
        this.emitter.off('dps', onUpdate)
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.emitter.on('dps', onUpdate)
      check()
    })
  }

  private readonly emitter = new EventEmitter()

  private absorb(fragment: TuyaDps | undefined): void {
    if (!fragment) return
    Object.assign(this.dps, fragment)
    this.emitter.emit('dps')
    this.opts.onDps(fragment)
  }

  private async loop(): Promise<void> {
    while (this.running && !this.opts.signal.aborted) {
      const sock = this.opts.createSocket({
        id: this.opts.id,
        key: this.opts.key,
        ip: this.opts.ip,
        version: this.opts.version,
      })
      this.socket = sock
      const onData = (p: { dps?: TuyaDps }) => this.absorb(p?.dps)
      const onRefresh = (p: { dps?: TuyaDps }) => this.absorb(p?.dps)
      const onError = () => { /* reconnection noise — pitfall 5 */ }
      sock.on('data', onData)
      sock.on('dp-refresh', onRefresh)
      sock.on('error', onError)

      try {
        await sock.connect()
        if (!this.running || this.opts.signal.aborted) break
        this.lastConnectError = null
        this.opts.onConnectionChange(true)
        await new Promise<void>((resolve) => {
          const done = () => {
            sock.removeListener?.('disconnected', done)
            this.opts.signal.removeEventListener('abort', done)
            resolve()
          }
          sock.on('disconnected', done)
          this.opts.signal.addEventListener('abort', done, { once: true })
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        // Warn once per new reason, not on every ~700 ms retry.
        if (message !== this.lastConnectError) {
          this.opts.logger?.warn({ ip: this.opts.ip, err: message }, 'tuya connect failed')
        } else {
          this.opts.logger?.debug({ ip: this.opts.ip, err: message }, 'tuya connect failed')
        }
        this.lastConnectError = message
        this.opts.onConnectError?.(message)
      } finally {
        this.opts.onConnectionChange(false)
        try { sock.disconnect() } catch { /* */ }
        if (this.socket === sock) this.socket = null
      }

      if (!this.running || this.opts.signal.aborted) break
      await sleep(this.opts.clock, this.reconnectMs, this.opts.signal)
    }
  }
}

function sleep(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const t = clock.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clock.clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Real factory around `tuyapi` 7.7.1. */
export function createTuyapiFactory(): TuyaSocketFactory {
  return (opts) => {
    const device = new TuyAPI({
      id: opts.id,
      key: opts.key,
      ip: opts.ip,
      version: opts.version,
      issueRefreshOnConnect: true,
    })
    return {
      connect: async () => { await device.connect() },
      disconnect: () => { try { device.disconnect() } catch { /* */ } },
      set: (o) => device.set({ dps: o.dps, set: o.set as string | number | boolean }),
      on: (event, cb) => { device.on(event, cb as (...args: unknown[]) => void) },
      removeListener: (event, cb) => { device.removeListener(event, cb as (...args: unknown[]) => void) },
    }
  }
}
