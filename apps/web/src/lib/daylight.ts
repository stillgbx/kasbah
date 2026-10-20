import { approximateSunPosition, sunPosition } from '../three/core/sun'

// Is it daytime? The only question asked by the "Auto" appearance (`stores/settings.ts`).
//
// The threshold is NOT the horizon crossing: the app goes DARK half an hour BEFORE
// sunset, and only returns to LIGHT half an hour AFTER sunrise — civil twilight, the moment
// when the room darkens while the sun is still there. User's choice.
//
// Three sources, from the best to the last, and each only serves if the previous one is missing:
//   1. the hours published by the `weather` device (Open-Meteo gives them for the exact place);
//   2. otherwise the sun COMPUTED here from the house's GPS origin (`three/core/sun.ts`);
//   3. otherwise the typical 7 am - 9 pm day of `approximateSunPosition` — the default, written only once.
//
// The last two do not give hours but a HEIGHT: half an hour of grazing course
// is worth about 5° at our latitudes, hence the threshold. The offset is symmetric in height (the
// sun is as high half an hour after its rise as half an hour before its set), which
// gives the same rule on both sides of the day.

/** Twilight margin taken on the hours published by the weather. */
export const TWILIGHT_MS = 30 * 60 * 1000
/** Height of the sun that is worth this margin, when we only have its position. */
export const DAY_ALTITUDE_DEG = 5

export interface DaylightInput {
  now: Date
  /** Sunrise published by the weather (ms epoch). `0` or absent = no weather, we compute. */
  sunrise?: number
  sunset?: number
  /** Geographic origin of the house (`house.origin`), or `null` if it is not georeferenced. */
  geo?: { lat: number; lon: number } | null
}

export function isDaylight({ now, sunrise, sunset, geo = null }: DaylightInput): boolean {
  if (sunrise && sunset && sunset > sunrise) {
    const t = now.getTime()
    return t >= sunrise + TWILIGHT_MS && t < sunset - TWILIGHT_MS
  }
  const p = geo ? sunPosition(now, geo.lat, geo.lon) : approximateSunPosition(now)
  return p.altitudeDeg > DAY_ALTITUDE_DEG
}
