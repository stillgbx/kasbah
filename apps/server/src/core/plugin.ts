import type { Command, DeviceConsumption, DeviceDescriptor, DeviceEnergyDays, DeviceEventKind, DeviceJournal, DeviceReleaseNotes, PluginHealth, PluginScene, SceneActivation, SceneRecall, SceneUpdate, SiteMap, StatePatch, WeatherForecast } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { Clock } from './clock'

// Contract of a device plugin. A plugin knows neither HTTP nor WebSocket: it discovers descriptors,
// pushes state patches through the context and executes commands.

export const PLUGIN_ERROR_CODES = [
  'DEVICE_UNAVAILABLE', 'UNSUPPORTED_COMMAND', 'UPSTREAM_ERROR', 'RATE_LIMITED', 'NEEDS_PAIRING', 'TIMEOUT', 'NOT_IMPLEMENTED',
  // battery too low for what the command asks (Tesla `low_soc`: no climate below 20 %)
  'LOW_BATTERY',
] as const
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number]

export class PluginError extends Error {
  constructor(readonly code: PluginErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'PluginError'
  }
}

export interface PluginContext {
  pluginId: string
  /** Output of `configSchema.parse(process.env)`. */
  config: Record<string, unknown>
  logger: Logger
  clock: Clock
  /** Aborted by stop(): to pass to fetches/pollers. */
  signal: AbortSignal
  /** State patch; `available: true` is added implicitly unless stated otherwise. */
  emitState(externalId: string, patch: StatePatch): void
  setAvailable(externalId: string | '*', available: boolean): void
  /** Replaces the plugin's whole set of devices (late discovery, addition/removal). */
  emitDevices(descriptors: DeviceDescriptor[]): void
  /** Replaces the plugin's whole set of scenes. */
  emitScenes(scenes: PluginScene[]): void
  emitSceneState(externalId: string, active: SceneActivation): void
  /** Transient event (doorbell, motion): pushed to clients, no state kept. */
  emitEvent(externalId: string, event: DeviceEventKind): void
  /** Sub-items kept for this house, by `DevicePlugin.parts` id (defaults already applied). */
  parts: Record<string, boolean>
  /**
   * Where the house IS (`house.origin`), for what depends on location: the weather above the roof. A
   * plugin never fetches the house itself, as for `parts` — the host gives it the single source of
   * truth, the one the 3D scene already takes its sun from.
   */
  site: PluginSite
  /**
   * Ids of the plugins turned on in the house, re-read at each call: a bridge to another hub (Home
   * Assistant) leaves out what a native plugin already provides. Optional: test contexts omit it.
   */
  enabledPlugins?: () => readonly string[]
}

export interface PluginSite {
  lat: number
  lon: number
  /** Altitude (m), 0 if the house does not state it. */
  alt: number
}

/** Forecasts as a plugin returns them: the host adds the `deviceId` (see `weatherForecastSchema`). */
export type PluginForecast = Omit<WeatherForecast, 'deviceId'>
/** Log as a plugin returns it: the host adds the `deviceId` (see `deviceJournalSchema`). */
export type PluginJournal = Omit<DeviceJournal, 'deviceId'>
/** Map of a plot as a plugin returns it: the host adds the `deviceId` (see `siteMapSchema`). */
export type PluginSiteMap = Omit<SiteMap, 'deviceId'>
/** Release notes as a plugin returns them: the host adds the `deviceId` (see `deviceReleaseNotesSchema`). */
export type PluginReleaseNotes = Omit<DeviceReleaseNotes, 'deviceId'>
/** Consumption as a plugin returns it: the host adds the `deviceId` (see `deviceConsumptionSchema`). */
export type PluginConsumption = Omit<DeviceConsumption, 'deviceId'>
/** Daily energy totals as a plugin returns them: the host adds the `deviceId` (see `deviceEnergyDaysSchema`). */
export type PluginEnergyDays = Omit<DeviceEnergyDays, 'deviceId'>

/**
 * Toggleable sub-item of a plugin: a part of what it provides, which one may want or not without
 * giving up the rest (the simulation's kinds). Declared STATICALLY, without config or init:
 * Settings shows them even when the plugin is off. The choice lives in `house.json`.
 */
export interface PluginPart {
  /** Stable id, written in `house.json` (`plugins.<id>.parts`). */
  readonly id: string
  /** i18n key of the label on the web side (`kinds.light`…): the server does not know the language. */
  readonly labelKey: string
  readonly enabledByDefault: boolean
}

export interface DevicePlugin {
  readonly id: string
  /** Selects and validates its own environment keys (e.g. HUE_*). */
  readonly configSchema: z.ZodType<Record<string, unknown>>
  /** Skeleton declared but not yet written: listed in Settings, cannot be enabled. */
  readonly implemented?: boolean
  /** Toggleable sub-items (see `PluginPart`); none for most plugins. */
  readonly parts?: readonly PluginPart[]
  init(ctx: PluginContext): Promise<void>
  discover(): Promise<DeviceDescriptor[]>
  start(): Promise<void>
  /** Resolves on the vendor's acknowledgment; throws PluginError otherwise. */
  execute(externalId: string, command: Command): Promise<void>
  /** Recalls a vendor scene (scenes are published through `ctx.emitScenes`). */
  recallScene?(externalId: string, recall: SceneRecall): Promise<void>
  /** Writes a scene preference at the vendor (the new value comes back through its events). */
  updateScene?(externalId: string, update: SceneUpdate): Promise<void>
  /** Creates a light scene for a group, by copying an existing light scene (source `externalId`). */
  createScene?(fromExternalId: string, groupName: string): Promise<void>
  /** Deletes a light scene AT the vendor (destructive action, confirmed on the UI side). */
  deleteScene?(externalId: string): Promise<void>
  /**
   * Forecasts of a `weather` device, served ON DEMAND (`GET /api/devices/:id/forecast`) and never
   * pushed — same trade-off as the energy history. Absent = this plugin has none (the host answers
   * `NOT_IMPLEMENTED`). Return the last poll response, don't make a new call.
   */
  forecast?(externalId: string): Promise<PluginForecast>
  /**
   * Log of a device that declares the `journal` capability, served ON DEMAND
   * (`GET /api/devices/:id/journal`). Same rule as forecasts: return what you hold — a cached
   * reading, completed by the vendor's events —, don't make a new call on every display, especially
   * on a quota-limited API.
   */
  journal?(externalId: string): Promise<PluginJournal>
  /**
   * Map of the plot of a device that declares the `site_map` capability, served ON DEMAND
   * (`GET /api/devices/:id/map`). Return the cached map: it only changes when the layout is redrawn
   * at the vendor, and each reading costs quota.
   */
  siteMap?(externalId: string): Promise<PluginSiteMap>
  /**
   * What a device has consumed, per time step, served ON DEMAND
   * (`GET /api/devices/:id/consumption`). Same rule as forecasts and the log: return a history kept
   * up over the polls, never take a new reading. Absent = this plugin keeps none (the host answers
   * `NOT_IMPLEMENTED`).
   */
  consumption?(externalId: string): Promise<PluginConsumption>
  /**
   * Daily energy totals of a site that declares the `energy_history` capability, served ON DEMAND
   * (`GET /api/devices/:id/energy-days`). Same rule as the consumption: return the history kept up
   * over the polls, never take a new reading.
   */
  energyDays?(externalId: string): Promise<PluginEnergyDays>
  /**
   * Release notes of a vehicle that declares the `release_notes` capability, served ON DEMAND
   * (`GET /api/devices/:id/release-notes`). Return the cache held by the plugin, never make a new
   * call: the notes only change with a version. `lang`: the wanted language (two letters); the
   * plugin returns English as long as it doesn't have it, and says in `lang` what it serves.
   */
  releaseNotes?(externalId: string, lang: string): Promise<PluginReleaseNotes>
  stop(): Promise<void>
  /** Another plugin was turned on or off (see `PluginContext.enabledPlugins`); called on running plugins only. */
  onPluginsChanged?(): void
  /** The plugin's own routes, mounted under /api/plugins/<id>/. */
  registerRoutes?(app: FastifyInstance): void
  health?(): PluginHealth
  /**
   * The health of a signed-in user's accounts, for a plugin that keeps some per user (music
   * sources); absent = the same for everyone, `health()`.
   */
  healthFor?(user: string): Promise<PluginHealth>
}

export type PluginFactory = () => DevicePlugin
