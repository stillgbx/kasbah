import {
  aqiLevelOf, POLLEN_TYPES, type DeviceDescriptor, type PollenType, type StatePatch, type WeatherCondition, type WeatherDailyPoint,
  type WeatherHourlyPoint,
} from '@kasbah/shared'
import type { PluginForecast } from '../../core/plugin'
import type { AirQualityResponse, ForecastResponse } from './types'

// Mappage PUR des réponses d'Open-Meteo vers le contrat `weather`. Écrit d'après des réponses
// capturées (`__fixtures__/open-meteo.ts`), pas d'après la documentation.

export const PLUGIN_ID = 'open_meteo'
export const HOME_ID = 'home'
export const ATTRIBUTION = 'Open-Meteo.com (CC BY 4.0)'

/**
 * Codes WMO 4677 tels qu'Open-Meteo les émet → la condition du contrat. Les averses (80-82, 85-86)
 * rejoignent pluie et neige ; le verglaçant (56-57, 66-67) devient `sleet`, faute de mieux dans neuf
 * mots ; 1 (« principalement dégagé ») est un ciel dégagé.
 */
export function wmoToCondition(code: number | null | undefined): WeatherCondition {
  if (code === null || code === undefined) return 'cloudy'
  if (code <= 1) return 'clear'
  if (code === 2) return 'partly_cloudy'
  if (code === 3) return 'cloudy'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 55) return 'drizzle'
  if (code === 56 || code === 57 || code === 66 || code === 67) return 'sleet'
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rain'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'thunderstorm'
  return 'cloudy'
}

/**
 * Grains/m³ → niveau 0-4. Les seuils sont GROSSIERS et communs à tous les pollens : les échelles
 * officielles varient par espèce (le bouleau gêne dès 10, les graminées vers 50) et Open-Meteo ne
 * fournit que la concentration. Assez pour dire « faible / élevé », pas pour un bulletin allergique.
 */
export function pollenLevel(grains: number | null | undefined): number | undefined {
  if (grains === null || grains === undefined) return undefined
  if (grains <= 0) return 0
  if (grains < 10) return 1
  if (grains < 50) return 2
  if (grains < 150) return 3
  return 4
}

export function toDescriptor(hasAirQuality: boolean): DeviceDescriptor {
  return {
    id: `${PLUGIN_ID}:${HOME_ID}`, pluginId: PLUGIN_ID, externalId: HOME_ID, kind: 'weather', name: 'Météo',
    capabilities: hasAirQuality ? ['forecast', 'air_quality', 'pollen'] : ['forecast'],
    meta: { manufacturer: 'Open-Meteo', weather: { attribution: ATTRIBUTION, model: 'Open-Meteo best match' } },
  }
}

const num = (v: number | null | undefined): number | undefined => (v === null || v === undefined ? undefined : v)
const at = (col: (number | null)[] | undefined, i: number): number | undefined => (i < 0 ? undefined : num(col?.[i]))

/** Indice du pas horaire qui contient `timeS`, ou −1 (les séries sont alignées sur l'heure pleine). */
export function hourIndex(times: readonly number[], timeS: number): number {
  const hourStart = Math.floor(timeS / 3600) * 3600
  return times.indexOf(hourStart)
}

/** Indice du jour (minuit local) qui contient `timeS`, ou −1. */
export function dayIndex(times: readonly number[], timeS: number): number {
  for (let i = times.length - 1; i >= 0; i--) if (times[i]! <= timeS) return i
  return -1
}

/**
 * L'actuel : le bloc `current`, complété par le pas horaire courant pour ce que `current` ne porte pas
 * (visibilité, UV, point de rosée, probabilité de pluie) et par le jour courant pour le soleil.
 */
export function toStatePatch(f: ForecastResponse, aq: AirQualityResponse | null): StatePatch<'weather'> {
  const c = f.current
  const h = hourIndex(f.hourly.time, c.time)
  const d = dayIndex(f.daily.time, c.time)
  const patch: StatePatch<'weather'> = {
    condition: wmoToCondition(c.weather_code),
    tempC: c.temperature_2m ?? 0,
    humidity: c.relative_humidity_2m ?? 0,
    windKmh: c.wind_speed_10m ?? 0,
    windDirDeg: c.wind_direction_10m ?? 0,
    cloudCover: c.cloud_cover ?? 0,
    isDay: (c.is_day ?? 1) === 1,
    sunrise: Math.round((at(f.daily.sunrise, d) ?? 0) * 1000),
    sunset: Math.round((at(f.daily.sunset, d) ?? 0) * 1000),
    observedAt: c.time * 1000,
  }
  // `null` = « efface » côté patch : une valeur que ce sondage n'a pas ne doit pas survivre du précédent
  patch.feelsLikeC = num(c.apparent_temperature) ?? null
  patch.pressureHpa = num(c.pressure_msl) ?? null
  patch.windGustKmh = num(c.wind_gusts_10m) ?? null
  patch.precipMm = num(c.precipitation) ?? null
  patch.precipProbability = at(f.hourly.precipitation_probability, h) ?? null
  patch.visibilityM = at(f.hourly.visibility, h) ?? null
  patch.uvIndex = at(f.hourly.uv_index, h) ?? null
  patch.dewPointC = at(f.hourly.dew_point_2m, h) ?? null
  const aqi = num(aq?.current.european_aqi)
  patch.aqi = aqi ?? null
  patch.aqiLevel = aqi === undefined ? null : aqiLevelOf(aqi)
  patch.pollen = aq ? toPollen(aq) : null
  return patch
}

function toPollen(aq: AirQualityResponse): Partial<Record<PollenType, number>> {
  const out: Partial<Record<PollenType, number>> = {}
  for (const type of POLLEN_TYPES) {
    const level = pollenLevel(aq.current[`${type}_pollen`])
    if (level !== undefined) out[type] = level
  }
  return out
}

/** Les 24 prochains pas horaires à partir de l'heure courante, et 7 jours à partir d'aujourd'hui. */
export function toForecast(f: ForecastResponse, nowS: number): PluginForecast {
  const h0 = Math.max(0, hourIndex(f.hourly.time, nowS))
  const hourly: WeatherHourlyPoint[] = []
  for (let i = h0; i < Math.min(f.hourly.time.length, h0 + 24); i++) {
    const p: WeatherHourlyPoint = {
      t: f.hourly.time[i]! * 1000,
      condition: wmoToCondition(at(f.hourly.weather_code, i)),
      tempC: at(f.hourly.temperature_2m, i) ?? 0,
      precipMm: at(f.hourly.precipitation, i) ?? 0,
      windKmh: at(f.hourly.wind_speed_10m, i) ?? 0,
      isDay: (at(f.hourly.is_day, i) ?? 1) === 1,
    }
    const prob = at(f.hourly.precipitation_probability, i)
    if (prob !== undefined) p.precipProbability = prob
    hourly.push(p)
  }
  const d0 = Math.max(0, dayIndex(f.daily.time, nowS))
  const daily: WeatherDailyPoint[] = []
  for (let i = d0; i < Math.min(f.daily.time.length, d0 + 7); i++) {
    const p: WeatherDailyPoint = {
      t: f.daily.time[i]! * 1000,
      condition: wmoToCondition(at(f.daily.weather_code, i)),
      minC: at(f.daily.temperature_2m_min, i) ?? 0,
      maxC: at(f.daily.temperature_2m_max, i) ?? 0,
      precipMm: at(f.daily.precipitation_sum, i) ?? 0,
      sunrise: Math.round((at(f.daily.sunrise, i) ?? 0) * 1000),
      sunset: Math.round((at(f.daily.sunset, i) ?? 0) * 1000),
    }
    const prob = at(f.daily.precipitation_probability_max, i)
    if (prob !== undefined) p.precipProbability = prob
    const uv = at(f.daily.uv_index_max, i)
    if (uv !== undefined) p.uvIndexMax = uv
    daily.push(p)
  }
  return { issuedAt: f.current.time * 1000, hourly, daily }
}
