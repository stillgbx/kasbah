import type { Command, DeviceDescriptor, DeviceEventKind, DeviceKind, DeviceState, SceneActivation, SceneRecallMode, StatePatch } from '@kasbah/shared'
import { shallowEqual } from '@kasbah/shared'
import { systemClock, type Clock } from './clock'
import { mulberry32, type Rng } from './rng'
import { resolveScenario, type ScenarioName } from './scenarios'
import { SimError, type AnySimDevice, type Scenario, type SimEnergyDays, type SimForecast, type SimReleaseNotes, type SimScene, type SimSiteMap, type TickCtx } from './types'
import { createWorld, tickWorld, type World } from './world'

export interface SimulationOptions {
  scenario?: ScenarioName | Scenario
  seed?: number
  /** Starting simulated time (ms epoch). Default: now. */
  startTime?: number
  /** Acceleration factor of the simulated time (60 → a day in 24 min). */
  timeScale?: number
  clock?: Clock
  /** Timezone offset (min, getTimezoneOffset convention). Default: that of the process. */
  tzOffsetMin?: number
  /** Real period between two ticks (ms). */
  tickMs?: number
  /** Maximum simulated step per sub-step (s): a big jump is subdivided to stay accurate. */
  maxStepS?: number
}

export type PatchListener = (externalId: string, patch: StatePatch) => void
export type AvailabilityListener = (externalId: string, available: boolean) => void
export type EventListener = (externalId: string, event: DeviceEventKind) => void
export type SceneListener = (sceneExternalId: string, active: SceneActivation) => void
/** Light scene as the simulation publishes it: without the values it sets on its lights. */
export type SimSceneInfo = Omit<SimScene, 'lights'>

/**
 * Deterministic simulation engine (seed + injected clock). Advances the devices,
 * computes the diff of their state and emits ONLY the modified fields. Reused as is by the
 * server plugin `mock` and by the in-process transport of the web app.
 */
export class Simulation {
  readonly scenario: Scenario
  private readonly devs: AnySimDevice[]
  private readonly byId = new Map<string, AnySimDevice>()
  private readonly lastEmitted = new Map<string, Record<string, unknown>>()
  private readonly world: World
  private readonly rng: Rng
  private readonly clock: Clock
  private readonly timeScale: number
  private readonly tzOffsetMin: number
  private readonly tickMs: number
  private readonly maxStepS: number
  private readonly simStart: number
  private realStart = 0
  private simNow: number
  private timer: unknown = null
  private onPatch: PatchListener | null = null
  private onAvailability: AvailabilityListener | null = null
  private onEvent: EventListener | null = null
  private onScene: SceneListener | null = null
  private readonly sceneActive = new Map<string, SceneActivation>()
  private readonly unavailableUntil = new Map<string, number>()
  private nextChaosAt = Infinity

  constructor(opts: SimulationOptions = {}) {
    this.scenario = resolveScenario(opts.scenario ?? 'default')
    this.clock = opts.clock ?? systemClock
    this.rng = mulberry32(opts.seed ?? 42)
    this.timeScale = opts.timeScale ?? 1
    this.tzOffsetMin = opts.tzOffsetMin ?? new Date().getTimezoneOffset()
    this.tickMs = opts.tickMs ?? 1000
    this.maxStepS = opts.maxStepS ?? 60
    this.simStart = opts.startTime ?? this.clock.now()
    this.simNow = this.simStart
    this.world = createWorld(this.scenario.world)
    this.devs = this.scenario.build(this.rng)
    for (const d of this.devs) {
      this.byId.set(d.descriptor.externalId, d)
      this.lastEmitted.set(d.descriptor.externalId, snapshot(d.state))
    }
    if (this.scenario.chaos) this.nextChaosAt = this.simNow + this.scenario.chaos.flipEveryS * 1000
    // consistent initial state (world at the starting hour)
    this.step(0)
  }

  devices(): DeviceDescriptor[] { return this.devs.map((d) => d.descriptor) }

  /**
   * `externalId` of the devices to hide when the simulation only COMPLETES a real device set
   * (sub-items of the `mock` plugin unchecked in Settings → Plugins). A device drops out if its own
   * kind is excluded, or if its `partOf` is: excluding `energy` thus takes away the simulated panels,
   * which are power sensors but belong to the simulated solar installation.
   */
  hiddenFor(excluded: Iterable<DeviceKind>): Set<string> {
    const kinds = new Set(excluded)
    const out = new Set<string>()
    for (const d of this.devs) {
      if (kinds.has(d.descriptor.kind) || (d.partOf && kinds.has(d.partOf))) out.add(d.descriptor.externalId)
    }
    return out
  }

  simTime(): number { return this.simNow }

  getState(externalId: string): DeviceState | undefined {
    const d = this.byId.get(externalId)
    if (!d) return undefined
    return { ...d.state, available: this.isAvailable(externalId) } as DeviceState
  }

  states(): Map<string, DeviceState> {
    const m = new Map<string, DeviceState>()
    for (const d of this.devs) m.set(d.descriptor.externalId, this.getState(d.descriptor.externalId)!)
    return m
  }

  isAvailable(externalId: string): boolean {
    const until = this.unavailableUntil.get(externalId)
    return until === undefined || until <= this.simNow
  }

  start(onPatch: PatchListener, onAvailability?: AvailabilityListener, onEvent?: EventListener, onScene?: SceneListener): void {
    this.onPatch = onPatch
    this.onAvailability = onAvailability ?? null
    this.onEvent = onEvent ?? null
    this.onScene = onScene ?? null
    this.realStart = this.clock.now()
    const simAtStart = this.simNow
    this.timer = this.clock.setInterval(() => {
      const target = simAtStart + (this.clock.now() - this.realStart) * this.timeScale
      this.advanceTo(target)
    }, this.tickMs)
  }

  stop(): void {
    if (this.timer !== null) this.clock.clearInterval(this.timer)
    this.timer = null
  }

  /** Advances the simulated time by `dtS` seconds (tests / manual use). */
  tick(dtS: number): void { this.advanceTo(this.simNow + dtS * 1000) }

  advanceTo(simTime: number): void {
    while (this.simNow < simTime - 1e-6) {
      const dtS = Math.min(this.maxStepS, (simTime - this.simNow) / 1000)
      this.simNow += dtS * 1000
      this.step(dtS)
    }
  }

  async execute(externalId: string, cmd: Command): Promise<void> {
    const dev = this.byId.get(externalId)
    if (!dev) throw new SimError('DEVICE_UNAVAILABLE', `unknown mock device "${externalId}"`)
    if (!this.isAvailable(externalId)) throw new SimError('DEVICE_UNAVAILABLE', `mock device "${externalId}" is offline`)
    const chaos = this.scenario.chaos
    if (chaos && this.rng() < chaos.slowRate) await this.delay(chaos.latencyMs)
    if (chaos && this.rng() < chaos.failRate) throw new SimError('UPSTREAM_ERROR', 'simulated upstream failure')
    const apply = dev.apply as ((c: Command, x: TickCtx) => void) | undefined
    if (!apply) throw new SimError('UNSUPPORTED_COMMAND', `${dev.descriptor.kind} accepts no command`)
    apply(cmd, this.ctx(0))
    this.emitDiff(dev)
    // a light set by hand leaves the light scene that had set it, as with Hue
    if (dev.descriptor.kind === 'light') this.leaveScenes(externalId)
  }

  /** Light scenes of the scenario, without the values they set. */
  scenes(): SimSceneInfo[] {
    return (this.scenario.scenes ?? []).map(({ lights: _l, ...info }) => info)
  }

  sceneState(externalId: string): SceneActivation {
    return this.sceneActive.get(externalId) ?? 'inactive'
  }

  /**
   * Recall of a light scene: sets its values on its lights (dimmed by `brightness`), or turns them
   * off (`off`). The other light scenes of the same group fade away: a room has only one at a time.
   */
  async recallScene(externalId: string, recall: { mode: SceneRecallMode; brightness?: number }): Promise<void> {
    const scene = (this.scenario.scenes ?? []).find((s) => s.externalId === externalId)
    if (!scene) throw new SimError('DEVICE_UNAVAILABLE', `unknown mock scene "${externalId}"`)
    if (recall.mode === 'dynamic' && !scene.dynamic) throw new SimError('UNSUPPORTED_COMMAND', `scene "${externalId}" has no animated palette`)
    const scale = recall.brightness === undefined ? 1 : recall.brightness / 100
    for (const [lightId, v] of Object.entries(scene.lights)) {
      const dev = this.byId.get(lightId)
      if (!dev?.apply || !this.isAvailable(lightId)) continue
      const on = recall.mode !== 'off' && v.on
      const cmd: Command = on
        ? { type: 'light.set', on: true, ...(v.brightness !== undefined ? { brightness: Math.max(1, Math.round(v.brightness * scale)) } : {}),
            ...(v.colorTempMirek !== undefined ? { colorTempMirek: v.colorTempMirek } : {}), ...(v.color ? { color: v.color } : {}) }
        : { type: 'light.set', on: false }
      ;(dev.apply as (c: Command, x: TickCtx) => void)(cmd, this.ctx(0))
      this.emitDiff(dev)
    }
    for (const other of this.scenario.scenes ?? []) {
      const sameGroup = other.group?.name === scene.group?.name
      if (other.externalId !== externalId && sameGroup) this.setScene(other.externalId, 'inactive')
    }
    this.setScene(externalId, recall.mode === 'off' ? 'inactive' : recall.mode)
  }

  private leaveScenes(lightId: string): void {
    for (const s of this.scenario.scenes ?? []) if (lightId in s.lights) this.setScene(s.externalId, 'inactive')
  }

  private setScene(externalId: string, active: SceneActivation): void {
    if (this.sceneState(externalId) === active) return
    this.sceneActive.set(externalId, active)
    this.onScene?.(externalId, active)
  }

  /** Forecasts of a simulated weather device, at the current simulated hour. */
  forecast(externalId: string): SimForecast {
    const dev = this.byId.get(externalId)
    if (!dev) throw new SimError('DEVICE_UNAVAILABLE', `unknown mock device "${externalId}"`)
    if (!dev.forecast) throw new SimError('UNSUPPORTED_COMMAND', `${dev.descriptor.kind} has no forecast`)
    return dev.forecast(this.ctx(0))
  }

  /** Release notes of a simulated vehicle. */
  releaseNotes(externalId: string, lang?: string): SimReleaseNotes {
    const dev = this.byId.get(externalId)
    if (!dev) throw new SimError('DEVICE_UNAVAILABLE', `unknown mock device "${externalId}"`)
    if (!dev.releaseNotes) throw new SimError('UNSUPPORTED_COMMAND', `${dev.descriptor.kind} has no release notes`)
    return dev.releaseNotes(lang)
  }

  /** Terrain map of a simulated mower. */
  siteMap(externalId: string): SimSiteMap {
    const dev = this.byId.get(externalId)
    if (!dev) throw new SimError('DEVICE_UNAVAILABLE', `unknown mock device "${externalId}"`)
    if (!dev.siteMap) throw new SimError('UNSUPPORTED_COMMAND', `${dev.descriptor.kind} has no site map`)
    return dev.siteMap()
  }

  /** Daily energy totals of a simulated site, up to the current simulated instant. */
  energyDays(externalId: string): SimEnergyDays {
    const dev = this.byId.get(externalId)
    if (!dev) throw new SimError('DEVICE_UNAVAILABLE', `unknown mock device "${externalId}"`)
    if (!dev.energyDays) throw new SimError('UNSUPPORTED_COMMAND', `${dev.descriptor.kind} has no energy history`)
    const site = dev.energyDays(this.ctx(0))
    // the simulated panels share the site's production, each with its own yield (orientation,
    // shade), steady from one day to the next — like a real array where one module lags behind
    const panels = this.devs.filter((d) => d.partOf === 'energy' && d.descriptor.kind === 'sensor')
    if (!panels.length || !site.days.length) return site
    const weight = panels.map((_, i) => 0.85 + 0.2 * ((Math.sin(i * 7.31) + 1) / 2))
    const total = weight.reduce((a, b) => a + b, 0)
    const devices = panels.map((p, i) => {
      const wh = site.days.map((d) => (d.productionWh === undefined ? null : Math.round((d.productionWh * weight[i]!) / total)))
      return { externalId: p.descriptor.externalId, lifetimeWh: wh.reduce<number>((a, v) => a + (v ?? 0), 0), wh }
    })
    return { ...site, inverters: { from: site.days[0]!.t, syncedAt: site.syncedAt, devices } }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => { this.clock.setTimeout(resolve, ms) })
  }

  private ctx(dtS: number): TickCtx {
    const local = this.simNow - this.tzOffsetMin * 60_000
    const hour = (((local / 3_600_000) % 24) + 24) % 24
    const dow = (((Math.floor(local / 86_400_000) + 4) % 7) + 7) % 7
    return {
      simTime: this.simNow, dtS, timeScale: this.timeScale, hour, dow, tzOffsetMin: this.tzOffsetMin, rng: this.rng, world: this.world,
      getState: (id) => this.getState(id),
    }
  }

  private step(dtS: number): void {
    const ctx = this.ctx(dtS)
    tickWorld(this.world, ctx.hour, dtS, this.rng)
    for (const d of this.devs) {
      const id = d.descriptor.externalId
      ctx.emitEvent = (event) => this.onEvent?.(id, event)
      d.tick(ctx)
    }
    delete ctx.emitEvent
    this.runChaos()
    for (const d of this.devs) this.emitDiff(d)
  }

  private runChaos(): void {
    const chaos = this.scenario.chaos
    if (!chaos || this.devs.length === 0) return
    for (const [id, until] of this.unavailableUntil) {
      if (until <= this.simNow) { this.unavailableUntil.delete(id); this.onAvailability?.(id, true) }
    }
    if (this.simNow >= this.nextChaosAt) {
      const victim = this.devs[Math.floor(this.rng() * this.devs.length)]!
      this.unavailableUntil.set(victim.descriptor.externalId, this.simNow + chaos.flipForS * 1000)
      this.onAvailability?.(victim.descriptor.externalId, false)
      this.nextChaosAt = this.simNow + chaos.flipEveryS * 1000 * (0.5 + this.rng())
    }
  }

  private emitDiff(dev: AnySimDevice): void {
    const id = dev.descriptor.externalId
    const prev = this.lastEmitted.get(id) ?? {}
    const cur = dev.state as unknown as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    let changed = false
    for (const [k, v] of Object.entries(cur)) {
      if (k === 'kind' || k === 'updatedAt' || k === 'available') continue
      if (!shallowEqual(prev[k], v)) { patch[k] = clone(v); changed = true }
    }
    // a field REMOVED from the state (`delete s.x`) is cleared on the client: `null` = "clear this field"
    // in a patch. Without this, the end of an installation or of a charge stayed displayed
    for (const k of Object.keys(prev)) {
      if (!(k in cur)) { patch[k] = null; changed = true }
    }
    if (!changed) return
    this.lastEmitted.set(id, snapshot(dev.state))
    this.onPatch?.(id, patch as StatePatch)
  }
}

function clone<T>(v: T): T {
  return (typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v) as T
}
function snapshot(state: DeviceState): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>
}
