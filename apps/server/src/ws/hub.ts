import { EMPTY_SHOPPING_LIST, type AutomationEntry, type DeviceId, type DeviceState, type ServerMessage, type ShoppingList } from '@kasbah/shared'
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { WebSocket } from 'ws'
import type { Bus } from '../core/bus'
import type { Clock } from '../core/clock'
import type { DeviceRegistry } from '../core/registry'
import type { SceneRegistry } from '../core/scene-registry'

// WebSocket hub: snapshot on connection, then push of FULL states coalesced per device (a burst of
// Hue SSE events becomes one frame). Protocol ping to purge dead clients.

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
}

export class WsHub {
  private readonly clients = new Map<WebSocket, { alive: boolean }>()
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
    app.get('/ws', { websocket: true }, (socket) => this.onConnection(socket))
    this.heartbeat = this.clock.setInterval(() => this.pingAll(), this.heartbeatMs)
  }

  private onConnection(socket: WebSocket): void {
    this.clients.set(socket, { alive: true })
    socket.on('pong', () => { const c = this.clients.get(socket); if (c) c.alive = true })
    socket.on('close', () => this.clients.delete(socket))
    socket.on('error', (err) => { this.logger.debug({ err }, 'ws client error'); this.clients.delete(socket) })
    socket.on('message', () => { /* v1: the client sends nothing useful */ })
    const appBuild = this.appBuild?.()
    this.send(socket, { type: 'snapshot', serverTime: this.clock.now(), devices: this.registry.list(), scenes: this.scenes?.list() ?? [], automations: this.automations?.list() ?? [], shopping: this.shopping?.get() ?? EMPTY_SHOPPING_LIST, ...(this.propertyId ? { propertyId: this.propertyId() } : {}), ...(appBuild ? { appBuild } : {}) })
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
    const data = JSON.stringify(msg)
    for (const socket of this.clients.keys()) {
      if (socket.readyState === socket.OPEN) socket.send(data)
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
