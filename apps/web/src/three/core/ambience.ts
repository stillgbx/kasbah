import { Vector3 } from 'three'
import type { WeatherCondition } from '@kasbah/shared'
import { approximateSunPosition, sunPosition } from './sun'

// L'AMBIANCE, c'est l'heure qu'il fait dans la scène — pas le goût du rendu. Les deux axes sont
// volontairement séparés :
//
//   style   (`three/styles/`)  = COMMENT c'est rendu (réaliste, nature, cyberpunk, candy…)
//   ambiance (ce fichier)      = QUELLE lumière il y a (position du soleil, couverture du ciel)
//
// Et ni l'un ni l'autre n'est le thème clair/sombre de l'application : demande explicite de
// l'utilisateur — « le mode de l'app est une chose, pour la maison c'est en fonction de la position
// gps, du soleil, de la météo ». Un écran en thème sombre devant une maison en plein soleil est
// donc un état normal.
//
// La météo est branchée depuis le 2026-09-16 : `useHouseScene` lit l'appareil `weather` (nébulosité,
// visibilité, condition) et le reste vient d'ici — ce que la pluie mouille, ce que la neige blanchit,
// quand l'orage éclaire (`weatherEffects`). Sans météo, tout vaut « dégagé ».

/** Ce que l'utilisateur choisit dans les réglages. `auto` suit le soleil réel au-dessus de la maison. */
export type AmbienceMode = 'auto' | 'day' | 'dusk' | 'night'
export const AMBIENCE_MODES: readonly AmbienceMode[] = ['auto', 'day', 'dusk', 'night']

export interface SceneAmbience {
  /** Hauteur du soleil en degrés (négative = sous l'horizon). */
  sunAltitudeDeg: number
  /** Azimut en degrés depuis le nord, sens horaire (convention de la maison : x est, y nord). */
  sunAzimuthDeg: number
  /** Couverture nuageuse, 0 (ciel dégagé) à 1 (couvert). Diffuse la lumière et éteint les ombres. */
  cloudiness: number
  /**
   * Visibilité (m) annoncée par la météo. Absente = dégagée. En dessous de quelques kilomètres
   * (brouillard, forte pluie), la scène pose un brouillard à l'échelle de la maison.
   */
  visibilityM?: number
  /** Ce que la pluie laisse : sols et toits sombres et luisants, 0 (sec) à 1 (trempé). */
  wetness?: number
  /** Ce que la neige pose : un blanc mat sur tout ce qui est dehors, 0 à 1. */
  snow?: number
  /** Orage : la scène s'éclaire d'un éclair de temps en temps. */
  storm?: boolean
  /** Ce qui TOMBE : pluie ou neige en particules (`effects/precipitation.ts`), et combien. */
  precipitation?: { kind: 'rain' | 'snow'; intensity: number }
  /** Le vent, pour incliner ce qui tombe : vitesse et provenance (degrés depuis le nord, sens horaire). */
  windKmh?: number
  windDirDeg?: number
}

/**
 * Ce qu'une condition météo fait aux surfaces. La bruine et le brouillard mouillent moins qu'une
 * averse ; la neige fondue est à moitié neige, à moitié flaque ; seul l'orage fait des éclairs.
 */
export function weatherEffects(condition: WeatherCondition | undefined): Pick<SceneAmbience, 'wetness' | 'snow' | 'storm' | 'precipitation'> {
  switch (condition) {
    case 'rain': return { wetness: 1, precipitation: { kind: 'rain', intensity: 0.8 } }
    case 'thunderstorm': return { wetness: 1, storm: true, precipitation: { kind: 'rain', intensity: 1 } }
    case 'drizzle': return { wetness: 0.7, precipitation: { kind: 'rain', intensity: 0.3 } }
    case 'fog': return { wetness: 0.35 }
    case 'sleet': return { wetness: 0.6, snow: 0.5, precipitation: { kind: 'rain', intensity: 0.6 } }
    case 'snow': return { snow: 1, precipitation: { kind: 'snow', intensity: 0.8 } }
    default: return {}
  }
}

/**
 * Les conditions où rien n'est EN L'AIR. La visibilité d'Open-Meteo est une sortie de modèle, qui
 * tombe à quelques dizaines de mètres dès que l'humidité touche 100 % : un matin annoncé « couvert »
 * à cette visibilité-là noyait la maison alors qu'on y voyait clair. Sous ces conditions-là, elle ne
 * fait pas de brouillard ; le brouillard, la pluie et la neige gardent le leur.
 */
const DRY_AIR: ReadonlySet<WeatherCondition> = new Set(['clear', 'partly_cloudy', 'cloudy'])

/** Heures figées des modes manuels : une journée franche, un crépuscule bas, une nuit. */
const FIXED: Record<Exclude<AmbienceMode, 'auto'>, SceneAmbience> = {
  day: { sunAltitudeDeg: 52, sunAzimuthDeg: 160, cloudiness: 0 },
  dusk: { sunAltitudeDeg: 2, sunAzimuthDeg: 283, cloudiness: 0 },
  // La lune est placée au SUD-OUEST, d'où la scène se regarde par défaut (`DEFAULT_AZIMUTH`) : une
  // source dans le dos de la caméra ne montre que des faces à l'ombre, et la maison disparaît.
  night: { sunAltitudeDeg: -20, sunAzimuthDeg: 215, cloudiness: 0 },
}

export interface AmbienceInput {
  mode: AmbienceMode
  /** Maintenant, injectable pour les tests. */
  date?: Date
  /** Origine géographique de la maison (`house.origin`), ou `null` si elle n'est pas géoréférencée. */
  geo?: { lat: number; lon: number } | null
  cloudiness?: number
  visibilityM?: number
  /** La condition annoncée par la météo : pluie, neige, orage… (`weatherEffects`). */
  condition?: WeatherCondition
  windKmh?: number
  windDirDeg?: number
}

export function resolveAmbience({ mode, date = new Date(), geo = null, cloudiness = 0, visibilityM, condition, windKmh, windDirDeg }: AmbienceInput): SceneAmbience {
  // Un mode inconnu (réglage écrit à la main, valeur d'une version précédente) ne doit PAS produire
  // une ambiance `NaN` : tout le rendu en dépend — exposition comprise — et une exposition NaN rend
  // une image entièrement noire, sans la moindre erreur en console.
  const weather: Omit<SceneAmbience, 'sunAltitudeDeg' | 'sunAzimuthDeg'> = { cloudiness, ...weatherEffects(condition) }
  if (visibilityM !== undefined && !(condition && DRY_AIR.has(condition))) weather.visibilityM = visibilityM
  if (windKmh !== undefined) weather.windKmh = windKmh
  if (windDirDeg !== undefined) weather.windDirDeg = windDirDeg
  const fixed = mode === 'auto' ? undefined : FIXED[mode]
  if (fixed) return { ...fixed, ...weather }
  const p = geo ? sunPosition(date, geo.lat, geo.lon) : approximateSunPosition(date)
  return { sunAltitudeDeg: p.altitudeDeg, sunAzimuthDeg: p.azimuthDeg, ...weather }
}

/** Portée (m) du brouillard le plus épais : au-delà de la maison, que la caméra regarde de 50 à 90 m. */
const FOG_MIN_M = 120

/**
 * Portée du brouillard de scène (m), ou `null` s'il n'y a pas lieu d'en poser. La visibilité
 * météo se compte en kilomètres, la maison en mètres : on la ramène à l'échelle de la scène, et une
 * pluie à 6 km ne fait rien — le seuil est celui où l'œil commence à voir l'air.
 *
 * La portée ne descend JAMAIS sous `FOG_MIN_M` : la caméra regarde la maison de 50 à 90 m, et la
 * vue est un tableau de bord, pas une simulation. L'ancienne échelle (400 m réels → 33 m, plancher
 * 18 m) rendait la scène entièrement grise ; ici le brouillard le plus épais voile la maison et
 * efface le jardin lointain, sans jamais la faire disparaître.
 */
export function fogDistance(a: SceneAmbience): number | null {
  if (a.visibilityM === undefined || a.visibilityM >= 5000) return null
  return FOG_MIN_M + a.visibilityM / 20
}

/**
 * 0 = nuit noire, 1 = plein jour, et tout le dégradé du crépuscule entre les deux. C'est le seul
 * nombre dont les styles ont besoin pour mélanger leurs deux palettes : entre −6° (fin du crépuscule
 * civil, on ne lit plus dehors) et +8° (le soleil a décollé, les ombres se posent), la maison passe
 * continûment de sa nuit à son jour. Un seuil binaire ferait claquer la scène à la minute près.
 */
export function dayFactor(a: SceneAmbience): number {
  const t = (a.sunAltitudeDeg + 6) / 14
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return k * k * (3 - 2 * k)
}

/** La part CRÉPUSCULAIRE : maximale quand le soleil rase l'horizon, nulle en plein jour et en pleine nuit. */
export function duskFactor(a: SceneAmbience): number {
  const d = Math.abs(a.sunAltitudeDeg - 1) / 11
  return d > 1 ? 0 : 1 - d
}

/**
 * Direction d'où vient la lumière, dans le repère MONDE de three (x est, y haut, z sud — la racine
 * de la maison porte `rotation.x = -π/2`, donc le +y du plan est en −z). Le +y du plan n'est au
 * nord vrai que si la maison n'est pas tournée : `headingDeg` (`origin.heading`, le cap de +y) se
 * retranche de l'azimut. Vecteur unitaire pointant VERS le soleil ; la lumière se pose dessus, à distance.
 *
 * La nuit, le soleil est sous l'horizon et une `DirectionalLight` enterrée n'éclaire plus rien : on
 * garde l'azimut, et on relève la source à une hauteur plancher — c'est la lune, qui se lève rarement
 * exactement à l'opposé mais dont personne ne vérifiera la déclinaison.
 */
export function sunDirection(a: SceneAmbience, minAltitudeDeg = 18, headingDeg = 0): Vector3 {
  const alt = Math.max(a.sunAltitudeDeg, minAltitudeDeg) * (Math.PI / 180)
  const az = (a.sunAzimuthDeg - headingDeg) * (Math.PI / 180)
  const east = Math.sin(az) * Math.cos(alt)
  const north = Math.cos(az) * Math.cos(alt)
  return new Vector3(east, Math.sin(alt), -north).normalize()
}
