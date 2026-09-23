import type { AutomationEntry, DeviceId, DeviceState, ServerMessage } from '@kasbah/shared'
import websocket from '@fastify/websocket'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { WebSocket } from 'ws'
import type { Bus } from '../core/bus'
import type { Clock } from '../core/clock'
import type { DeviceRegistry } from '../core/registry'
import type { SceneRegistry } from '../core/scene-registry'

// Hub WebSocket : snapshot à la connexion, puis push des états ENTIERS coalescés par appareil
// (une rafale d'événements SSE Hue devient une trame). Ping protocolaire pour purger les morts.

export interface WsHubOptions {
  coalesceMs?: number
  heartbeatMs?: number
  /** Scènes des fabricants (snapshot et push) ; absentes des tests qui n'en ont pas besoin. */
  scenes?: SceneRegistry
  /** Automatisations et leur statut (snapshot) ; le moteur pousse lui-même les changements. */
  automations?: { list(): AutomationEntry[] }
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
    this.unsubscribe.push(
      bus.on('state', (id, state) => { this.pending.set(id, state); this.scheduleFlush() }),
      bus.on('availability', (deviceIds, available) => {
        // les états complets suivent aussi par `state` ; on envoie la bascule groupée tout de suite
        for (const id of deviceIds) { const e = registry.get(id); if (e) this.pending.set(id, e.state) }
        this.broadcast({ type: 'availability', deviceIds, available })
        this.scheduleFlush()
      }),
      bus.on('devices', (entries) => this.broadcast({ type: 'devices', devices: entries })),
      // les scènes changent rarement (rappel manuel, interrupteur mural) : pas de coalescence
      bus.on('scenes', (entries) => this.broadcast({ type: 'scenes', scenes: entries })),
      bus.on('scene', (sceneId, state) => this.broadcast({ type: 'scene', sceneId, state })),
      // événement transitoire (sonnette, mouvement) : poussé tout de suite, jamais coalescé
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
    socket.on('message', () => { /* v1 : le client n'envoie rien d'utile */ })
    this.send(socket, { type: 'snapshot', serverTime: this.clock.now(), devices: this.registry.list(), scenes: this.scenes?.list() ?? [], automations: this.automations?.list() ?? [] })
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

  /** Envoie les états en attente (le dernier par appareil). Public pour les tests. */
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
