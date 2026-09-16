import type { Rng } from './rng'

// Environnement partagé par tous les appareils à chaque tick : ensoleillement, météo,
// et accumulateur de charges électriques (les consommateurs s'y ajoutent, l'énergie le lit en dernier).

export interface WorldConfig {
  /** Ensoleillement maximal relatif (1 = été clair). */
  solarPeak: number
  /** Température extérieure moyenne / amplitude journalière (°C). */
  tempMeanC: number
  tempAmplitudeC: number
}

export const DEFAULT_WORLD: WorldConfig = { solarPeak: 1, tempMeanC: 18, tempAmplitudeC: 7 }
export const WINTER_WORLD: WorldConfig = { solarPeak: 0.45, tempMeanC: 4, tempAmplitudeC: 4 }

export interface World {
  config: WorldConfig
  /** Ensoleillement effectif [0, 1] (géométrie solaire × nuages). */
  irradiance: number
  /** Couverture nuageuse lissée [0, 1]. */
  cloud: number
  /** Précipitations (mm/h) : nulles sous un ciel dégagé, une averse quand il se couvre. */
  precipMmH: number
  outdoorTempC: number
  /** Charges électriques (W) déclarées par les appareils pendant ce tick. */
  loadsW: number
}

export function createWorld(config: Partial<WorldConfig> = {}): World {
  return { config: { ...DEFAULT_WORLD, ...config }, irradiance: 0, cloud: 0.2, precipMmH: 0, outdoorTempC: DEFAULT_WORLD.tempMeanC, loadsW: 0 }
}

/** Géométrie solaire simplifiée : lever 6 h, coucher 20 h, pic 13 h. */
export function solarGeometry(hour: number): number {
  if (hour <= 6 || hour >= 20) return 0
  return Math.pow(Math.sin((Math.PI * (hour - 6)) / 14), 1.3)
}

/** Température : maximum vers 15 h, minimum vers 3 h (une cosinusoïde calée sur l'après-midi). */
export function outdoorTemperature(hour: number, cfg: WorldConfig): number {
  return cfg.tempMeanC + cfg.tempAmplitudeC * Math.cos((2 * Math.PI * (hour - 15)) / 24)
}

/** Met à jour le monde pour ce tick (nuages en marche aléatoire lente, bornée). */
export function tickWorld(world: World, hour: number, dtS: number, rng: Rng): void {
  world.cloud = Math.min(0.9, Math.max(0, world.cloud + (rng() - 0.5) * 0.02 * Math.min(dtS, 60)))
  // il ne pleut que sous un ciel couvert : au-dessus de 0,7 l'averse se forme, en dessous elle s'éteint
  const rainDrift = world.cloud > 0.7 ? (world.cloud - 0.7) * 0.01 : -0.004
  world.precipMmH = Math.min(8, Math.max(0, world.precipMmH + rainDrift * Math.min(dtS, 60)))
  world.irradiance = solarGeometry(hour) * world.config.solarPeak * (1 - 0.8 * world.cloud)
  world.outdoorTempC = outdoorTemperature(hour, world.config)
  world.loadsW = 0
}
