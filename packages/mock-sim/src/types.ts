import type { Command, DeviceDescriptor, DeviceEnergyDays, DeviceEventKind, DeviceKind, DeviceReleaseNotes, DeviceState, PluginScene, SiteMap, StateFor, WeatherForecast } from '@kasbah/shared'
import type { Rng } from './rng'
import type { World, WorldConfig } from './world'

export type SimErrorCode = 'UNSUPPORTED_COMMAND' | 'DEVICE_UNAVAILABLE' | 'UPSTREAM_ERROR' | 'TIMEOUT' | 'LOW_BATTERY'
export class SimError extends Error {
  constructor(readonly code: SimErrorCode, message: string) {
    super(message)
    this.name = 'SimError'
  }
}

export interface TickCtx {
  /** Simulated time (ms epoch). */
  simTime: number
  /** Simulated time step (s). */
  dtS: number
  /** Acceleration of the simulated time (×1 = real time): whatever must follow the WALL clock uses it. */
  timeScale: number
  /** Fractional local hour [0, 24). */
  hour: number
  /** Local weekday, 0 = Sunday. */
  dow: number
  /** Timezone offset (minutes, Date.getTimezoneOffset convention: positive west of UTC). */
  tzOffsetMin: number
  rng: Rng
  world: World
  /** Current state of another device of the simulation (couplings: charger ↔ vehicle). */
  getState(externalId: string): DeviceState | undefined
  /** Transient event of the device being ticked (doorbell ring): nothing is kept. */
  emitEvent?(event: DeviceEventKind): void
}

export interface SimDevice<K extends DeviceKind = DeviceKind> {
  descriptor: DeviceDescriptor
  /**
   * This simulated device is part of the INSTALLATION of another kind: exclude it with it (see
   * `Simulation.hiddenFor`). A photovoltaic panel is a power sensor, but it
   * belongs to the solar installation; without this link, getting rid of a simulated solar
   * production would force excluding ALL the sensors, real pool meters included.
   */
  partOf?: DeviceKind
  /** Current state, MUTATED by tick/apply; the engine computes the diff and emits the patches. */
  state: StateFor<K>
  tick(ctx: TickCtx): void
  /** Applies a command synchronously; throws SimError if unsupported. */
  apply?(cmd: Command, ctx: TickCtx): void
  /** Forecasts (`weather` device), deduced from the world at the instant of the context. */
  forecast?(ctx: TickCtx): SimForecast
  /** Release notes (vehicle that declares `release_notes`). */
  releaseNotes?(lang?: string): SimReleaseNotes
  /** Map of the terrain (mower that declares `site_map`). */
  siteMap?(): SimSiteMap
  /** Daily energy totals (site that declares `energy_history`), up to the instant of the context. */
  energyDays?(ctx: TickCtx): SimEnergyDays
}

/** Forecasts as the simulation renders them: the server adds the `deviceId`. */
export type SimForecast = Omit<WeatherForecast, 'deviceId'>
/** Release notes as the simulation renders them: the server adds the `deviceId`. */
export type SimReleaseNotes = Omit<DeviceReleaseNotes, 'deviceId'>
/** Map of a terrain as the simulation renders it: the server adds the `deviceId`. */
export type SimSiteMap = Omit<SiteMap, 'deviceId'>
/** Daily energy totals as the simulation renders them: the server adds the `deviceId`. */
export type SimEnergyDays = Omit<DeviceEnergyDays, 'deviceId'>

/** Union of the SimDevices by kind (SimDevice<K> is invariant in K because of the mutable `state`). */
export type AnySimDevice = { [K in DeviceKind]: SimDevice<K> }[DeviceKind]

export interface ChaosConfig {
  /** Every ~N s, a random device becomes unavailable. */
  flipEveryS: number
  flipForS: number
  /** Probability that a command fails with UPSTREAM_ERROR. */
  failRate: number
  /** Probability that a command lingers `latencyMs` before answering. */
  slowRate: number
  latencyMs: number
}

export interface Scenario {
  name: string
  build(rng: Rng): AnySimDevice[]
  chaos?: ChaosConfig
  /** "World" settings (solar peak, season). */
  world?: Partial<WorldConfig>
  /** Light scenes of the simulated vendor (recallable light scenes), like those of a Hue bridge. */
  scenes?: SimScene[]
}

/** Values set on a light by recalling a light scene. */
export interface SimSceneLight { on: boolean; brightness?: number; colorTempMirek?: number; color?: { x: number; y: number } }

/**
 * Simulated light scene: what the bridge would publish (name, group, preview) and what it SETS on its
 * lights. It stays active as long as none of its lights is touched by hand, as with Hue.
 */
export interface SimScene extends Pick<PluginScene, 'externalId' | 'name' | 'group' | 'dynamic' | 'swatches'> {
  lights: Record<string, SimSceneLight>
}
