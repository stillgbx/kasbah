// The Météo-France AROME forecast at a 15-minute step, as Open-Meteo publishes it as
// `.om` files on an open S3 bucket (`data_spatial/<model>/<YYYY>/<MM>/<DD>/<HH>00Z/<YYYY-MM-DD>T<HHMM>.om`).
// Rendering is done in the browser by `@openmeteo/weather-map-layer` (MapLibre `om://` protocol).
//
// We do NOT go through the library's `latest.json?time_step=…`: it builds the file name
// with zeroed minutes (`T${HH}00.om`), so the 15-minute steps all collapse onto the full
// hour. We read `latest.json` ourselves (it gives the run and its lead times) and build the exact
// URL of each step. Everything here is pure: testable without a map.

export const AROME_DOMAIN = 'meteofrance_arome_france_hd_15min'
export const AROME_BASE = `https://openmeteo.s3.amazonaws.com/data_spatial/${AROME_DOMAIN}`
export const AROME_META_URL = `${AROME_BASE}/latest.json`
/** The variable drawn: precipitation accumulation of the step (mm), same palette as the rain on Open-Meteo's site. */
export const AROME_VARIABLE = 'precipitation'

export interface AromeMeta {
  /** The run is complete (otherwise lead times are missing). */
  completed?: boolean
  /** Run time (ISO). */
  reference_time: string
  /** Available lead times (ISO, 15 min step). */
  valid_times: string[]
  variables?: string[]
}

export interface AromeFrame {
  /** Lead time (epoch seconds, like the RainViewer images). */
  time: number
  /** HTTPS URL of this step's `.om` file. */
  url: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Path of the `.om` file of a lead time for a given run. */
export function aromeFileUrl(referenceTime: Date, validTime: Date): string {
  const r = referenceTime, v = validTime
  return `${AROME_BASE}/${r.getUTCFullYear()}/${pad(r.getUTCMonth() + 1)}/${pad(r.getUTCDate())}/${pad(r.getUTCHours())}00Z/`
    + `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}T${pad(v.getUTCHours())}${pad(v.getUTCMinutes())}.om`
}

/**
 * The steps to show AFTER now, bounded to `horizonMin` minutes: the forecast takes over from the
 * observed radar. A run that does not carry the variable, or that has nothing beyond now (old
 * run), gives no step — the radar stays alone.
 */
export function aromeFrames(meta: AromeMeta, nowMs: number, horizonMin = 360): AromeFrame[] {
  if (meta.variables && !meta.variables.includes(AROME_VARIABLE)) return []
  const ref = new Date(meta.reference_time)
  if (Number.isNaN(ref.getTime())) return []
  const out: AromeFrame[] = []
  for (const iso of meta.valid_times) {
    const t = new Date(iso)
    const ms = t.getTime()
    if (Number.isNaN(ms) || ms <= nowMs || ms > nowMs + horizonMin * 60_000) continue
    out.push({ time: Math.floor(ms / 1000), url: aromeFileUrl(ref, t) })
  }
  return out
}

/** The `om://` URL MapLibre requests: the file, the variable, and the theme's palette. */
export function aromeSourceUrl(frame: AromeFrame, dark: boolean): string {
  return `om://${frame.url}?variable=${AROME_VARIABLE}${dark ? '&dark=true' : ''}`
}
