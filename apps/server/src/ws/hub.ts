import { EMPTY_SHOPPING_LIST, type AutomationEntry, type DeviceId, type DeviceState, type Right, type ServerMessage, type ShoppingList } from '@kasbah/shared'
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { WebSocket } from 'ws'
import type { Bus } from '../core/bus'
import type { Clock } from '../core/clock'
import type { DeviceRegistry } from '../core/registry'
import type { SceneRegistry } from '../core/scene-registry'
import { filterMessage, registryRight, type Access } from '../http/rights'

// WebSocket hub: snapshot on connection, then push of FULL states coalesced per device (a burst of
// Hue SSE events becomes one frame). Protocol ping to purge dead clients.
//
// Each connection keeps its account (`req.account`, `null` = the machine itself): an account with
// a list of rights only receives what they let it see. The rights are re-read at each connection and
// at each ping; when an account's change, its screens get a new snapshot, and a removed account's
// screens are closed.

export interface WsHubOptions {
  coalesceMs?: number
  heartbeatMs?: number
  /** Vendor scenes (snapshot and push); absent from tests that don't need them. */
  scenes?: SceneRegistry
  /** Automations and their status (snapshot); the engine pushes the changes itself. */
  automations?: { list(): AutomationEntry[] }
  /** Shopping list (snapshot); the service pushes the changes itself. */
  shopping?: { get(): ShoppingList }
  /** Property the server is running: a screen that finds it changed reloads. */
  propertyId?: () => string
  /** Web build being served: a screen carrying another build offers to reload. */
  appBuild?: () => string | undefined
  /** Rights of each account (`http/rights.ts`, `accountRights`); absent = no filtering. */
  rights?: () => Promise<ReadonlyMap<string, Access>>
}

interface Client { alive: boolean; user: string | null; key: string }

export class WsHub {
  private readonly clients = new Map<WebSocket, Client>()
  private accounts: ReadonlyMap<string, Access> = new Map()
  private readonly pending = new Map<DeviceId, DeviceState>()
  private flushTimer: unknown = null
  private heartbeat: unknown = null
  private readonly unsubscribe: (() => void)[] = []
  private readonly coalesceMs: number
  private readonly heartbeatMs: number
  private readonly scenes: SceneRegistry | undefined
  private readonly automations: WsHubOptions['automations']
  private readonly shopping: WsHubOptions['shopping']
  private readonly propertyId: WsHubOptions['propertyId']
  private readonly appBuild: WsHubOptions['appBuild']
  private readonly rights: WsHubOptions['rights']

  constructor(
    private readonly registry: DeviceRegistry,
    bus: Bus,
    private readonly clock: Clock,
    private readonly logger: Logger,
    opts: WsHubOptions = {},
  ) {
    this.coalesceMs = opts.coalesceMs ?? 50
    this.heartbeatMs = opts.heartbeatMs ?? 15_000
    this.scenes = opts.scenes
    this.automations = opts.automations
    this.shopping = opts.shopping
    this.propertyId = opts.propertyId
    this.appBuild = opts.appBuild
    this.rights = opts.rights
    this.unsubscribe.push(
      bus.on('state', (id, state) => { this.pending.set(id, state); this.scheduleFlush() }),
      bus.on('availability', (deviceIds, available) => {
        // the full states also follow through `state`; the grouped toggle is sent right away
        for (const id of deviceIds) { const e = registry.get(id); if (e) this.pending.set(id, e.state) }
        this.broadcast({ type: 'availability', deviceIds, available })
        this.scheduleFlush()
      }),
      bus.on('devices', (entries) => this.broadcast({ type: 'devices', devices: entries })),
      // scenes change rarely (manual recall, wall switch): no coalescing
      bus.on('scenes', (entries) => this.broadcast({ type: 'scenes', scenes: entries })),
      bus.on('scene', (sceneId, state) => this.broadcast({ type: 'scene', sceneId, state })),
      // transient event (doorbell, motion): pushed right away, never coalesced
      bus.on('deviceEvent', (deviceId, event, at) => this.broadcast({ type: 'deviceEvent', deviceId, event, at })),
    )
  }

  get clientCount(): number { return this.clients.size }

  async attach(app: FastifyInstance): Promise<void> {
    await app.register(websocket, { options: { maxPayload: 1 << 20 } })
    // the rights as they are now, before the snapshot
    app.get('/ws', { websocket: true, preHandler: async () => { await this.refreshRights() } },
      (socket, req) => this.onConnection(socket, req.account ?? null))
    this.heartbeat = this.clock.setInterval(() => {
      this.pingAll()
      this.refreshRights().catch((err: unknown) => this.logger.warn({ err }, 'ws rights not re-read'))
    }, this.heartbeatMs)
  }

  /**
   * What `user` may see: `*` everything (`*!` for an admin, so that a change of role sends the screen
   * a new snapshot, which re-reads the session), `-` nothing (no such account), otherwise its rights.
   */
  private keyOf(user: string | null): string {
    if (user === null || !this.rights) return '*'
    const access = this.accounts.get(user)
    if (!access) return '-'
    return access.admin ? '*!' : access.rights?.join(',') ?? '*'
  }

  /** The message as an account with this key receives it; `null` = nothing. */
  private view(key: string, msg: ServerMessage): ServerMessage | null {
    if (key === '*' || key === '*!') return msg
    if (key === '-') return null
    const rights = key ? key.split(',') as Right[] : []
    return filterMessage(msg, rights, registryRight(this.registry))
  }

  private snapshot(): ServerMessage {
    const appBuild = this.appBuild?.()
    return { type: 'snapshot', serverTime: this.clock.now(), devices: this.registry.list(), scenes: this.scenes?.list() ?? [], automations: this.automations?.list() ?? [], shopping: this.shopping?.get() ?? EMPTY_SHOPPING_LIST, ...(this.propertyId ? { propertyId: this.propertyId() } : {}), ...(appBuild ? { appBuild } : {}) }
  }

  /** Re-reads the rights: a screen whose account changed gets a new snapshot, a removed account's closes. */
  async refreshRights(): Promise<void> {
    if (!this.rights) return
    this.accounts = await this.rights()
    for (const [socket, c] of this.clients) {
      if (c.user === null) continue
      const key = this.keyOf(c.user)
      if (key === c.key) continue
      if (key === '-') { socket.close(1008, 'account removed'); this.clients.delete(socket); continue }
      c.key = key
      const snapshot = this.view(key, this.snapshot())
      if (snapshot) this.send(socket, snapshot)
    }
  }

  private onConnection(socket: WebSocket, user: string | null): void {
    const key = this.keyOf(user)
    if (key === '-') { socket.close(1008, 'no such account'); return }
    this.clients.set(socket, { alive: true, user, key })
    socket.on('pong', () => { const c = this.clients.get(socket); if (c) c.alive = true })
    socket.on('close', () => this.clients.delete(socket))
    socket.on('error', (err) => { this.logger.debug({ err }, 'ws client error'); this.clients.delete(socket) })
    socket.on('message', () => { /* v1: the client sends nothing useful */ })
    const snapshot = this.view(key, this.snapshot())
    if (snapshot) this.send(socket, snapshot)
    this.logger.debug({ clients: this.clients.size }, 'ws client connected')
  }

  private pingAll(): void {
    for (const [socket, c] of this.clients) {
      if (!c.alive) { socket.terminate(); this.clients.delete(socket); continue }
      c.alive = false
      try { socket.ping() } catch { this.clients.delete(socket) }
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return
    this.flushTimer = this.clock.setTimeout(() => { this.flushTimer = null; this.flush() }, this.coalesceMs)
  }

  /** Sends the pending states (the last one per device). Public for tests. */
  flush(): void {
    for (const [deviceId, state] of this.pending) this.broadcast({ type: 'state', deviceId, state })
    this.pending.clear()
  }

  broadcast(msg: ServerMessage): void {
    if (this.clients.size === 0) return
    // one serialisation per set of rights, not per screen
    const frames = new Map<string, string | null>()
    for (const [socket, c] of this.clients) {
      if (socket.readyState !== socket.OPEN) continue
      if (!frames.has(c.key)) { const v = this.view(c.key, msg); frames.set(c.key, v && JSON.stringify(v)) }
      const data = frames.get(c.key)
      if (data) socket.send(data)
    }
  }

  private send(socket: WebSocket, msg: ServerMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg))
  }

  close(): void {
    for (const u of this.unsubscribe) u()
    if (this.heartbeat !== null) this.clock.clearInterval(this.heartbeat)
    if (this.flushTimer !== null) this.clock.clearTimeout(this.flushTimer)
    for (const socket of this.clients.keys()) socket.close(1001, 'server shutting down')
    this.clients.clear()
  }
}
