import { aqiLevelOf, type PollenType, type WeatherCondition, type WeatherDailyPoint, type WeatherHourlyPoint } from '@kasbah/shared'
import type { SimDevice, SimForecast } from '../types'
import { outdoorTemperature, solarGeometry, type World } from '../world'
import { clamp, descriptor, round1 } from './common'

// Météo simulée : ce que le monde partagé (`world.ts`) sait déjà — nuages, température,
// ensoleillement, précipitations — mis en forme d'un appareil `weather`. C'est ce qui permet de
// développer le widget, la vue Météo et la scène 3D sans réseau, et de FORCER pluie, neige ou orage
// (scénario `winter`, graine) pour regarder la maison sous la pluie.
//
// Les prévisions sont tirées du même modèle : la courbe de température du monde et une nébulosité
// qui dérive vers sa moyenne. Elles sont fausses comme toute simulation, mais cohérentes avec
// l'actuel, ce qui est tout ce qu'une vue a besoin pour se dessiner.

export interface WeatherOptions { name: string }

/** Lever et coucher du monde simulé (6 h et 20 h locales, `solarGeometry`), pour le jour de `simTime`. */
export function sunEvents(simTime: number, tzOffsetMin: number): { sunrise: number; sunset: number } {
  const local = simTime - tzOffsetMin * 60_000
  const dayStart = Math.floor(local / 86_400_000) * 86_400_000 + tzOffsetMin * 60_000
  return { sunrise: dayStart + 6 * 3_600_000, sunset: dayStart + 20 * 3_600_000 }
}

/** La condition en un mot, à partir de la nébulosité, des précipitations et de la température. */
export function conditionOf(cloud: number, precipMmH: number, tempC: number, humidity: number): WeatherCondition {
  if (precipMmH > 0) {
    if (tempC < 1) return 'snow'
    if (tempC < 3) return 'sleet'
    if (precipMmH > 4 && tempC > 20) return 'thunderstorm'
    return precipMmH < 0.5 ? 'drizzle' : 'rain'
  }
  if (humidity >= 95 && cloud < 0.6) return 'fog'
  return cloud < 0.3 ? 'clear' : cloud < 0.7 ? 'partly_cloudy' : 'cloudy'
}

/** Pollens par mois (0 = janvier), niveaux 0-4 : les saisons françaises, grossièrement. */
const POLLEN_SEASON: Record<PollenType, readonly number[]> = {
  alder:   [1, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  birch:   [0, 0, 2, 4, 2, 0, 0, 0, 0, 0, 0, 0],
  grass:   [0, 0, 0, 1, 3, 4, 3, 1, 0, 0, 0, 0],
  mugwort: [0, 0, 0, 0, 0, 0, 2, 3, 1, 0, 0, 0],
  olive:   [0, 0, 0, 0, 2, 3, 1, 0, 0, 0, 0, 0],
  ragweed: [0, 0, 0, 0, 0, 0, 0, 3, 3, 1, 0, 0],
}

function pollenAt(simTime: number, tzOffsetMin: number): Partial<Record<PollenType, number>> {
  const month = new Date(simTime - tzOffsetMin * 60_000).getUTCMonth()
  const out: Partial<Record<PollenType, number>> = {}
  for (const [type, season] of Object.entries(POLLEN_SEASON) as [PollenType, readonly number[]][]) {
    const level = season[month]!
    if (level > 0) out[type] = level
  }
  return out
}

export function weather(externalId: string, o: WeatherOptions): SimDevice<'weather'> {
  // vent : marche lente propre à l'appareil (le monde n'en a pas besoin), plus fort sous les nuages
  let wind = 9
  let windDir = 240
  const dev: SimDevice<'weather'> = {
    descriptor: descriptor(externalId, 'weather', o.name, ['forecast', 'air_quality', 'pollen'], {
      manufacturer: 'Mock', weather: { attribution: 'Simulation', model: 'Mock world' },
    }),
    state: {
      kind: 'weather', updatedAt: 0, available: true, condition: 'clear', tempC: 18, humidity: 60, windKmh: 9, windDirDeg: 240,
      cloudCover: 20, isDay: true, sunrise: 0, sunset: 0, observedAt: 0,
    },
    tick(ctx) {
      const s = dev.state
      const w = ctx.world
      const k = Math.min(1, ctx.dtS / 600)
      // une houle de six heures tient lieu de rafales : pas de tirage aléatoire ici, la suite du
      // générateur partagé resterait sinon décalée pour tous les autres appareils (et les tests)
      const swell = 4 * Math.sin(ctx.simTime / 3_600_000 / 6 * 2 * Math.PI)
      wind = clamp(wind + (8 + 26 * w.cloud + swell - wind) * k, 0, 90)
      windDir = (windDir + (200 + 60 * w.cloud + 20 * Math.sin(ctx.simTime / 86_400_000 * 2 * Math.PI) - windDir) * k + 360) % 360
      const tempC = round1(w.outdoorTempC)
      const humidity = Math.round(clamp(52 + 38 * w.cloud + (w.precipMmH > 0 ? 10 : 0) - 8 * solarGeometry(ctx.hour), 20, 100))
      const condition = conditionOf(w.cloud, w.precipMmH, tempC, humidity)
      const aqi = Math.round(clamp(38 - wind * 0.4 - w.precipMmH * 3, 5, 80))
      const { sunrise, sunset } = sunEvents(ctx.simTime, ctx.tzOffsetMin)
      Object.assign(s, {
        condition, tempC,
        feelsLikeC: round1(tempC < 10 ? tempC - wind / 12 : tempC > 24 ? tempC + (humidity - 50) / 20 : tempC),
        dewPointC: round1(tempC - (100 - humidity) / 5),
        humidity,
        pressureHpa: Math.round(1018 - 16 * w.cloud - w.precipMmH),
        windKmh: Math.round(wind), windGustKmh: Math.round(wind * 1.6), windDirDeg: Math.round(windDir),
        cloudCover: Math.round(w.cloud * 100),
        precipMm: round1(w.precipMmH),
        precipProbability: Math.round(clamp(w.cloud * 90 - 15 + (w.precipMmH > 0 ? 40 : 0), 0, 100)),
        visibilityM: condition === 'fog' ? 400 : w.precipMmH > 0 ? 6000 : 25_000,
        uvIndex: Math.round(w.irradiance * 9),
        isDay: solarGeometry(ctx.hour) > 0,
        sunrise, sunset,
        aqi, aqiLevel: aqiLevelOf(aqi),
        pollen: pollenAt(ctx.simTime, ctx.tzOffsetMin),
        observedAt: ctx.simTime,
      })
    },
    forecast(ctx) { return forecastOf(ctx.world, ctx.simTime, ctx.tzOffsetMin, wind) },
  }
  return dev
}

/**
 * Prévisions déduites du monde : la nébulosité courante dérive vers 0,45 avec une houle de
 * deux jours, la température suit la courbe journalière du monde décalée d'un peu de « météo »
 * (un jour sur trois plus frais). Déterministe : la même heure donne la même prévision.
 */
export function forecastOf(world: World, simTime: number, tzOffsetMin: number, windKmh: number): SimForecast {
  const HOUR = 3_600_000, DAY = 86_400_000
  const local = simTime - tzOffsetMin * 60_000
  const localDayStart = Math.floor(local / DAY) * DAY
  const cloudAt = (t: number) => {
    const ageH = (t - simTime) / HOUR
    const drift = world.cloud + (0.45 - world.cloud) * Math.min(1, ageH / 18)
    return clamp(drift + 0.25 * Math.sin((t / DAY) * Math.PI), 0, 1)
  }
  const dayOffsetC = (t: number) => 2.5 * Math.sin((Math.floor((t - tzOffsetMin * 60_000) / DAY) % 3) * 2.1)
  const precipAt = (cloud: number) => (cloud > 0.72 ? round1((cloud - 0.72) * 12) : 0)

  const hourly: WeatherHourlyPoint[] = []
  const firstHour = Math.ceil(simTime / HOUR) * HOUR
  for (let i = 0; i < 24; i++) {
    const t = firstHour + i * HOUR
    const hour = ((((t - tzOffsetMin * 60_000) / HOUR) % 24) + 24) % 24
    const cloud = cloudAt(t)
    const tempC = round1(outdoorTemperature(hour, world.config) + dayOffsetC(t))
    const precipMm = precipAt(cloud)
    hourly.push({
      t, condition: conditionOf(cloud, precipMm, tempC, 60 + 30 * cloud), tempC, precipMm,
      precipProbability: Math.round(clamp(cloud * 90 - 15 + (precipMm > 0 ? 40 : 0), 0, 100)),
      windKmh: Math.round(clamp(windKmh + (cloud - world.cloud) * 20, 0, 90)), isDay: solarGeometry(hour) > 0,
    })
  }

  const daily: WeatherDailyPoint[] = []
  for (let d = 0; d < 7; d++) {
    const t = localDayStart + d * DAY + tzOffsetMin * 60_000
    const noon = t + 13 * HOUR
    const cloud = cloudAt(noon)
    const offset = dayOffsetC(noon)
    const precipMm = precipAt(cloud) * 4
    const maxC = round1(world.config.tempMeanC + world.config.tempAmplitudeC + offset)
    const { sunrise, sunset } = sunEvents(noon, tzOffsetMin)
    daily.push({
      t, condition: conditionOf(cloud, precipMm / 4, maxC, 60 + 30 * cloud),
      minC: round1(world.config.tempMeanC - world.config.tempAmplitudeC + offset), maxC, precipMm,
      precipProbability: Math.round(clamp(cloud * 90 - 15 + (precipMm > 0 ? 40 : 0), 0, 100)),
      uvIndexMax: Math.round(world.config.solarPeak * 8 * (1 - 0.7 * cloud)), sunrise, sunset,
    })
  }
  return { issuedAt: simTime, hourly, daily }
}
