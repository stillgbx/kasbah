import { Vector3 } from 'three'
import type { WeatherCondition } from '@kasbah/shared'
import { approximateSunPosition, sunPosition } from './sun'

// The AMBIENCE is the time of day in the scene — not the taste of the render. The two axes are
// deliberately separate:
//
//   style    (`three/styles/`) = HOW it is rendered (realistic, nature, cyberpunk, candy…)
//   ambience (this file)       = WHAT light there is (sun position, sky cover)
//
// And neither is the application's light/dark theme: an explicit request from
// the user — "the app's mode is one thing, for the house it depends on the gps
// position, the sun, the weather". A screen in dark theme in front of a house in full sun is
// therefore a normal state.
//
// The weather is wired in since 2026-09-16: `useHouseScene` reads the `weather` device (cloud cover,
// visibility, condition) and the rest comes from here — what the rain wets, what the snow whitens,
// when the storm flashes (`weatherEffects`). Without weather, everything counts as "clear".

/** What the user chooses in the settings. `auto` follows the real sun above the house. */
export type AmbienceMode = 'auto' | 'day' | 'dusk' | 'night'
export const AMBIENCE_MODES: readonly AmbienceMode[] = ['auto', 'day', 'dusk', 'night']

export interface SceneAmbience {
  /** Sun elevation in degrees (negative = below the horizon). */
  sunAltitudeDeg: number
  /** Azimuth in degrees from north, clockwise (house convention: x east, y north). */
  sunAzimuthDeg: number
  /** Cloud cover, 0 (clear sky) to 1 (overcast). Diffuses the light and kills the shadows. */
  cloudiness: number
  /**
   * Visibility (m) reported by the weather. Absent = clear. Below a few kilometers
   * (fog, heavy rain), the scene sets a fog at the scale of the house.
   */
  visibilityM?: number
  /** What the rain leaves: dark, glistening floors and roofs, 0 (dry) to 1 (soaked). */
  wetness?: number
  /** What the snow lays down: a matte white on everything outdoors, 0 to 1. */
  snow?: number
  /** Storm: the scene lights up with a lightning flash from time to time. */
  storm?: boolean
  /** What FALLS: rain or snow as particles (`effects/precipitation.ts`), and how much. */
  precipitation?: { kind: 'rain' | 'snow'; intensity: number }
  /** The wind, to tilt what falls: speed and origin (degrees from north, clockwise). */
  windKmh?: number
  windDirDeg?: number
}

/**
 * What a weather condition does to the surfaces. Drizzle and fog wet less than a
 * shower; sleet is half snow, half puddle; only the storm makes lightning.
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
 * The conditions where nothing is IN THE AIR. Open-Meteo's visibility is a model output, which
 * drops to a few tens of meters as soon as humidity hits 100 %: a morning reported "overcast"
 * at that visibility drowned the house even though one could see clearly. Under those conditions, it does
 * not make fog; fog, rain and snow keep theirs.
 */
const DRY_AIR: ReadonlySet<WeatherCondition> = new Set(['clear', 'partly_cloudy', 'cloudy'])

/** Fixed hours of the manual modes: a frank day, a low twilight, a night. */
const FIXED: Record<Exclude<AmbienceMode, 'auto'>, SceneAmbience> = {
  day: { sunAltitudeDeg: 52, sunAzimuthDeg: 160, cloudiness: 0 },
  dusk: { sunAltitudeDeg: 2, sunAzimuthDeg: 283, cloudiness: 0 },
  // The moon is placed in the SOUTH-WEST, from where the scene is viewed by default (`DEFAULT_AZIMUTH`): a
  // source behind the camera only shows faces in shadow, and the house disappears.
  night: { sunAltitudeDeg: -20, sunAzimuthDeg: 215, cloudiness: 0 },
}

export interface AmbienceInput {
  mode: AmbienceMode
  /** Now, injectable for tests. */
  date?: Date
  /** Geographic origin of the house (`house.origin`), or `null` if it is not georeferenced. */
  geo?: { lat: number; lon: number } | null
  cloudiness?: number
  visibilityM?: number
  /** The condition reported by the weather: rain, snow, storm… (`weatherEffects`). */
  condition?: WeatherCondition
  windKmh?: number
  windDirDeg?: number
}

export function resolveAmbience({ mode, date = new Date(), geo = null, cloudiness = 0, visibilityM, condition, windKmh, windDirDeg }: AmbienceInput): SceneAmbience {
  // An unknown mode (hand-written setting, value from a previous version) must NOT produce
  // a `NaN` ambience: the whole render depends on it — exposure included — and a NaN exposure renders
  // an entirely black image, without the slightest error in the console.
  const weather: Omit<SceneAmbience, 'sunAltitudeDeg' | 'sunAzimuthDeg'> = { cloudiness, ...weatherEffects(condition) }
  if (visibilityM !== undefined && !(condition && DRY_AIR.has(condition))) weather.visibilityM = visibilityM
  if (windKmh !== undefined) weather.windKmh = windKmh
  if (windDirDeg !== undefined) weather.windDirDeg = windDirDeg
  const fixed = mode === 'auto' ? undefined : FIXED[mode]
  if (fixed) return { ...fixed, ...weather }
  const p = geo ? sunPosition(date, geo.lat, geo.lon) : approximateSunPosition(date)
  return { sunAltitudeDeg: p.altitudeDeg, sunAzimuthDeg: p.azimuthDeg, ...weather }
}

/** Range (m) of the thickest fog: beyond the house, which the camera looks at from 50 to 90 m. */
const FOG_MIN_M = 120

/**
 * Range of the scene fog (m), or `null` if there is no reason to set one. The weather
 * visibility is counted in kilometers, the house in meters: we bring it back to the scene's scale, and
 * rain at 6 km does nothing — the threshold is where the eye starts to see the air.
 *
 * The range NEVER goes below `FOG_MIN_M`: the camera looks at the house from 50 to 90 m, and the
 * view is a dashboard, not a simulation. The old scale (400 real m → 33 m, floor
 * 18 m) made the scene entirely gray; here the thickest fog veils the house and
 * erases the distant garden, without ever making it disappear.
 */
export function fogDistance(a: SceneAmbience): number | null {
  if (a.visibilityM === undefined || a.visibilityM >= 5000) return null
  return FOG_MIN_M + a.visibilityM / 20
}

/** Camera distance (m) to the aimed point that `fogDistance` is set for: the desktop's default framing. */
const FOG_CAMERA_REF_M = 55

/**
 * The scene fog's bounds for a camera `cameraDistance` m from the aimed point, or `null` without fog.
 * Farther than the reference (a phone in portrait: 115 m, the garden framing: 120 m, the isometric
 * view), the range stretches with the camera: the house keeps the same veil instead of sinking into
 * the background. Closer, it stays as is.
 */
export function fogRange(a: SceneAmbience, cameraDistance: number): { near: number; far: number } | null {
  const far = fogDistance(a)
  if (far === null) return null
  const k = Math.max(1, cameraDistance / FOG_CAMERA_REF_M)
  return { near: far * 0.35 * k, far: far * k }
}

/**
 * 0 = pitch-dark night, 1 = broad daylight, and the whole twilight gradient in between. It is the only
 * number the styles need to blend their two palettes: between −6° (end of civil
 * twilight, one can no longer read outdoors) and +8° (the sun has lifted off, the shadows settle), the house goes
 * continuously from its night to its day. A binary threshold would make the scene snap to the minute.
 */
export function dayFactor(a: SceneAmbience): number {
  const t = (a.sunAltitudeDeg + 6) / 14
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  return k * k * (3 - 2 * k)
}

/** The TWILIGHT share: maximal when the sun skims the horizon, zero in broad daylight and in the dead of night. */
export function duskFactor(a: SceneAmbience): number {
  const d = Math.abs(a.sunAltitudeDeg - 1) / 11
  return d > 1 ? 0 : 1 - d
}

/**
 * Direction the light comes from, in three's WORLD reference frame (x east, y up, z south — the house
 * root carries `rotation.x = -π/2`, so the plan's +y is at −z). The plan's +y only points to
 * true north if the house is not rotated: `headingDeg` (`origin.heading`, the heading of +y) is
 * subtracted from the azimuth. Unit vector pointing TOWARD the sun; the light is placed on it, at a distance.
 *
 * At night, the sun is below the horizon and a buried `DirectionalLight` lights nothing anymore: we
 * keep the azimuth, and raise the source to a floor elevation — it is the moon, which rarely rises
 * exactly opposite but whose declination nobody will check.
 */
export function sunDirection(a: SceneAmbience, minAltitudeDeg = 18, headingDeg = 0): Vector3 {
  const alt = Math.max(a.sunAltitudeDeg, minAltitudeDeg) * (Math.PI / 180)
  const az = (a.sunAzimuthDeg - headingDeg) * (Math.PI / 180)
  const east = Math.sin(az) * Math.cos(alt)
  const north = Math.cos(az) * Math.cos(alt)
  return new Vector3(east, Math.sin(alt), -north).normalize()
}
