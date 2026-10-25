import { DEFAULT_PLUGIN_SETTINGS, parseDeviceId, parseSceneId, type Command, type DeviceState, type PluginHealth, type StatePatch, type PluginInfo, type PluginSettings, type SceneRecall, type SceneUpdate, type DeviceConsumption, type DeviceEnergyDays, type DeviceJournal, type DeviceReleaseNotes, type SiteMap, type WeatherForecast } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { chargeLimitReached, chargerToForce, chargerToStop, chargingRefuted } from './chargeCoordination'
import { createBackoff, type Backoff } from './backoff'
import type { Bus } from './bus'
import type { Clock } from './clock'
import { PluginError, type DevicePlugin, type PluginContext, type PluginFactory, type PluginSite } from './plugin'
import { withTimeout } from './poll'
import type { DeviceRegistry } from './registry'
import type { SceneRegistry } from './scene-registry'

// Plugin lifecycle: ALL are instantiated, the HOUSE says which ones run (`house.plugins`, decided
// from Settings), validation of their config, isolation (a broken vendor never brings the house
// down), clean shutdown.

export interface PluginHostOptions {
  /** Position of the house (`house.origin`), given to plugins through `ctx.site`. Re-read at each plugin start. */
  site: () => PluginSite
  /** The plugin's settings in the current house. Re-read every time: house.json may change. */
  settingsOf: (pluginId: string) => PluginSettings
  strict: boolean
  factories: Record<string, PluginFactory>
  registry: DeviceRegistry
  scenes: SceneRegistry
  bus: Bus
  clock: Clock
  logger: Logger
  /** Source of the environment variables (process.env by default). */
  envSource?: NodeJS.ProcessEnv
  commandTimeoutMs?: number
  /** First delay before retrying a failed start (doubled on each failure, capped at 10 min). */
  retryInitialMs?: number
}

/** Cap on retries: a box gone for the night must not be polled in a loop. */
const RETRY_MAX_MS = 10 * 60_000

interface Slot {
  plugin: DevicePlugin
  ctrl: AbortController
  ctx: PluginContext | null
  status: PluginHealth
  config: Record<string, unknown> | null
  /** Sub-items the plugin is RUNNING with: changing them requires a restart. */
  appliedParts: Record<string, boolean> | null
  /** Start retry scheduled after a failure (see `startOne`). */
  retry: unknown
  retryBackoff: Backoff
}

export class PluginHost {
  private readonly slots = new Map<string, Slot>()
  private readonly order: string[] = []
  private readonly logger: Logger
  /** Vehicle → charger that Kasbah forced for it, until its limit or its unplugging. */
  private readonly forcedFor = new Map<string, string>()
  /** Vehicles whose PLUGIN says they are charging: what `chargingRefuted` can contradict then restore. */
  private readonly claimsCharging = new Set<string>()

  constructor(private readonly opts: PluginHostOptions) {
    this.logger = opts.logger.child({ component: 'plugins' })
    opts.bus.on('state', (id, state) => {
      this.onVehicleState(id, state)
      if (state.kind === 'ev_charger') this.recheckChargingClaims()
    })
    opts.bus.on('availability', () => this.recheckChargingClaims())
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
        // unreadable config: the plugin stays declared and visible, it simply cannot start
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

  /** Wanted on: checked in the house, and actually implemented (a skeleton does not turn on). */
  private isEnabled(id: string): boolean {
    const slot = this.slots.get(id)
    return this.opts.settingsOf(id).enabled && slot?.plugin.implemented !== false
  }

  /** Effective sub-items: default declared by the plugin, overridden by the house's choice. */
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
      emitState: (externalId, patch) => {
        const deviceId = `${id}:${externalId}`
        registry.applyPatch(deviceId, { available: true, ...this.checkChargingClaim(deviceId, patch) })
      },
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
   * Registers each plugin's own routes under /api/plugins/<id>/ (before app.ready()).
   * Including for a plugin that is off: Fastify no longer accepts routes after `ready()`, and that
   * is often how a vendor is paired BEFORE turning it on.
   */
  registerRoutes(app: FastifyInstance): void {
    for (const [id, slot] of this.slots) {
      if (!slot.plugin.registerRoutes || !slot.config) continue
      app.register(async (sub) => { slot.plugin.registerRoutes!(sub) }, { prefix: `/api/plugins/${id}` })
    }
  }

  /**
   * All plugins start at the same time: a slow vendor (Cast discovery waits for mDNS then each
   * device) no longer delays the others. `startOne` catches its own errors.
   */
  async startAll(): Promise<void> {
    await Promise.all(this.order.filter((id) => this.isEnabled(id)).map((id) => this.startOne(id)))
  }

  /**
   * Aligns a plugin with what the house says, after a write from the UI: turns it on, off, or
   * restarts it if its sub-items changed. The only path called by the routes.
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
      // off = out of the house: its devices and light scenes leave the registries, otherwise the
      // screens would keep a list that nobody feeds anymore
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
      // A vendor unreachable AT STARTUP (box restarting, network not up yet) left the plugin in
      // error until the next server restart — seen on 2026-09-24 on the TaHoma. So we retry, more
      // and more spaced out. Except a missing or refused pairing: there, it is up to the user to
      // act, and retrying would only hammer the vendor.
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

  /** Retry after a failure: start again from a cleanly stopped plugin, if it is still wanted. */
  private async retryStart(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !this.isEnabled(id) || slot.status.status !== 'error') return
    await this.stopOne(id)
    await this.startOne(id)
  }

  /** Restarts a plugin (e.g. Hue after pairing). Off in the house, it stays off. */
  async restart(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot || !this.isEnabled(id)) return
    await this.stopOne(id)
    await this.startOne(id)
  }

  /**
   * A command, wherever it comes from (interface, automation, MCP). "Start charging" on a car first
   * forces the charger it is plugged into (`chargerToForce`); a charger failure does not prevent
   * sending the command to the car.
   */
  async execute(deviceId: string, command: Command): Promise<void> {
    // a vehicle that cannot stop itself (`meta.vehicle.stopViaCharger`): its charger is what
    // stops, and nothing goes to the vehicle, which would refuse
    const stopper = chargerToStop(deviceId, command, this.opts.registry.list(), this.opts.site())
    if (stopper) {
      await this.dispatch(stopper, { type: 'ev_charger.stop' })
      this.forcedFor.delete(deviceId)
      this.opts.logger.info({ vehicle: deviceId, charger: stopper }, 'charger stopped for a vehicle that cannot stop itself')
      return
    }
    const charger = chargerToForce(deviceId, command, this.opts.registry.list(), this.opts.site())
    if (charger) {
      try {
        await this.dispatch(charger, { type: 'ev_charger.start' })
        this.forcedFor.set(deviceId, charger)
        this.opts.logger.info({ vehicle: deviceId, charger }, 'charger forced to charge the vehicle')
      } catch (err) {
        this.opts.logger.warn({ err, vehicle: deviceId, charger }, 'could not force the charger: starting the vehicle anyway')
      }
    }
    await this.dispatch(deviceId, command)
  }

  /**
   * The car of a forced charger reaches its limit: the charger goes back to its mode from before the
   * forcing (`chargeLimitReached`). Unplugged before that, the charger notices it (Enphase plugin).
   */
  private onVehicleState(vehicleId: string, state: DeviceState): void {
    const charger = this.forcedFor.get(vehicleId)
    if (!charger || state.kind !== 'vehicle') return
    if (state.pluggedIn === false) { this.forcedFor.delete(vehicleId); return }
    if (!chargeLimitReached(state)) return
    this.forcedFor.delete(vehicleId)
    this.dispatch(charger, { type: 'ev_charger.resume_mode' }).then(
      () => this.logger.info({ vehicle: vehicleId, charger }, 'charge limit reached: charger back to its mode'),
      (err) => this.logger.warn({ err, vehicle: vehicleId, charger }, 'charge limit reached: charger mode not resumed'),
    )
  }

  /**
   * "Charging" as said by a vehicle goes through `chargingRefuted`: contradicted as long as no charger
   * of the house is charging, restored as soon as one charges (`recheckChargingClaims`). The plugin
   * keeps its word: we remember what it said, not what we published.
   */
  private checkChargingClaim(deviceId: string, patch: StatePatch): StatePatch {
    if ('charging' in patch) {
      if ((patch as { charging?: boolean }).charging === true) this.claimsCharging.add(deviceId)
      else this.claimsCharging.delete(deviceId)
    }
    if (!this.claimsCharging.has(deviceId)) return patch
    const current = this.opts.registry.get(deviceId)?.state
    if (current?.kind !== 'vehicle') return patch
    const claimed = { ...current, ...patch, charging: true } as DeviceState
    return chargingRefuted(claimed, this.opts.registry.list(), this.opts.site())
      ? { ...patch, charging: false, chargeMinutesRemaining: null } as StatePatch
      : { ...patch, charging: true } as StatePatch
  }

  /** A charger changed: the word of each vehicle that says it is charging is re-read. */
  private recheckChargingClaims(): void {
    const { registry } = this.opts
    for (const id of this.claimsCharging) {
      const state = registry.get(id)?.state
      if (state?.kind !== 'vehicle') { this.claimsCharging.delete(id); continue }
      const charging = !chargingRefuted({ ...state, charging: true }, registry.list(), this.opts.site())
      if (state.charging === charging) continue
      registry.applyPatch(id, (charging ? { charging } : { charging, chargeMinutesRemaining: null }) as StatePatch)
      this.logger.info({ vehicle: id, charging }, charging ? 'a charger is charging: vehicle charging again' : 'no charger at home is charging: vehicle charging refuted')
    }
  }

  private async dispatch(deviceId: string, command: Command): Promise<void> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    await withTimeout(slot.plugin.execute(externalId, command), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `command ${command.type}`)
  }

  /** Forecasts of a `weather` device; `NOT_IMPLEMENTED` if its plugin serves none. */
  async forecast(deviceId: string): Promise<WeatherForecast> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.forecast) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no forecast`)
    const f = await withTimeout(slot.plugin.forecast(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `forecast ${deviceId}`)
    return { deviceId, ...f }
  }

  /** A device's log; `NOT_IMPLEMENTED` if its plugin keeps none. */
  async journal(deviceId: string): Promise<DeviceJournal> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.journal) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no journal`)
    const j = await withTimeout(slot.plugin.journal(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `journal ${deviceId}`)
    return { deviceId, ...j }
  }

  /** A device's plot map; `NOT_IMPLEMENTED` if its plugin publishes none. */
  async siteMap(deviceId: string): Promise<SiteMap> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.siteMap) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no site map`)
    const m = await withTimeout(slot.plugin.siteMap(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `site map ${deviceId}`)
    return { deviceId, ...m }
  }

  /** A vehicle's release notes; `NOT_IMPLEMENTED` if its plugin keeps none. */
  async releaseNotes(deviceId: string, lang: string): Promise<DeviceReleaseNotes> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.releaseNotes) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no release notes`)
    const n = await withTimeout(slot.plugin.releaseNotes(externalId, lang), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `release notes ${deviceId}`)
    return { deviceId, ...n }
  }

  /** A device's consumption; `NOT_IMPLEMENTED` if its plugin keeps none. */
  async consumption(deviceId: string): Promise<DeviceConsumption> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.consumption) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no consumption history`)
    const c = await withTimeout(slot.plugin.consumption(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `consumption ${deviceId}`)
    return { deviceId, ...c }
  }

  /** A site's daily energy totals; `NOT_IMPLEMENTED` if its plugin keeps none. */
  async energyDays(deviceId: string): Promise<DeviceEnergyDays> {
    const { pluginId, externalId } = parseDeviceId(deviceId)
    const slot = this.slots.get(pluginId)
    if (!slot || !slot.ctx) throw new PluginError('DEVICE_UNAVAILABLE', `plugin "${pluginId}" is not running`)
    if (!slot.plugin.energyDays) throw new PluginError('NOT_IMPLEMENTED', `plugin "${pluginId}" has no energy history`)
    const d = await withTimeout(slot.plugin.energyDays(externalId), this.opts.commandTimeoutMs ?? 10_000, this.opts.clock, `energy days ${deviceId}`)
    return { deviceId, ...d }
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

  /** `user`: the requesting account (session, MCP token); a plugin with per-user accounts returns theirs. */
  async health(user: string | null = null): Promise<Record<string, PluginHealth>> {
    const out: Record<string, PluginHealth> = {}
    for (const [id, slot] of this.slots) out[id] = await this.healthOf(id, slot, user)
    return out
  }

  private async healthOf(id: string, slot: Slot, user: string | null): Promise<PluginHealth> {
    const shape = (slot.plugin.configSchema as unknown as { shape?: Record<string, unknown> }).shape
    const keys = shape ? Object.keys(shape) : []
    const deviceCount = this.opts.registry.countOf(id)
    // off in the house: the plugin is not asked for its opinion, it is not running
    if (!this.isEnabled(id)) {
      const status = slot.plugin.implemented === false ? 'not_implemented' : 'disabled'
      return { status, ...(slot.status.detail ? { detail: slot.status.detail } : {}), deviceCount, keys }
    }
    const running = slot.ctx && slot.status.status !== 'error'
    const h = !running ? slot.status
      // an unreadable per-account health does not bring down the inventory: everyone's instead
      : user !== null && slot.plugin.healthFor ? await slot.plugin.healthFor(user).catch(() => slot.plugin.health?.() ?? slot.status)
        : slot.plugin.health?.() ?? slot.status
    return { ...h, deviceCount, keys }
  }

  /** Inventory for the Settings screen: what each plugin is, what was chosen for it, how it is doing (for `user`, cf. `health`). */
  async inventory(user: string | null = null): Promise<PluginInfo[]> {
    return Promise.all(this.order.map(async (id) => {
      const slot = this.slots.get(id)!
      const settings = this.opts.settingsOf(id) ?? DEFAULT_PLUGIN_SETTINGS
      const parts = this.resolveParts(id, slot)
      return {
        id,
        implemented: slot.plugin.implemented !== false,
        enabled: settings.enabled,
        // the light scene setting only makes sense for a vendor that writes them
        ...(slot.plugin.updateScene ? { autoDynamicForNewScenes: settings.autoDynamicForNewScenes } : {}),
        parts: (slot.plugin.parts ?? []).map((p) => ({ id: p.id, labelKey: p.labelKey, enabled: parts[p.id] ?? p.enabledByDefault })),
        health: await this.healthOf(id, slot, user),
      }
    }))
  }

  private async stopOne(id: string): Promise<void> {
    const slot = this.slots.get(id)
    if (!slot) return
    // stopped, turned off or restarted by hand: a scheduled retry no longer has a reason to be
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
