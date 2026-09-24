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

// Plugin Open-Meteo : la météo au-dessus de la maison, lue sur une API libre, sans clé ni compte
// (usage non commercial, attribution CC BY 4.0 portée par `meta.weather.attribution`). Un seul
// appareil `weather`, à la position de la maison (`ctx.site`) ; deux appels par sondage (prévisions,
// puis qualité de l'air et pollens), toutes les dix minutes — quelque 300 appels par jour sur les
// 10 000 tolérés, rien à rationner.
//
// La qualité de l'air est FACULTATIVE : si son API ne répond pas, les champs d'air s'effacent
// (patch `null`) et l'appareil est redéclaré SANS les capacités d'air — la vue ne montre pas de
// section vide ; elles reviennent avec la première réponse.
//
// Les prévisions ne sont pas poussées : `forecast()` rend la DERNIÈRE réponse du sondage, mise en
// forme à l'heure de la demande — pas un nouvel appel.

export const openMeteoConfigSchema = z.object({
  /** Cadence de sondage. Les modèles se relancent à l'heure : sonder plus souvent relit la même chose. */
  OPEN_METEO_POLL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(600_000),
})
export type OpenMeteoConfig = z.infer<typeof openMeteoConfigSchema>

/** Ailleurs qu'à la maison : une position valide, arrondie au centième (~1 km) pour partager le cache. */
const atQuerySchema = z.object({ lat: z.coerce.number().min(-90).max(90), lon: z.coerce.number().min(-180).max(180) })
const placesQuerySchema = z.object({ q: z.string().trim().min(2).max(100), lang: z.string().regex(/^[a-z]{2}$/).default('fr') })
/** Lieux tenus en cache à la fois : les favoris d'une maison, avec de la marge. */
const ELSEWHERE_MAX = 24

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
  /** Déclaré d'emblée : l'air fait partie d'Open-Meteo ; la première lecture qui le dément retire les capacités. */
  let hasAirQuality = true
  let lastError: string | null = null
  /** Météo ailleurs (vue Météo), lue à la demande et gardée le temps d'un sondage : même règle que la maison. */
  const elsewhere = new Map<string, { at: number; forecast: ForecastResponse; airQuality: AirQualityResponse | null }>()

  async function readElsewhere(lat: number, lon: number) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
    const now = ctx!.clock.now()
    const hit = elsewhere.get(key)
    if (hit && now - hit.at < config!.OPEN_METEO_POLL_MS) return hit
    const c = new OpenMeteoClient({ lat, lon, ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}), ...(deps.requestTimeoutMs ? { requestTimeoutMs: deps.requestTimeoutMs } : {}) })
    const forecast = await c.forecast(ctx!.signal)
    let airQuality: AirQualityResponse | null = null
    try { airQuality = await c.airQuality(ctx!.signal) }
    catch { /* hors d'Europe ou API d'air tombée : la météo suffit */ }
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
    // les capacités suivent ce que l'API d'air répond : redéclarer l'appareil quand ça change
    if (!!airQuality !== hasAirQuality) { hasAirQuality = !!airQuality; ctx!.emitDevices([toDescriptor(hasAirQuality)]) }
    ctx!.emitState(HOME_ID, toStatePatch(forecast, airQuality))
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
    },
    async discover(): Promise<DeviceDescriptor[]> {
      // AUCUN appel réseau ici : les plugins démarrent l'un après l'autre, et une API lente
      // retarderait toute la maison. L'appareil naît indisponible ; la première lecture du poller
      // (tout de suite dans `start`) le remplit.
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
      /** Dernières réponses brutes : de quoi relever une fixture réelle. */
      app.get('/raw', async (_req, reply) => {
        if (!client?.raw.forecast) return sendError(reply, 409, 'DEVICE_UNAVAILABLE', 'nothing read yet')
        return client.raw
      })
      /** Recherche d'un lieu par son nom (géocodage Open-Meteo, sans clé lui non plus). */
      app.get('/places', async (req, reply) => {
        const query = placesQuerySchema.safeParse(req.query)
        if (!query.success) return sendError(reply, 400, 'INVALID_QUERY', 'q (2 to 100 characters) and lang (two letters) expected')
        const { q, lang } = query.data
        return { places: toPlaces(await client!.places(q, lang, ctx!.signal)) }
      })
      /** La météo d'un autre lieu : état complet et prévisions, au format de l'appareil de la maison. */
      app.get('/at', async (req, reply) => {
        const query = atQuerySchema.safeParse(req.query)
        if (!query.success) return sendError(reply, 400, 'INVALID_QUERY', 'lat (-90 to 90) and lon (-180 to 180) expected')
        const { lat, lon } = query.data
        const r = await readElsewhere(lat, lon)
        const now = ctx!.clock.now()
        return {
          state: toWeatherState(r.forecast, r.airQuality, now),
          forecast: toForecast(r.forecast, Math.floor(now / 1000)),
          ...(r.forecast.timezone ? { timezone: r.forecast.timezone } : {}),
          attribution: ATTRIBUTION,
        }
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
