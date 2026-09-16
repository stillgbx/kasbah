import { fetch as undiciFetch } from 'undici'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { airQualityResponseSchema, forecastResponseSchema, type AirQualityResponse, type ForecastResponse } from './types'

// Client des deux API d'Open-Meteo : prévisions (`api.open-meteo.com`) et qualité de l'air
// (`air-quality-api.open-meteo.com`). Sans clé, sans compte ; le seul paramètre est la position de
// la maison. `timeformat=unixtime` évite de parser des dates locales : tout arrive en secondes epoch.

/** Le défaut d'undici est 300 s : une requête coincée gèlerait le poller sans que `health()` le voie. */
export const REQUEST_TIMEOUT_MS = 15_000

const CURRENT = 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
const HOURLY = 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,is_day,visibility,uv_index,dew_point_2m'
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max'
const AIR = 'european_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen'

export interface OpenMeteoClientOptions {
  lat: number
  lon: number
  fetchImpl?: FetchLike
  requestTimeoutMs?: number
  forecastBase?: string
  airQualityBase?: string
}

export class OpenMeteoClient {
  private readonly fetchImpl: FetchLike
  readonly forecastUrl: string
  readonly airQualityUrl: string
  /** Dernières réponses brutes, pour capturer une fixture (`GET /api/plugins/open_meteo/raw`). */
  raw: { forecast?: unknown; airQuality?: unknown } = {}

  constructor(private readonly opts: OpenMeteoClientOptions) {
    this.fetchImpl = opts.fetchImpl
      ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>)
    const where = `latitude=${opts.lat.toFixed(5)}&longitude=${opts.lon.toFixed(5)}&timezone=auto&timeformat=unixtime`
    this.forecastUrl = `${opts.forecastBase ?? 'https://api.open-meteo.com'}/v1/forecast?${where}&current=${CURRENT}&hourly=${HOURLY}&daily=${DAILY}&forecast_days=8`
    this.airQualityUrl = `${opts.airQualityBase ?? 'https://air-quality-api.open-meteo.com'}/v1/air-quality?${where}&current=${AIR}&domains=cams_europe`
  }

  async forecast(signal: AbortSignal): Promise<ForecastResponse> {
    const json = await this.getJson(this.forecastUrl, signal)
    this.raw.forecast = json
    const parsed = forecastResponseSchema.safeParse(json)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', `unexpected forecast response: ${parsed.error.issues[0]?.message ?? '?'}`)
    return parsed.data
  }

  async airQuality(signal: AbortSignal): Promise<AirQualityResponse> {
    const json = await this.getJson(this.airQualityUrl, signal)
    this.raw.airQuality = json
    const parsed = airQualityResponseSchema.safeParse(json)
    if (!parsed.success) throw new PluginError('UPSTREAM_ERROR', `unexpected air quality response: ${parsed.error.issues[0]?.message ?? '?'}`)
    return parsed.data
  }

  private async getJson(url: string, signal: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)])
    let res: Awaited<ReturnType<FetchLike>>
    try { res = await this.fetchImpl(url, { signal: deadline, headers: { accept: 'application/json' } }) }
    catch (err) {
      if (deadline.aborted && !signal.aborted) throw new PluginError('TIMEOUT', `Open-Meteo did not answer in time`, { cause: err })
      throw new PluginError('UPSTREAM_ERROR', `Open-Meteo unreachable: ${(err as Error).message}`, { cause: err })
    }
    if (res.status === 429) throw new PluginError('RATE_LIMITED', 'Open-Meteo rate limit reached')
    if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Open-Meteo answered ${res.status}`)
    return res.json()
  }
}
