import type { Command, DeviceDescriptor, PluginHealth } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PluginError, type DevicePlugin, type PluginContext, type PluginForecast } from '../../core/plugin'
import { createPoller } from '../../core/poll'
import type { FetchLike } from '../../core/sse'
import { sendError } from '../../http/errors'
import { OpenMeteoClient } from './client'
import { ATTRIBUTION, HOME_ID, toDescriptor, toForecast, toPlaces, toStatePatch, toWeatherState } from './mapping'
import type { AirQualityResponse, ForecastResponse } from './types'
import { VIGILANCE_ATTRIBUTION, VIGILANCE_WEB, VigilanceClient } from './vigilance'

// Open-Meteo plugin: the weather above the house, read from a free API, with no key or account
// (non-commercial use, CC BY 4.0 attribution carried by `meta.weather.attribution`). A single
// `weather` device, at the house's position (`ctx.site`); two calls per poll (forecast, then air
// quality and pollens), every ten minutes — some 300 calls a day out of the 10,000 tolerated,
// nothing to ration. The MeteoAlarm warning feed is re-read at the same pace.
//
// Air quality is OPTIONAL: if its API doesn't answer, the air fields are cleared (`null` patch)
// and the device is redeclared WITHOUT the air capabilities — the view doesn't show an empty
// section; they come back with the first response.
//
// The forecast is not pushed: `forecast()` returns the poll's LAST response, shaped at the time of
// the request — not a new call.

export const openMeteoConfigSchema = z.object({
  /** Polling rate. The models rerun hourly: polling more often re-reads the same thing. */
  OPEN_METEO_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
})
export type OpenMeteoConfig = z.infer<typeof openMeteoConfigSchema>

/** Somewhere other than the house: a valid position, rounded to the hundredth (~1 km) to share the cache. */
const atQuerySchema = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) })
const placesQuerySchema = z.object({ q: z.string().trim().min(2).max(100), lang: z.string().regex(/^[a-z]{2}$/).default('fr') })
/** Places held in cache at once: a house's favorites, with some margin. */
const ELSEWHERE_MAX = 24
/** Routes mounted but plugin never started (disabled, or startup not reached yet). */
const NOT_STARTED = 'open_meteo plugin is not started'

export interface OpenMeteoDeps {
  fetchImpl?: FetchLike
  requestTimeoutMs?: number
}

export function createOpenMeteoPlugin(deps: OpenMeteoDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: OpenMeteoConfig | null = null
  let client: OpenMeteoClient | null = null
  let poller: { stop(): void } | null = null
  let last: { forecast: ForecastResponse; airQuality: AirQualityResponse | null } | null = null
  /** Declared up front: air is part of Open-Meteo; the first reading that contradicts it removes the capabilities. */
  let hasAirQuality = true
  let lastError: string | null = null
  /** Weather elsewhere (Weather view), read on demand and kept for one poll interval: same rule as the house. */
  const elsewhere = new Map<string, { at: number; forecast: ForecastResponse; airQuality: AirQualityResponse | null }>()
  /** Météo-France weather warnings (MeteoAlarm feed), read on the view's request: house or elsewhere. */
  let vigilance: VigilanceClient | null = null

  async function readElsewhere(lat: number, lon: number) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const now = ctx!.clock.now()
    const hit = elsewhere.get(key)
    if (hit && now - hit.at < config!.OPEN_METEO_POLL_MS) return hit
    const c = new OpenMeteoClient({ lat, lon, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.requestTimeoutMs ? { requestTimeoutMs: deps.requestTimeoutMs } : {}) })
    const forecast = await c.forecast(ctx!.signal)
    let airQuality: AirQualityResponse | null = null
    try { airQuality = await c.airQuality(ctx!.signal) }
    catch { /* outside Europe or air API down: the weather is enough */ }
    const entry = { at: now, forecast, airQuality }
    elsewhere.delete(key)
    elsewhere.set(key, entry)
    if (elsewhere.size > ELSEWHERE_MAX) elsewhere.delete(elsewhere.keys().next().value!)
    return entry
  }

  async function poll(): Promise<void> {
    const forecast = await client!.forecast(ctx!.signal)
    let airQuality: AirQualityResponse | null = null
    try { airQuality = await client!.airQuality(ctx!.signal) }
    catch (err) { ctx!.logger.warn({ err }, 'air quality unavailable, weather kept') }
    last = { forecast, airQuality }
    lastError = null
    // capabilities follow what the air API answers: redeclare the device when that changes
    if (!!airQuality !== hasAirQuality) { hasAirQuality = !!airQuality; ctx!.emitDevices([toDescriptor(hasAirQuality)]) }
    const patch = toStatePatch(forecast, airQuality)
    // the house's CURRENT weather warnings, in the state (the rail's alerts read them there). Optional
    // like air: a feed that's down leaves the last value read, outside mainland France we clear it
    try {
      const r = await vigilance!.at(ctx!.site.lat, ctx!.site.lon, ctx!.signal)
      const now = ctx!.clock.now()
      patch.vigilance = r.area ? r.warnings.filter((w) => w.onset <= now && now < w.expires) : null
    } catch (err) { ctx!.logger.warn({ err }, 'vigilance unavailable, weather kept') }
    ctx!.emitState(HOME_ID, patch)
  }

  return {
    id: 'open_meteo',
    configSchema: openMeteoConfigSchema,
    async init(c) {
      ctx = c
      config = c.config as OpenMeteoConfig
      client = new OpenMeteoClient({
        lat: c.site.lat, lon: c.site.lon,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.requestTimeoutMs ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      })
      vigilance = new VigilanceClient({
        ttlMs: config.OPEN_METEO_POLL_MS, now: () => c.clock.now(),
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.requestTimeoutMs ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
      })
    },
    async discover(): Promise<DeviceDescriptor[]> {
      // NO network call here: plugins start one after the other, and a slow API would delay the
      // whole house. The device is born unavailable; the poller's first reading (right away in
      // `start`) fills it.
      return [toDescriptor(hasAirQuality)]
    },
    async start() {
      poller = createPoller({
        name: 'open-meteo', intervalMs: config!.OPEN_METEO_POLL_MS, clock: ctx!.clock, signal: ctx!.signal, logger: ctx!.logger,
        fn: async () => {
          try { await poll() }
          catch (err) { lastError = (err as Error).message; ctx!.setAvailable(HOME_ID, false); throw err }
        },
      })
    },
    async execute(_externalId: string, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `weather accepts no command (${command.type})`)
    },
    async forecast(externalId: string): Promise<PluginForecast> {
      if (externalId !== HOME_ID) throw new PluginError('DEVICE_UNAVAILABLE', `unknown weather device "${externalId}"`)
      if (!last) throw new PluginError('DEVICE_UNAVAILABLE', 'no forecast read yet')
      return toForecast(last.forecast, Math.floor(ctx!.clock.now() / 1000))
    },
    async stop() { poller?.stop(); poller = null },
    registerRoutes(app: FastifyInstance) {
      /** Last raw responses: enough to record a real fixture. */
      app.get('/raw', async (_req, reply) => {
        if (!client?.raw.forecast) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', 'nothing read yet')
        return client.raw
      })
      /** Search for a place by name (Open-Meteo geocoding, no key either). */
      app.get('/places', async (req, reply) => {
        const query = placesQuerySchema.safeParse(req.query)
        if (!query.success) return sendError(reply, 400, 'INVALID_QUERY', 'q (2 to 100 characters) and lang (two letters) expected')
        if (!client || !ctx) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', NOT_STARTED)
        const { q, lang } = query.data
        return { places: toPlaces(await client.places(q, lang, ctx.signal)) }
      })
      /** The weather of another place: full state and forecast, in the format of the house's device. */
      app.get('/at', async (req, reply) => {
        const query = atQuerySchema.safeParse(req.query)
        if (!query.success) return sendError(reply, 400, 'INVALID_QUERY', 'lat (-90 to 90) and lon (-180 to 180) expected')
        if (!ctx) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', NOT_STARTED)
        const { lat, lon } = query.data
        const r = await readElsewhere(lat, lon)
        const now = ctx.clock.now()
        return {
          state: toWeatherState(r.forecast, r.airQuality, now),
          forecast: toForecast(r.forecast, Math.floor(now / 1000)),
          ...(r.forecast.timezone ? { timezone: r.forecast.timezone } : {}),
          attribution: ATTRIBUTION,
        }
      })
      /** Weather warnings for a place's department; `area: null` outside mainland France (nothing to read). */
      app.get('/alerts', async (req, reply) => {
        const query = atQuerySchema.safeParse(req.query)
        if (!query.success) return sendError(reply, 400, 'INVALID_QUERY', 'lat (-90 to 90) and lon (-180 to 180) expected')
        if (!vigilance || !ctx) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', NOT_STARTED)
        const r = await vigilance.at(query.data.lat, query.data.lon, ctx.signal)
        return { ...r, attribution: VIGILANCE_ATTRIBUTION, web: VIGILANCE_WEB }
      })
    },
    health(): PluginHealth {
      const keys = Object.keys(openMeteoConfigSchema.shape)
      if (!last) return { status: 'error', detail: lastError ?? 'no data yet', keys }
      const detail = `${hasAirQuality ? 'weather + air quality' : 'weather only'}, every ${Math.round((config?.OPEN_METEO_POLL_MS ?? 0) / 60_000)} min`
      return lastError ? { status: 'degraded', detail: `${detail} — last poll failed: ${lastError}`, keys } : { status: 'ok', detail, keys }
    },
  }
}
