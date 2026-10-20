// Where the sun is, seen from here, now. PURE computation (no network, no API): the house is
// georeferenced (`origin`, lat/lon — see `doc/2_maison/2_0_format-house-json.md`)
// and the time comes from the clock. It is what lets the scene have its own time, independent
// of the light/dark theme of the application.
//
// "Low-precision" algorithm of the Astronomical Almanac (the same as the NOAA solar calculator):
// to within a few tenths of a degree over a century, more than enough to place a
// light. What would matter more — refraction near the horizon, the fine equation of time —
// is lost anyway in the artistic choice of the style.

const RAD = Math.PI / 180
const DEG = 180 / Math.PI

export interface SunPosition {
  /** Height above the horizon, in degrees. Negative at night. */
  altitudeDeg: number
  /** Azimuth in degrees from NORTH, clockwise (90 = east, 180 = south) — the convention of the house. */
  azimuthDeg: number
}

/** Days (fractional) elapsed since J2000.0, the origin of the ephemerides. */
function daysSinceJ2000(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const n = daysSinceJ2000(date)

  // Position of the sun on the ecliptic, then on the celestial equator.
  const meanLon = (280.46 + 0.9856474 * n) * RAD
  const meanAnom = (357.528 + 0.9856003 * n) * RAD
  const ecl = meanLon + (1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * RAD
  const obl = (23.439 - 0.0000004 * n) * RAD
  const ra = Math.atan2(Math.cos(obl) * Math.sin(ecl), Math.cos(ecl))
  const dec = Math.asin(Math.sin(obl) * Math.sin(ecl))

  // Hour angle: how far the sky has turned since the sun passed the meridian of the place.
  const gmstHours = 18.697375 + 24.065709824419 * n
  const lmstDeg = (gmstHours * 15 + lon) % 360
  let haDeg = lmstDeg - ra * DEG
  haDeg = ((haDeg + 180) % 360 + 360) % 360 - 180        // brought into [-180, 180[
  const ha = haDeg * RAD
  const phi = lat * RAD

  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha)
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)))
  // `acos` only returns [0, π]: it cannot tell morning from evening. It is the sign of the hour
  // angle that decides — positive = afternoon, so the sun has passed to the west.
  const cosAz = (Math.sin(dec) - Math.sin(phi) * sinAlt) / (Math.cos(phi) * Math.cos(alt) || 1e-9)
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz)))
  if (Math.sin(ha) > 0) az = 2 * Math.PI - az

  return { altitudeDeg: alt * DEG, azimuthDeg: ((az * DEG) % 360 + 360) % 360 }
}

/**
 * APPROXIMATE course, when the house is not georeferenced: we know neither where it is nor when the
 * sun rises there, so we take the browser's local time and a typical day (sunrise 7 am,
 * sunset 9 pm, culmination at 55°). Wrong by several degrees — but the scene only needs to know
 * one thing: whether it is daytime, and which side the light comes from.
 */
export function approximateSunPosition(date: Date): SunPosition {
  const hours = date.getHours() + date.getMinutes() / 60
  const day = (hours - 7) / 14                            // 0 at sunrise, 1 at sunset
  const altitudeDeg = 55 * Math.sin(Math.PI * day)        // negative outside the range: it is night
  return { altitudeDeg, azimuthDeg: 90 + 180 * Math.min(1, Math.max(0, day)) }
}

// Sun passage times — what an automation waits for ("15 min before dusk").
// Computed on `sunPosition` alone, without new astronomy: sweep of the local day in steps of
// 10 min, then bisection on each passage. Precision of the order of a second, well below
// the algorithm itself (a few tenths of a degree, i.e. one to two minutes at sunrise).

/** Height of "official" sunrise and sunset: upper edge of the disk, refraction included. */
export const SUN_HORIZON_DEG = -0.833
/** CIVIL twilight: the sun 6° below the horizon — one no longer reads outdoors without light. */
export const CIVIL_TWILIGHT_DEG = -6

export interface SunTimes {
  /** Civil dawn (−6°), in ms epoch. */
  dawn?: number
  sunrise?: number
  sunset?: number
  /** Civil dusk (−6°), in ms epoch. */
  dusk?: number
}

const STEP_MS = 10 * 60_000

/**
 * Sun passages during the LOCAL day (process timezone) that contains `day`. A missing passage
 * = it does not happen that day (polar day or night, or a twilight that does not end in summer beyond
 * ~60° of latitude).
 */
export function sunTimes(day: Date, lat: number, lon: number): SunTimes {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime()
  const alt = (t: number) => sunPosition(new Date(t), lat, lon).altitudeDeg

  const samples: { t: number; alt: number }[] = []
  for (let t = start; t < end; t += STEP_MS) samples.push({ t, alt: alt(t) })
  samples.push({ t: end, alt: alt(end) })

  // Solar noon splits the day in two: we CLIMB before, we DESCEND after. Without this split, beyond
  // ~55° in summer, the twilight of the PREVIOUS day (past midnight) would be taken for that of the day.
  const noon = samples.reduce((best, s) => (s.alt > best.alt ? s : best))

  /** Passage of `threshold`, rising before noon or falling after, refined by bisection. */
  const crossing = (threshold: number, rising: boolean): number | undefined => {
    const half = rising ? samples.filter((s) => s.t <= noon.t) : samples.filter((s) => s.t >= noon.t)
    let prev = half[0]
    for (const cur of half) {
      if (prev && prev !== cur && (rising ? prev.alt < threshold && cur.alt >= threshold : prev.alt >= threshold && cur.alt < threshold)) {
        let lo = prev.t
        let hi = cur.t
        for (let k = 0; k < 25; k++) {
          const mid = (lo + hi) / 2
          if ((alt(mid) < threshold) === rising) lo = mid
          else hi = mid
        }
        return Math.round((lo + hi) / 2)
      }
      prev = cur
    }
    return undefined
  }

  return {
    dawn: crossing(CIVIL_TWILIGHT_DEG, true),
    sunrise: crossing(SUN_HORIZON_DEG, true),
    sunset: crossing(SUN_HORIZON_DEG, false),
    dusk: crossing(CIVIL_TWILIGHT_DEG, false),
  }
}
