import { EventEmitter } from 'node:events'
import TuyAPI from 'tuyapi'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import type { TuyaDps } from './types'

// Connexion locale tuyapi (protocole 3.5) avec boucle de reconnexion.
//
// Pièges mesurés sur le CREATE :
//  3 — ne jamais sonder un DP isolé (`get({dps})` → ECONNRESET) : s'abonner à `data` / `dp-refresh`
//  4 — l'état complet arrive à la connexion (`issueRefreshOnConnect: true`)
//  5 — la connexion tombe sans prévenir → boucle de reconnexion (~700 ms)

const RECONNECT_MS = 700

export interface TuyaSocketEvents {
  data: (payload: { dps?: TuyaDps }) => void
  'dp-refresh': (payload: { dps?: TuyaDps }) => void
  disconnected: () => void
  error: (err: Error) => void
  connected: () => void
}

/** Socket minimale injectable — la vraie passe par `tuyapi`. */
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
  /** Délai entre deux tentatives de reconnexion (injectable pour les tests). */
  reconnectMs?: number
  onDps: (dps: TuyaDps) => void
  onConnectionChange: (connected: boolean) => void
  logger?: { warn(obj: unknown, msg?: string): void; debug(obj: unknown, msg?: string): void }
}

/**
 * Une session par appareil physique : accumule les DP (trames complètes à la connexion,
 * puis deltas), reconnecte en boucle tant que le plugin vit.
 */
export class DeviceSession {
  private socket: TuyaSocket | null = null
  private dps: TuyaDps = {}
  private running = false
  private loopPromise: Promise<void> | null = null
  private readonly reconnectMs: number

  constructor(private readonly opts: DeviceSessionOptions) {
    this.reconnectMs = opts.reconnectMs ?? RECONNECT_MS
  }

  /** État DP accumulé (lecture seule). */
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
    try { this.socket?.disconnect() } catch { /* déjà fermé */ }
    this.socket = null
    this.opts.onConnectionChange(false)
    await this.loopPromise?.catch(() => undefined)
    this.loopPromise = null
  }

  /**
   * Écrit un DP, borné par `signal` (plugin + délai commande).
   * N'attend PAS l'effet — c'est `waitForDps` qui le fait.
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
   * Attend que l'état accumulé contienne les valeurs attendues (preuve d'effet, pas l'accusé).
   * Résout aussi si `signal` est annulé — « continuer passé le plafond ».
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
      const onError = () => { /* bruit de reconnexion — piège 5 */ }
      sock.on('data', onData)
      sock.on('dp-refresh', onRefresh)
      sock.on('error', onError)

      try {
        await sock.connect()
        if (!this.running || this.opts.signal.aborted) break
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
        this.opts.logger?.debug({ err: String(err) }, 'tuya connect failed')
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

/** Fabrique réelle autour de `tuyapi` 7.7.1. */
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
