import type { Command, DeviceDescriptor, DeviceKind, DeviceState, StatePatch } from '@kasbah/shared'
import { shallowEqual } from '@kasbah/shared'
import { systemClock, type Clock } from './clock'
import { mulberry32, type Rng } from './rng'
import { resolveScenario, type ScenarioName } from './scenarios'
import { SimError, type AnySimDevice, type Scenario, type SimForecast, type TickCtx } from './types'
import { createWorld, tickWorld, type World } from './world'

export interface SimulationOptions {
  scenario?: ScenarioName | Scenario
  seed?: number
  /** Temps simulé de départ (ms epoch). Défaut : maintenant. */
  startTime?: number
  /** Facteur d'accélération du temps simulé (60 → une journée en 24 min). */
  timeScale?: number
  clock?: Clock
  /** Décalage fuseau (min, convention getTimezoneOffset). Défaut : celui du processus. */
  tzOffsetMin?: number
  /** Période réelle entre deux ticks (ms). */
  tickMs?: number
  /** Pas simulé maximal par sous-étape (s) : un gros saut est subdivisé pour rester précis. */
  maxStepS?: number
}

export type PatchListener = (externalId: string, patch: StatePatch) => void
export type AvailabilityListener = (externalId: string, available: boolean) => void

/**
 * Moteur de simulation déterministe (graine + horloge injectée). Fait avancer les appareils,
 * calcule le diff de leur état et n'émet QUE les champs modifiés. Réutilisé tel quel par le
 * plugin serveur `mock` et par le transport in-process de l'app web.
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
    // état initial cohérent (monde à l'heure de départ)
    this.step(0)
  }

  devices(): DeviceDescriptor[] { return this.devs.map((d) => d.descriptor) }

  /**
   * `externalId` des appareils à masquer quand la simulation ne fait que COMPLÉTER un parc réel
   * (`MOCK_EXCLUDE_KINDS`). Un appareil tombe si son propre kind est exclu, ou si son `partOf`
   * l'est : exclure `energy` emporte ainsi les panneaux simulés, qui sont des capteurs de puissance
   * mais appartiennent à l'installation solaire simulée.
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

  start(onPatch: PatchListener, onAvailability?: AvailabilityListener): void {
    this.onPatch = onPatch
    this.onAvailability = onAvailability ?? null
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

  /** Avance le temps simulé de `dtS` secondes (tests / usage manuel). */
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
  }

  /** Prévisions d'un appareil météo simulé, à l'heure simulée courante. */
  forecast(externalId: string): SimForecast {
    const dev = this.byId.get(externalId)
    if (!dev) throw new SimError('DEVICE_UNAVAILABLE', `unknown mock device "${externalId}"`)
    if (!dev.forecast) throw new SimError('UNSUPPORTED_COMMAND', `${dev.descriptor.kind} has no forecast`)
    return dev.forecast(this.ctx(0))
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => { this.clock.setTimeout(resolve, ms) })
  }

  private ctx(dtS: number): TickCtx {
    const local = this.simNow - this.tzOffsetMin * 60_000
    const hour = (((local / 3_600_000) % 24) + 24) % 24
    const dow = (((Math.floor(local / 86_400_000) + 4) % 7) + 7) % 7
    return {
      simTime: this.simNow, dtS, hour, dow, tzOffsetMin: this.tzOffsetMin, rng: this.rng, world: this.world,
      getState: (id) => this.getState(id),
    }
  }

  private step(dtS: number): void {
    const ctx = this.ctx(dtS)
    tickWorld(this.world, ctx.hour, dtS, this.rng)
    for (const d of this.devs) d.tick(ctx)
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
