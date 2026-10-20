import type { Rng } from './rng'

// Environment shared by all devices on every tick: sunshine, weather,
// and accumulator of electrical loads (consumers add to it, energy reads it last).

export interface WorldConfig {
  /** Maximum relative sunshine (1 = clear summer). */
  solarPeak: number
  /** Mean outdoor temperature / daily amplitude (°C). */
  tempMeanC: number
  tempAmplitudeC: number
}

export const DEFAULT_WORLD: WorldConfig = { solarPeak: 1, tempMeanC: 18, tempAmplitudeC: 7 }
export const WINTER_WORLD: WorldConfig = { solarPeak: 0.45, tempMeanC: 4, tempAmplitudeC: 4 }

export interface World {
  config: WorldConfig
  /** Effective sunshine [0, 1] (solar geometry × clouds). */
  irradiance: number
  /** Smoothed cloud cover [0, 1]. */
  cloud: number
  /** Precipitation (mm/h): none under a clear sky, a shower when it clouds over. */
  precipMmH: number
  outdoorTempC: number
  /** Electrical loads (W) declared by the devices during this tick. */
  loadsW: number
}

export function createWorld(config: Partial<WorldConfig> = {}): World {
  return { config: { ...DEFAULT_WORLD, ...config }, irradiance: 0, cloud: 0.2, precipMmH: 0, outdoorTempC: DEFAULT_WORLD.tempMeanC, loadsW: 0 }
}

/** Simplified solar geometry: sunrise 6 am, sunset 8 pm, peak 1 pm. */
export function solarGeometry(hour: number): number {
  if (hour <= 6 || hour >= 20) return 0
  return Math.pow(Math.sin((Math.PI * (hour - 6)) / 14), 1.3)
}

/** Temperature: maximum around 3 pm, minimum around 3 am (a cosine tuned to the afternoon). */
export function outdoorTemperature(hour: number, cfg: WorldConfig): number {
  return cfg.tempMeanC + cfg.tempAmplitudeC * Math.cos((2 * Math.PI * (hour - 15)) / 24)
}

/** Updates the world for this tick (clouds in a slow, bounded random walk). */
export function tickWorld(world: World, hour: number, dtS: number, rng: Rng): void {
  world.cloud = Math.min(0.9, Math.max(0, world.cloud + (rng() - 0.5) * 0.02 * Math.min(dtS, 60)))
  // it only rains under an overcast sky: above 0.7 the shower forms, below it fades out
  const rainDrift = world.cloud > 0.7 ? (world.cloud - 0.7) * 0.01 : -0.004
  world.precipMmH = Math.min(8, Math.max(0, world.precipMmH + rainDrift * Math.min(dtS, 60)))
  world.irradiance = solarGeometry(hour) * world.config.solarPeak * (1 - 0.8 * world.cloud)
  world.outdoorTempC = outdoorTemperature(hour, world.config)
  world.loadsW = 0
}
