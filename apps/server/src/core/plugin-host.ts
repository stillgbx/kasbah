import { DEFAULT_PLUGIN_SETTINGS, parseDeviceId, parseSceneId, type Command, type PluginHealth, type PluginInfo, type PluginSettings, type SceneRecall, type SceneUpdate, type DeviceConsumption, type DeviceJournal, type WeatherForecast } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { chargerToForce } from './chargeCoordination'
import { createBackoff, type Backoff } from './backoff'
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
  /** Premier délai avant de retenter un démarrage raté (doublé à chaque échec, plafonné à 10 min). */
  retryInitialMs?: number
}

/** Plafond des nouvelles tentatives : une box absente pour la nuit ne doit pas être sondée en boucle. */
const RETRY_MAX_MS = 10 * 60_000

interface Slot {
  plugin: DevicePlugin
  ctrl: AbortController
  ctx: PluginContext | null
  status: PluginHealth
  config: Record<string, unknown> | null
  /** Sous-items avec lesquels le plugin TOURNE : en changer demande un redémarrage. */
  appliedParts: Record<string, boolean> | null
  /** Nouvelle tentative de démarrage programmée après un échec (voir `startOne`). */
  retry: unknown
  retryBackoff: Backoff
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
      const slot: Slot = {
        plugin, ctrl: new AbortController(), ctx: null, status: { status: 'disabled' }, config: null, appliedParts: null,
        retry: null, retryBackoff: createBackoff({ initialMs: opts.retryInitialMs ?? 15_000, maxMs: RETRY_MAX_MS, jitter: 0.1 }),
      }
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

  /**
   * Tous les plugins démarrent en même temps : un fabricant lent (la découverte Cast attend le mDNS
   * puis chaque appareil) ne retarde plus les autres. `startOne` rattrape ses propres erreurs.
   */
  async startAll(): Promise<void> {
    await Promise.all(this.order.filter((id) => this.isEnabled(id)).map((id) => this.startOne(id)))
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
      slot.retryBackoff.reset()
      log.info({ devices: descriptors.length }, 'plugin started')
    } catch (err) {
      const message = (err as Error).message
      // Un fabricant injoignable AU DÉMARRAGE (box qui redémarre, réseau pas encore monté) laissait
      // le plugin en erreur jusqu'au prochain redémarrage du serveur — relevé le 2026-09-24 sur la
      // TaHoma. On retente donc, de plus en plus espacé. Sauf un appairage manquant ou refusé : là,
      // c'est à l'utilisateur d'agir, et le réessayer ne ferait que marteler le fabricant.
      if (err instanceof PluginError && err.code === 'NEEDS_PAIRING') {
        slot.status = { status: 'error', detail: message }
        log.error({ err }, 'plugin failed to start')
        return
      }
      const delay = slot.retryBackoff.next()
      slot.status = { status: 'error', detail: `${message} (retry in ${Math.round(delay / 1000)} s)` }
      log.error({ err, retryInMs: delay }, 'plugin failed to start, will retry')
      slot.retry = this.opts.clock.setTimeout(() => { slot.retry = null; void this.retryStart(id) }, delay)
    }
  }

  /** Nouvelle tentative après un échec : on repart d'un plugin arrêté proprement, s'il est toujours voulu. */
  private async retryStart(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !this.isEnabled(id) || slot.status.status !== 'error') return
    await this.stopOne(id)
    await this.startOne(id)
  }

  /** Redémarre un plugin (ex. Hue après appairage). Éteint dans la maison, il le reste. */
  async restart(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !this.isEnabled(id)) return
    await this.stopOne(id)
    await this.startOne(id)
  }

  /**
   * Une commande, d'où qu'elle vienne (interface, automatisation, MCP). « Charger » une voiture force
   * d'abord la borne où elle est branchée (`chargerToForce`) ; un échec de la borne n'empêche pas
   * d'envoyer la commande à la voiture.
   */
  async execute(deviceId: string, command: Command): Promise<void> {
    const charger = chargerToForce(deviceId, command, this.opts.registry.list(), this.opts.site())
    if (charger) {
      try {
        await this.dispatch(charger, { type: 'ev_charger.start' })
        this.opts.logger.info({ vehicle: deviceId, charger }, 'charger forced to charge the vehicle')
      } catch (err) {
        this.opts.logger.warn({ err, vehicle: deviceId, charger }, 'could not force the charger: starting the vehicle anyway')
      }
    }
    await this.dispatch(deviceId, command)
  }

  private async dispatch(deviceId: string, command: Command): Promise<void> {
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

  /** Consommation d'un appareil ; `NOT_IMPLEMENTED` si son plugin n'en tient pas. */
  async consumption(deviceId: string): Promise<DeviceConsumption> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.consumption) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no consumption history`)
    const c = await withTimeout(slot.plugin.consumption(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `consumption ${deviceId}`)
    return { deviceId, ...c }
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
    if (!slot) return
    // arrêté, éteint ou redémarré à la main : une tentative programmée n'a plus lieu d'être
    if (slot.retry !== null) { this.opts.clock.clearTimeout(slot.retry); slot.retry = null }
    if (!slot.ctx) return
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
