import { z } from 'zod'
import { WEATHER_CONDITIONS } from '../devices/kinds'
import { deviceEntrySchema } from './ws'
import { pluginSceneEntrySchema } from '../scenes/scene'
import { automationEntrySchema, automationRunSchema } from '../automations/automation'
import { shoppingListSchema } from '../shopping/shopping'

export const apiErrorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) })
export type ApiError = z.infer<typeof apiErrorSchema>

export const devicesResponseSchema = z.object({ devices: z.array(deviceEntrySchema) })
export type DevicesResponse = z.infer<typeof devicesResponseSchema>

export const scenesResponseSchema = z.object({ scenes: z.array(pluginSceneEntrySchema) })
export type ScenesResponse = z.infer<typeof scenesResponseSchema>

/** `GET /api/automations`. */
export const automationsResponseSchema = z.object({ automations: z.array(automationEntrySchema) })
export type AutomationsResponse = z.infer<typeof automationsResponseSchema>
/** `PUT` and `PATCH /api/automations/:id`: the automation written and its recomputed status. */
export const automationResponseSchema = z.object({ automation: automationEntrySchema })
/** `POST /api/automations/:id/run`: the report, even on partial failure. */
export const automationRunResponseSchema = z.object({ run: automationRunSchema })

/** All the `/api/shopping` routes: the whole list after the operation. */
export const shoppingResponseSchema = z.object({ shopping: shoppingListSchema })

export const PLUGIN_HEALTH_STATUSES = ['ok', 'degraded', 'needs_pairing', 'error', 'not_implemented', 'disabled'] as const
export const pluginHealthSchema = z.object({
  status: z.enum(PLUGIN_HEALTH_STATUSES),
  detail: z.string().optional(),
  deviceCount: z.number().int().optional(),
  /** Names of the environment variables read by the plugin (never their values). */
  keys: z.array(z.string()).optional(),
  /**
   * Consumption of a quota, when the vendor's API is BILLED or bounded and the plugin rations
   * itself (Tesla: the day's reads). `labelKey` is an i18n key of the web app — same
   * convention as `PluginPart.labelKey`, the server does not know the language of the interface.
   * Absent = this plugin counts nothing, and the UI has nothing to show.
   */
  quota: z.object({
    used: z.number().min(0),
    limit: z.number().positive(),
    labelKey: z.string(),
    /** `usd`: `used` and `limit` are DOLLARS, to be formatted as an amount. Absent = a count. */
    unit: z.literal('usd').optional(),
    /** Start of the counted period (ms epoch), when it has one: the UI can date it. */
    since: z.number().optional(),
  }).optional(),
})
export type PluginHealth = z.infer<typeof pluginHealthSchema>

/** Sub-item of a plugin (a kind simulated by `mock`…): what the UI displays and toggles. */
export const pluginPartSchema = z.object({
  id: z.string(),
  /** i18n key of the label (`kinds.light`…): the server does not know the language of the interface. */
  labelKey: z.string(),
  enabled: z.boolean(),
})
export type PluginPartInfo = z.infer<typeof pluginPartSchema>

/** A plugin as the Settings screen sees it: what it is, what was chosen for it, how it is doing. */
export const pluginInfoSchema = z.object({
  id: z.string(),
  /** A skeleton declared but not yet written cannot be activated (switch grayed out). */
  implemented: z.boolean(),
  enabled: z.boolean(),
  /** Only makes sense for a plugin with scenes; absent otherwise. */
  autoDynamicForNewScenes: z.boolean().optional(),
  parts: z.array(pluginPartSchema),
  health: pluginHealthSchema,
})
export type PluginInfo = z.infer<typeof pluginInfoSchema>

export const pluginsResponseSchema = z.object({ plugins: z.array(pluginInfoSchema) })

/**
 * A PROPERTY that the application can show: a house, an apartment. A server launched without a
 * house (`KASBAH_HOUSE_FILE` absent) offers the demonstrations, read-only (`demo`), and the
 * properties created or duplicated on this machine; a real installation only has one, and the list
 * then only counts it — the selector is not displayed.
 */
export const PROPERTY_KINDS = ['house', 'apartment'] as const
export type PropertyKind = (typeof PROPERTY_KINDS)[number]
export const propertySummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(PROPERTY_KINDS),
  /** Demo property: it can be looked at, not modified (it is duplicated). */
  demo: z.boolean().optional(),
})
export type PropertySummary = z.infer<typeof propertySummarySchema>
/** `GET /api/properties`: the properties and the one that is shown. `switchable` = it can be changed. */
export const propertiesResponseSchema = z.object({
  activeId: z.string().min(1),
  switchable: z.boolean(),
  properties: z.array(propertySummarySchema),
  /** The server can create and duplicate a property (`POST /api/properties`, `…/duplicate`). */
  canCreate: z.boolean().optional(),
  /** The mode shown: the demonstrations, or the real properties of the machine. Absent = house imposed. */
  mode: z.enum(['demo', 'real']).optional(),
  /** At least one real property exists: the "real" mode can be chosen. */
  realAvailable: z.boolean().optional(),
})
export type PropertiesResponse = z.infer<typeof propertiesResponseSchema>

const propertyNameSchema = z.string().trim().min(1).max(60)
/** `POST /api/properties`: the house of a new installation (see `newHouseJson`). */
export const newPropertyBodySchema = z.object({
  name: propertyNameSchema,
  kind: z.enum(PROPERTY_KINDS),
  origin: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    heading: z.number().min(-360).max(360),
    alt: z.number().min(-500).max(9000).optional(),
  }),
  terrain: z.object({ width: z.number().min(5).max(2000), depth: z.number().min(5).max(2000) }).optional(),
  levelName: propertyNameSchema,
  roomName: propertyNameSchema,
})
export type NewPropertyBody = z.infer<typeof newPropertyBodySchema>
/** `POST /api/properties/:id/duplicate`: the editable copy of a property, under another name. */
export const duplicatePropertyBodySchema = z.object({ name: propertyNameSchema })
export const propertyCreatedSchema = z.object({ id: z.string().min(1) })
/** The two modes of a server without an imposed house: demonstrations (read-only) or real properties. */
export const PROPERTY_MODES = ['demo', 'real'] as const
export type PropertyMode = (typeof PROPERTY_MODES)[number]
/** `POST /api/properties/mode`: switch to demo or real (the server reopens the property retained for the mode). */
export const propertyModeBodySchema = z.object({ mode: z.enum(PROPERTY_MODES) })
export type PluginsResponse = z.infer<typeof pluginsResponseSchema>

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  uptimeS: z.number(),
  clients: z.number().int(),
  plugins: z.record(z.string(), pluginHealthSchema),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

export const commandResponseSchema = z.object({ ok: z.literal(true) })

/** Hourly history of an energy device (averages per hour, chronological order). */
export const energyHistoryPointSchema = z.object({
  /** Start of the hour (ms epoch). */
  t: z.number(),
  productionW: z.number(),
  consumptionW: z.number(),
  gridW: z.number(),
  samples: z.number().int(),
})
export const energyHistorySchema = z.object({ deviceId: z.string(), points: z.array(energyHistoryPointSchema) })
export type EnergyHistoryPoint = z.infer<typeof energyHistoryPointSchema>
export type EnergyHistory = z.infer<typeof energyHistorySchema>

/**
 * Forecasts of a `weather` device, served ON DEMAND (`GET /api/devices/:id/forecast`) and not
 * pushed: several KB that change at every poll have no business on the WebSocket of a
 * screen that does not have the Weather view open — same trade-off as the energy history. Two
 * granularities, each bounded: hourly for the coming day, daily for the week.
 * Percentages are out of 100, as in the state.
 */
export const weatherHourlyPointSchema = z.object({
  /** Start of the hour (ms epoch). */
  t: z.number(),
  condition: z.enum(WEATHER_CONDITIONS),
  tempC: z.number(),
  precipMm: z.number().min(0),
  precipProbability: z.number().min(0).max(100).optional(),
  windKmh: z.number().min(0),
  isDay: z.boolean(),
})
export const weatherDailyPointSchema = z.object({
  /** Local midnight of the day (ms epoch). */
  t: z.number(),
  condition: z.enum(WEATHER_CONDITIONS),
  minC: z.number(),
  maxC: z.number(),
  precipMm: z.number().min(0),
  precipProbability: z.number().min(0).max(100).optional(),
  uvIndexMax: z.number().min(0).optional(),
  sunrise: z.number().int(),
  sunset: z.number().int(),
})
export const weatherForecastSchema = z.object({
  deviceId: z.string(),
  /** Time of the run or poll these forecasts come from (ms epoch). */
  issuedAt: z.number(),
  hourly: z.array(weatherHourlyPointSchema),
  daily: z.array(weatherDailyPointSchema),
})
export type WeatherHourlyPoint = z.infer<typeof weatherHourlyPointSchema>
export type WeatherDailyPoint = z.infer<typeof weatherDailyPointSchema>
export type WeatherForecast = z.infer<typeof weatherForecastSchema>

/**
 * Log of a device: what it has itself LOGGED — errors, warnings —, dated and sometimes
 * positioned. Served on demand (`GET /api/devices/:id/journal`) by a plugin that declares the
 * `journal` capability, like the forecasts of a weather device: it is a history, not a state.
 * The first robot to publish it is the Husqvarna mower (`GET /mowers/{id}/messages`).
 */
export const JOURNAL_SEVERITIES = ['info', 'warning', 'error', 'fatal'] as const
export type JournalSeverity = (typeof JOURNAL_SEVERITIES)[number]
export const journalEntrySchema = z.object({
  /** When (ms epoch, true instant). */
  at: z.number(),
  severity: z.enum(JOURNAL_SEVERITIES),
  /** Vendor code, when it has one: it is what support asks for. */
  code: z.number().int().optional(),
  /** Vendor text, as it publishes it (not translated). */
  message: z.string().min(1),
  /** Where it happened, when the device knows — a GPS without a fix gives nothing. */
  location: z.object({ lat: z.number(), lon: z.number() }).optional(),
})
export const deviceJournalSchema = z.object({
  deviceId: z.string(),
  /** From the most recent to the oldest. */
  entries: z.array(journalEntrySchema),
})
export type JournalEntry = z.infer<typeof journalEntrySchema>

/**
 * Terrain map of a mower (`site_map` capability), served on demand
 * (`GET /api/devices/:id/map`): it only changes when a zone is redrawn in the vendor's
 * app. LOCAL frame of the robot, in meters: `x` toward the east, `y` toward the north, arbitrary
 * origin — it is only placed on the world by the STATION (`station`), which the view makes
 * coincide with the robot's base. Husqvarna publishes it as SVG (`/maps/generated`, `/maps/zone`).
 */
/**
 * `lawn`: the whole terrain as the robot surveyed it; `work_area`: a DRAWN work zone,
 * whose `name` is that of `workAreas[].name` (Husqvarna does not link it otherwise: its map `id`
 * is a UUID, not the `workAreaId`). `rewilding`: a REWILDING zone (grass grows there),
 * which Husqvarna ONLY publishes on the map — it is not in `stayOutZones`.
 */
export const SITE_MAP_SHAPE_KINDS = ['lawn', 'work_area', 'obstacle', 'stay_out', 'rewilding', 'guide', 'transport', 'station'] as const
export type SiteMapShapeKind = (typeof SITE_MAP_SHAPE_KINDS)[number]
export const siteMapShapeSchema = z.object({
  kind: z.enum(SITE_MAP_SHAPE_KINDS),
  /** Vendor identifier; for an exclusion zone, that of `stayOutZones[].id` when it shares it. */
  id: z.string(),
  name: z.string().optional(),
  /**
   * Exclusion or rewilding zone: activated according to the MAP (absent = activated). The robot's state
   * (`stayOutZones[].enabled`) takes precedence when it knows the zone; it does not know rewilding.
   */
  enabled: z.boolean().optional(),
  /** Polygon (zones, obstacles) or line (cables, paths, station), in meters. */
  points: z.array(z.tuple([z.number(), z.number()])),
})
export const siteMapSchema = z.object({
  deviceId: z.string(),
  /** The station point in this frame; `null` = map without a station, impossible to place. */
  station: z.tuple([z.number(), z.number()]).nullable(),
  shapes: z.array(siteMapShapeSchema),
})
export type SiteMapShape = z.infer<typeof siteMapShapeSchema>
export type SiteMap = z.infer<typeof siteMapSchema>

/**
 * What a device has CONSUMED, per time step — served on demand
 * (`GET /api/devices/:id/consumption`) like the forecasts and the log: it is a history,
 * not a state, and it has no business in the messages pushed at every poll.
 *
 * Three series, because a water meter is read at three scales and none can be deduced from the
 * others: `hourly` says at what hour water is drawn, `daily` covers the week AND the month (the same
 * series serves both views, no need to store it twice), `monthly` gives the twelve months.
 *
 * Each point carries what was consumed DURING its step, never a cumulative total: a chart
 * adds up bars, it does not derive a meter. It is up to the plugin to do this
 * subtraction, because only it knows when its meter started over from zero.
 */
export const consumptionPointSchema = z.object({
  /** Start of the step (ms epoch): full hour, midnight, or first day of the month depending on the series. */
  t: z.number().int(),
  /** Volume consumed during THIS step, in liters. */
  litres: z.number().min(0),
})
export const deviceConsumptionSchema = z.object({
  deviceId: z.string(),
  /** From the oldest to the most recent, one point per hour. A step never measured is absent, not zero. */
  hourly: z.array(consumptionPointSchema),
  /** One point per day. */
  daily: z.array(consumptionPointSchema),
  /** One point per month. */
  monthly: z.array(consumptionPointSchema),
})
export type ConsumptionPoint = z.infer<typeof consumptionPointSchema>
export type DeviceConsumption = z.infer<typeof deviceConsumptionSchema>

/**
 * Daily energy totals of a site (`energy_history` capability), served on demand
 * (`GET /api/devices/:id/energy-days`): what feeds the week, month, year and lifetime views. Each
 * day carries what flowed DURING it, in Wh, never a meter reading. A field the source did not
 * report is absent, not zero.
 *
 * `vendor`: the day comes from the vendor's cloud history; `local`: the server measured it while
 * it ran — exact where the gateway keeps a day counter (production, consumption), integrated from
 * the power readings otherwise. `partial`: a local day the server did not see whole, so its
 * integrated fields fall short.
 */
export const energyDaySchema = z.object({
  /** Local midnight that starts the day (ms epoch). */
  t: z.number().int(),
  source: z.enum(['vendor', 'local']),
  partial: z.boolean().optional(),
  productionWh: z.number().min(0).optional(),
  consumptionWh: z.number().min(0).optional(),
  /** Drawn from the grid, and sent to it. */
  importWh: z.number().min(0).optional(),
  exportWh: z.number().min(0).optional(),
  /** Into the battery, and out of it. */
  chargeWh: z.number().min(0).optional(),
  dischargeWh: z.number().min(0).optional(),
  /** Where the house's consumption came from: the three shares of the flow diagram's ring. */
  solarHomeWh: z.number().min(0).optional(),
  batteryHomeWh: z.number().min(0).optional(),
  gridHomeWh: z.number().min(0).optional(),
  /** What the charger(s) delivered. */
  evseWh: z.number().min(0).optional(),
})
export const deviceEnergyDaysSchema = z.object({
  deviceId: z.string(),
  /** First day of operation as the vendor knows it (local midnight), `null` when never synced. */
  since: z.number().int().nullable(),
  /** Last synchronization with the vendor's history (ms epoch), `null` = never. */
  syncedAt: z.number().int().nullable(),
  /** From the oldest day to today. A day never measured is absent. */
  days: z.array(energyDaySchema),
  /**
   * What each micro-inverter produced, day by day: `wh[i]` is the day `from` + i calendar days
   * (local), `null` = not measured. `lifetimeWh`: the inverter's own counter since commissioning,
   * exact even where the days are missing. Absent when the site has no inverter history.
   */
  inverters: z.object({
    from: z.number().int(),
    /** Last synchronization of the inverters' days with the vendor (ms epoch), `null` = never. */
    syncedAt: z.number().int().nullable(),
    devices: z.array(z.object({
      externalId: z.string(),
      lifetimeWh: z.number().min(0).optional(),
      wh: z.array(z.number().min(0).nullable()),
    })),
  }).optional(),
})
export type EnergyDay = z.infer<typeof energyDaySchema>
export type DeviceEnergyDays = z.infer<typeof deviceEnergyDaysSchema>
export type DeviceJournal = z.infer<typeof deviceJournalSchema>

/**
 * Release notes of a vehicle that declares the `release_notes` capability, served on demand
 * (`GET /api/devices/:id/release-notes`). It is CONTENT, not a state: it changes once per
 * version, the plugin caches it and only re-reads it when a version changes. The text is
 * the vendor's, in ITS language (Tesla answers in English): nothing is translated here.
 */
export const releaseNoteSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  /** Illustration for the dark theme, and its light variant. Signed URLs that EXPIRE: absent once stale. */
  imageUrl: z.string().optional(),
  lightImageUrl: z.string().optional(),
})
export const releaseNotesVersionSchema = z.object({
  version: z.string(),
  notes: z.array(releaseNoteSchema),
})
export const deviceReleaseNotesSchema = z.object({
  deviceId: z.string(),
  /**
   * Language of the SERVED texts (`fr`, `en`): the one requested (`?lang=`) when the vendor publishes it,
   * otherwise English. Absent = unknown (the vendor does not say).
   */
  lang: z.string().optional(),
  /** Installed version, according to the last reading of the notes. */
  installedVersion: z.string().optional(),
  /** The pending update and what it brings; absent = nothing pending, or notes not yet read. */
  pending: releaseNotesVersionSchema.optional(),
  /** Installed versions, from the most recent to the oldest (the plugin keeps them over the updates). */
  history: z.array(releaseNotesVersionSchema),
  /** Last read at the vendor (ms epoch); absent = never read. */
  fetchedAt: z.number().optional(),
})
export type ReleaseNote = z.infer<typeof releaseNoteSchema>
export type ReleaseNotesVersion = z.infer<typeof releaseNotesVersionSchema>
export type DeviceReleaseNotes = z.infer<typeof deviceReleaseNotesSchema>
/** Fallback language of the release notes: the one that all vendors publish. */
export const RELEASE_NOTES_FALLBACK_LANG = 'en'
/** `fr-FR`, `FR`, `fr` → `fr`; anything that is not a two-letter language → the fallback language. */
export function releaseNotesLang(lang: string | undefined): string {
  const l = lang?.trim().slice(0, 2).toLowerCase()
  return l && /^[a-z]{2}$/.test(l) ? l : RELEASE_NOTES_FALLBACK_LANG
}
