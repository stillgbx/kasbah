import { parseDeviceId, parseSceneId, type Command, type PluginHealth, type SceneRecall, type SceneUpdate } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { Clock } from './clock'
import { PluginError, type DevicePlugin, type PluginContext, type PluginFactory } from './plugin'
import { withTimeout } from './poll'
import type { DeviceRegistry } from './registry'
import type { SceneRegistry } from './scene-registry'

// Cycle de vie des plugins : sélection par KASBAH_PLUGINS, validation de leur config, isolation
// (un fabricant en panne ne fait jamais tomber la maison), arrêt propre.

export interface PluginHostOptions {
  enabled: string[]
  strict: boolean
  factories: Record<string, PluginFactory>
  registry: DeviceRegistry
  scenes: SceneRegistry
  clock: Clock
  logger: Logger
  /** Source des variables d'environnement (process.env par défaut). */
  envSource?: NodeJS.ProcessEnv
  commandTimeoutMs?: number
}

interface Slot {
  plugin: DevicePlugin
  ctrl: AbortController
  ctx: PluginContext | null
  status: PluginHealth
  config: Record<string, unknown> | null
}

export class PluginHost {
  private readonly slots = new Map<string, Slot>()
  private readonly order: string[] = []
  private readonly logger: Logger

  constructor(private readonly opts: PluginHostOptions) {
    this.logger = opts.logger.child({ component: 'plugins' })
    const known = Object.keys(opts.factories)
    for (const id of opts.enabled) {
      const factory = opts.factories[id]
      if (!factory) throw new Error(`unknown plugin "${id}" in KASBAH_PLUGINS (known: ${known.join(', ')})`)
      const plugin = factory()
      const parsed = plugin.configSchema.safeParse(opts.envSource ?? process.env)
      const slot: Slot = { plugin, ctrl: new AbortController(), ctx: null, status: { status: 'disabled' }, config: null }
      if (parsed.success) slot.config = parsed.data
      else {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        if (opts.strict) throw new Error(`plugin "${id}" configuration invalid: ${detail}`)
        this.logger.warn({ plugin: id, detail }, 'plugin disabled: invalid configuration')
        slot.status = { status: 'disabled', detail }
      }
      this.slots.set(id, slot)
      this.order.push(id)
    }
  }

  ids(): string[] { return [...this.order] }
  get(id: string): DevicePlugin | undefined { return this.slots.get(id)?.plugin }

  private makeContext(id: string, slot: Slot): PluginContext {
    const { registry, scenes } = this.opts
    return {
      pluginId: id,
      config: slot.config ?? {},
      logger: this.logger.child({ plugin: id }),
      clock: this.opts.clock,
      signal: slot.ctrl.signal,
      emitState: (externalId, patch) => { registry.applyPatch(`${id}:${externalId}`, { available: true, ...patch }) },
      setAvailable: (externalId, available) => { registry.setAvailable(id, externalId, available) },
      emitDevices: (descriptors) => { registry.register(id, descriptors) },
      emitScenes: (list) => { scenes.register(id, list) },
      emitSceneState: (externalId, active) => { scenes.setActive(`${id}:${externalId}`, active) },
    }
  }

  /** Enregistre les routes propres à chaque plugin sous /api/plugins/<id>/ (avant app.ready()). */
  registerRoutes(app: FastifyInstance): void {
    for (const [id, slot] of this.slots) {
      if (!slot.plugin.registerRoutes || !slot.config) continue
      app.register(async (sub) => { slot.plugin.registerRoutes!(sub) }, { prefix: `/api/plugins/${id}` })
    }
  }

  async startAll(): Promise<void> {
    for (const id of this.order) await this.startOne(id)
  }

  async startOne(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !slot.config) return
    const log = this.logger.child({ plugin: id })
    try {
      slot.ctrl = new AbortController()
      slot.ctx = this.makeContext(id, slot)
      await slot.plugin.init(slot.ctx)
      const descriptors = await slot.plugin.discover()
      this.opts.registry.register(id, descriptors)
      await slot.plugin.start()
      slot.status = { status: 'ok' }
      log.info({ devices: descriptors.length }, 'plugin started')
    } catch (err) {
      slot.status = { status: 'error', detail: (err as Error).message }
      log.error({ err }, 'plugin failed to start')
    }
  }

  /** Redémarre un plugin (ex. Hue après appairage). */
  async restart(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot) return
    await this.stopOne(id)
    await this.startOne(id)
  }

  async execute(deviceId: string, command: Command): Promise<void> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.config) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not enabled`)
    await withTimeout(slot.plugin.execute(externalId, command), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `command ${command.type}`)
  }

  async recallScene(sceneId: string, recall: SceneRecall): Promise<void> {
    const { pluginId, externalId } = parseSceneId(sceneId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.config) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not enabled`)
    if (!slot.plugin.recallScene) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no scenes`)
    await withTimeout(slot.plugin.recallScene(externalId, recall), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `recall ${sceneId}`)
  }

  async updateScene(sceneId: string, update: SceneUpdate): Promise<void> {
    const { pluginId, externalId } = parseSceneId(sceneId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.config) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not enabled`)
    if (!slot.plugin.updateScene) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" scenes are read-only`)
    await withTimeout(slot.plugin.updateScene(externalId, update), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `update ${sceneId}`)
  }

  health(): Record<string, PluginHealth> {
    const out: Record<string, PluginHealth> = {}
    for (const [id, slot] of this.slots) {
      const h = slot.config && slot.status.status !== 'error' ? slot.plugin.health?.() ?? slot.status : slot.status
      const shape = (slot.plugin.configSchema as unknown as { shape?: Record<string, unknown> }).shape
      out[id] = { ...h, deviceCount: this.opts.registry.countOf(id), keys: shape ? Object.keys(shape) : [] }
    }
    return out
  }

  private async stopOne(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !slot.ctx) return
    slot.ctrl.abort()
    try { await withTimeout(slot.plugin.stop(), 5000, this.opts.clock, `stop ${id}`) }
    catch (err) { this.logger.warn({ plugin: id, err }, 'plugin stop failed') }
    slot.ctx = null
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.order].reverse()) await this.stopOne(id)
  }
}
