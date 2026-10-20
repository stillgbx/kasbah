import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'

// LIGHT history of the solar shutters: the maximum reached per hour and per day, the month being
// derived from the days. The local API serves none (the Somfy app's hour / day / month graph comes
// from the cloud): so it is built HERE, as the box's events come in.
//
// The MAXIMUM and not an average: it is what the app shows ("4,000 lx yesterday"), and it is exact
// without sampling — the box only emits `core:LuminanceState` when the value changes, so between two
// frames the luminance is the previous one's. Hence the carry-over: an hour without a frame (night,
// a steady sky) is worth the last known value, provided THIS process saw it the whole time. An hour
// when the server was not running stays ABSENT, never at zero.

const HOUR_MS = 3_600_000
/** Two days of hours: enough to show "the last 24 h" at any hour. */
export const HOURLY_POINTS_MAX = 48
/** Thirteen months of days: the monthly view covers the past year, current month included. */
export const DAILY_POINTS_MAX = 400

export const lightPointSchema = z.object({
  /** Start of the step (ms epoch): full hour, or local midnight. */
  t: z.number().int(),
  /** Highest luminance seen in this step, in lux. */
  maxLux: z.number().min(0),
})
export type LightPoint = z.infer<typeof lightPointSchema>

const seriesSchema = z.object({ hourly: z.array(lightPointSchema), daily: z.array(lightPointSchema) })
type Series = z.infer<typeof seriesSchema>

export const lightHistorySchema = z.object({
  /** By sensor `externalId`. */
  sensors: z.record(z.string(), seriesSchema),
})
export type LightHistoryState = z.infer<typeof lightHistorySchema>

export interface LightSnapshot { hourly: LightPoint[]; daily: LightPoint[]; monthly: LightPoint[] }

const hourStart = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS
const nextHour = (t: number): number => t + HOUR_MS
function dayStart(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}
function nextDay(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}
function monthStart(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Raises the maximum of step `t` to at least `lux` (opening the step if needed). @returns step opened. */
function bump(points: LightPoint[], t: number, lux: number, max: number): boolean {
  const last = points[points.length - 1]
  if (last && last.t === t) { if (lux > last.maxLux) last.maxLux = lux; return false }
  if (last && last.t > t) return false                      // clock going backwards: we do not write the past
  points.push({ t, maxLux: lux })
  if (points.length > max) points.splice(0, points.length - max)
  return true
}

/** Carries `lux` over each step from `from` to `to` inclusive — the value has not changed in between. */
function carry(points: LightPoint[], from: number, to: number, next: (t: number) => number, lux: number, max: number): boolean {
  let opened = false
  for (let t = from; t <= to; t = next(t)) opened = bump(points, t, lux, max) || opened
  return opened
}

export class LightHistory {
  private readonly series = new Map<string, Series>()
  /** Last value seen BY THIS PROCESS, and since when: the only honest basis for a carry-over. */
  private readonly live = new Map<string, { lux: number; since: number }>()

  constructor(initial?: LightHistoryState | null) {
    for (const [id, s] of Object.entries(initial?.sensors ?? {})) {
      this.series.set(id, { hourly: s.hourly.map((p) => ({ ...p })), daily: s.daily.map((p) => ({ ...p })) })
    }
  }

  /** A luminance read (setup or frame). @returns `true` when a new hour has opened. */
  record(id: string, lux: number, at: number): boolean {
    let s = this.series.get(id)
    if (!s) { s = { hourly: [], daily: [] }; this.series.set(id, s) }
    const opened = this.advanceOne(id, s, at)
    const h = bump(s.hourly, hourStart(at), lux, HOURLY_POINTS_MAX)
    bump(s.daily, dayStart(at), lux, DAILY_POINTS_MAX)
    this.live.set(id, { lux, since: at })
    return opened || h
  }

  /** Carries the last known value over up to `at`, for all sensors. @returns hour opened. */
  advance(at: number): boolean {
    let opened = false
    for (const [id, s] of this.series) opened = this.advanceOne(id, s, at) || opened
    return opened
  }

  snapshot(id: string, at: number): LightSnapshot | undefined {
    const s = this.series.get(id)
    if (!s) return undefined
    this.advanceOne(id, s, at)
    const hourly = s.hourly.filter((p) => p.t > hourStart(at) - HOURLY_POINTS_MAX * HOUR_MS)
    const monthly: LightPoint[] = []
    for (const p of s.daily) {
      const m = monthStart(p.t)
      const last = monthly[monthly.length - 1]
      if (last && last.t === m) last.maxLux = Math.max(last.maxLux, p.maxLux)
      else monthly.push({ t: m, maxLux: p.maxLux })
    }
    return { hourly: hourly.map((p) => ({ ...p })), daily: s.daily.map((p) => ({ ...p })), monthly }
  }

  toState(): LightHistoryState {
    const sensors: LightHistoryState['sensors'] = {}
    for (const [id, s] of this.series) sensors[id] = { hourly: s.hourly.map((p) => ({ ...p })), daily: s.daily.map((p) => ({ ...p })) }
    return { sensors }
  }

  private advanceOne(id: string, s: Series, at: number): boolean {
    const prev = this.live.get(id)
    if (!prev || at <= prev.since) return false
    const opened = carry(s.hourly, hourStart(prev.since), hourStart(at), nextHour, prev.lux, HOURLY_POINTS_MAX)
    carry(s.daily, dayStart(prev.since), dayStart(at), nextDay, prev.lux, DAILY_POINTS_MAX)
    this.live.set(id, { lux: prev.lux, since: at })
    return opened
  }
}

export interface LightHistoryStore {
  load(): Promise<LightHistoryState | null>
  save(h: LightHistoryState): Promise<void>
}

/** Atomic write (temporary file then rename); an unreadable read counts as "nothing". */
export function createLightHistoryFile(path: string, logger?: Logger): LightHistoryStore {
  return {
    async load() {
      try {
        const parsed = lightHistorySchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'TaHoma light history file is unreadable, starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(h) {
      try { await writeFileAtomic(path, JSON.stringify(h)) }
      catch (err) { logger?.warn({ err, path }, 'could not write the TaHoma light history file') }
    },
  }
}
