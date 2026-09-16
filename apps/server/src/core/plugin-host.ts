import { DEFAULT_PLUGIN_SETTINGS, parseDeviceId, parseSceneId, type Command, type PluginHealth, type PluginInfo, type PluginSettings, type SceneRecall, type SceneUpdate, type DeviceJournal, type WeatherForecast } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { Bus } from './bus'
import type { Clock } from './clock'
import { PluginError, type DevicePlugin, type PluginContext, type PluginFactory, type PluginSite } from './plugin'
import { withTimeout } from './poll'
import type { DeviceRegistry } from './registry'
import type { SceneRegistry } from './scene-registry'

// Cycle de vie des plugins : TOUS sont instanciés, la MAISON dit lesquels tournent
// (`house.plugins`, décidé depuis Réglages), validation de leur config, isolation (un fabricant en
// panne ne fait jamais tomber la maison), arrêt propre.

export interface PluginHostOptions {
  /** Position de la maison (`house.origin`), donnée aux plugins par `ctx.site`. Relue à chaque démarrage de plugin. */
  site: () => PluginSite
  /** Réglages du plugin dans la maison courante. Relu à chaque fois : house.json peut changer. */
  settingsOf: (pluginId: string) => PluginSettings
  strict: boolean
  factories: Record<string, PluginFactory>
  registry: DeviceRegistry
  scenes: SceneRegistry
  bus: Bus
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
  /** Sous-items avec lesquels le plugin TOURNE : en changer demande un redémarrage. */
  appliedParts: Record<string, boolean> | null
}

export class PluginHost {
  private readonly slots = new Map<string, Slot>()
  private readonly order: string[] = []
  private readonly logger: Logger

  constructor(private readonly opts: PluginHostOptions) {
    this.logger = opts.logger.child({ component: 'plugins' })
    for (const [id, factory] of Object.entries(opts.factories)) {
      const plugin = factory()
      const parsed = plugin.configSchema.safeParse(opts.envSource ?? process.env)
      const slot: Slot = { plugin, ctrl: new AbortController(), ctx: null, status: { status: 'disabled' }, config: null, appliedParts: null }
      if (parsed.success) slot.config = parsed.data
      else {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        // config illisible : le plugin reste déclaré et visible, il ne peut simplement pas démarrer
        if (opts.strict && opts.settingsOf(id).enabled) throw new Error(`plugin "${id}" configuration invalid: ${detail}`)
        this.logger.warn({ plugin: id, detail }, 'plugin cannot start: invalid configuration')
        slot.status = { status: 'error', detail }
      }
      this.slots.set(id, slot)
      this.order.push(id)
    }
  }

  ids(): string[] { return [...this.order] }
  get(id: string): DevicePlugin | undefined { return this.slots.get(id)?.plugin }

  /** Voulu allumé : coché dans la maison, et réellement implémenté (un squelette ne s'allume pas). */
  private isEnabled(id: string): boolean {
    const slot = this.slots.get(id)
    return this.opts.settingsOf(id).enabled && slot?.plugin.implemented !== false
  }

  /** Sous-items effectifs : défaut déclaré par le plugin, écrasé par le choix de la maison. */
  private resolveParts(id: string, slot: Slot): Record<string, boolean> {
    const chosen = this.opts.settingsOf(id).parts
    const out: Record<string, boolean> = {}
    for (const part of slot.plugin.parts ?? []) out[part.id] = chosen[part.id] ?? part.enabledByDefault
    return out
  }

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
      emitEvent: (externalId, event) => { this.opts.bus.emit('deviceEvent', `${id}:${externalId}`, event, this.opts.clock.now()) },
      parts: this.resolveParts(id, slot),
      site: this.opts.site(),
    }
  }

  /**
   * Enregistre les routes propres à chaque plugin sous /api/plugins/<id>/ (avant app.ready()).
   * Y compris pour un plugin éteint : Fastify n'accepte plus de route après `ready()`, et c'est
   * souvent par là qu'on appaire un fabricant AVANT de l'allumer.
   */
  registerRoutes(app: FastifyInstance): void {
    for (const [id, slot] of this.slots) {
      if (!slot.plugin.registerRoutes || !slot.config) continue
      app.register(async (sub) => { slot.plugin.registerRoutes!(sub) }, { prefix: `/api/plugins/${id}` })
    }
  }

  async startAll(): Promise<void> {
    for (const id of this.order) if (this.isEnabled(id)) await this.startOne(id)
  }

  /**
   * Aligne un plugin sur ce que dit la maison, après une écriture depuis l'UI : l'allume, l'éteint,
   * ou le redémarre si ses sous-items ont changé. Seul chemin appelé par les routes.
   */
  async apply(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot) return
    const want = this.isEnabled(id) && !!slot.config
    const running = slot.ctx !== null
    if (want && running) {
      const parts = this.resolveParts(id, slot)
      if (JSON.stringify(parts) !== JSON.stringify(slot.appliedParts)) await this.restart(id)
      return
    }
    if (want === running) return
    if (want) await this.startOne(id)
    else {
      await this.stopOne(id)
      // éteint = sorti de la maison : ses appareils et ses ambiances quittent les registres, sinon
      // les tablettes garderaient une liste que plus personne n'alimente
      this.opts.registry.register(id, [])
      this.opts.scenes.register(id, [])
      slot.status = { status: 'disabled' }
      this.logger.info({ plugin: id }, 'plugin stopped')
    }
  }

  async startOne(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !slot.config) return
    const log = this.logger.child({ plugin: id })
    try {
      slot.ctrl = new AbortController()
      slot.ctx = this.makeContext(id, slot)
      slot.appliedParts = slot.ctx.parts
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

  /** Redémarre un plugin (ex. Hue après appairage). Éteint dans la maison, il le reste. */
  async restart(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !this.isEnabled(id)) return
    await this.stopOne(id)
    await this.startOne(id)
  }

  async execute(deviceId: string, command: Command): Promise<void> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    await withTimeout(slot.plugin.execute(externalId, command), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `command ${command.type}`)
  }

  /** Prévisions d'un appareil `weather` ; `NOT_IMPLEMENTED` si son plugin n'en sert pas. */
  async forecast(deviceId: string): Promise<WeatherForecast> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.forecast) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no forecast`)
    const f = await withTimeout(slot.plugin.forecast(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `forecast ${deviceId}`)
    return { deviceId, ...f }
  }

  /** Journal d'un appareil ; `NOT_IMPLEMENTED` si son plugin n'en tient pas. */
  async journal(deviceId: string): Promise<DeviceJournal> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.journal) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no journal`)
    const j = await withTimeout(slot.plugin.journal(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `journal ${deviceId}`)
    return { deviceId, ...j }
  }

  async recallScene(sceneId: string, recall: SceneRecall): Promise<void> {
    const { pluginId, externalId } = parseSceneId(sceneId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.recallScene) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no scenes`)
    await withTimeout(slot.plugin.recallScene(externalId, recall), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `recall ${sceneId}`)
  }

  async updateScene(sceneId: string, update: SceneUpdate): Promise<void> {
    const { pluginId, externalId } = parseSceneId(sceneId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.updateScene) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" scenes are read-only`)
    await withTimeout(slot.plugin.updateScene(externalId, update), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `update ${sceneId}`)
  }

  async createScene(fromSceneId: string, groupName: string): Promise<void> {
    const { pluginId, externalId } = parseSceneId(fromSceneId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.createScene) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" cannot create scenes`)
    await withTimeout(slot.plugin.createScene(externalId, groupName), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `create scene in ${groupName}`)
  }

  async deleteScene(sceneId: string): Promise<void> {
    const { pluginId, externalId } = parseSceneId(sceneId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.deleteScene) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" cannot delete scenes`)
    await withTimeout(slot.plugin.deleteScene(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `delete ${sceneId}`)
  }

  health(): Record<string, PluginHealth> {
    const out: Record<string, PluginHealth> = {}
    for (const [id, slot] of this.slots) out[id] = this.healthOf(id, slot)
    return out
  }

  private healthOf(id: string, slot: Slot): PluginHealth {
    const shape = (slot.plugin.configSchema as unknown as { shape?: Record<string, unknown> }).shape
    const keys = shape ? Object.keys(shape) : []
    const deviceCount = this.opts.registry.countOf(id)
    // éteint dans la maison : on ne demande pas son avis au plugin, il ne tourne pas
    if (!this.isEnabled(id)) {
      const status = slot.plugin.implemented === false ? 'not_implemented' : 'disabled'
      return { status, ...(slot.status.detail ? { detail: slot.status.detail } : {}), deviceCount, keys }
    }
    const h = slot.ctx && slot.status.status !== 'error' ? slot.plugin.health?.() ?? slot.status : slot.status
    return { ...h, deviceCount, keys }
  }

  /** Inventaire de l'écran Réglages : ce qu'est chaque plugin, ce qu'on en a choisi, comment il va. */
  inventory(): PluginInfo[] {
    return this.order.map((id) => {
      const slot = this.slots.get(id)!
      const settings = this.opts.settingsOf(id) ?? DEFAULT_PLUGIN_SETTINGS
      const parts = this.resolveParts(id, slot)
      return {
        id,
        implemented: slot.plugin.implemented !== false,
        enabled: settings.enabled,
        // le réglage des ambiances n'a de sens que chez un fabricant qui en écrit
        ...(slot.plugin.updateScene ? { autoDynamicForNewScenes: settings.autoDynamicForNewScenes } : {}),
        parts: (slot.plugin.parts ?? []).map((p) => ({ id: p.id, labelKey: p.labelKey, enabled: parts[p.id] ?? p.enabledByDefault })),
        health: this.healthOf(id, slot),
      }
    })
  }

  private async stopOne(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !slot.ctx) return
    slot.ctrl.abort()
    try { await withTimeout(slot.plugin.stop(), 5000, this.opts.clock, `stop ${id}`) }
    catch (err) { this.logger.warn({ plugin: id, err }, 'plugin stop failed') }
    slot.ctx = null
    slot.appliedParts = null
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.order].reverse()) await this.stopOne(id)
  }
}
