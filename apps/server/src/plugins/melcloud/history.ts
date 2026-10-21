import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SystemReading, ZoneReading } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// The heat pump's OPERATING history — when it heated, for how long, at what flow temperature,
// against what outdoor temperature.
//
// It is built HERE, poll after poll, and not read from the vendor: MELCloud does serve an energy
// report, but this installation has no meter and returns it empty even over a whole winter (see
// `__fixtures__/melcloud.ts`). What we can know, on the other hand, is what each read shows — and
// one read a minute is enough to tell the essentials of a quantity as slow as heating.
//
// Each point carries SAMPLE COUNTS, not minutes: `n` gives the scale, and a poorly polled hour
// (server restarted, silent cloud) then reads as what it is — an hour with three samples — instead
// of passing for an idle hour.

/** One week of hours: the fine grain, for the 48 h and week views. */
export const HOURLY_POINTS_MAX = 168
/**
 * Thirteen months of days, for the month and year views (asked for on 2026-10-21): a year to
 * compare with itself, a month more to see the same month last year. ~400 small objects.
 */
export const DAILY_POINTS_MAX = 400
const HOUR_MS = 3_600_000
/** Local midnight: a day is the house's day, not a UTC one. */
const dayStart = (at: number): number => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime() }

export const heatingPointSchema = z.object({
  /** Start of the hour (ms epoch). */
  t: z.number().int(),
  /** Samples taken in this hour: the scale of all the counters that follow. */
  n: z.number().int().min(1),
  /** Samples where AT LEAST ONE zone was heating (neither idle nor off). */
  heating: z.number().int().min(0),
  /** Samples in defrost: the machine runs and does not heat the house. */
  defrost: z.number().int().min(0),
  /** Samples with an ELECTRIC backup heater on — what costs a lot shows up here. */
  booster: z.number().int().min(0),
  outdoorC: z.number().nullable(),
  flowC: z.number().nullable(),
  returnC: z.number().nullable(),
})
export type HeatingPoint = z.infer<typeof heatingPointSchema>

export const melcloudHistorySchema = z.object({
  /** From oldest to most recent, one point per polled hour. An hour without a read is ABSENT. */
  hourly: z.array(heatingPointSchema),
  /**
   * Same counters per DAY (`t` = local midnight). Absent from the files written before it: it is
   * then rebuilt from the hours at hand.
   */
  daily: z.array(heatingPointSchema).optional(),
})
export type MelcloudHistoryState = z.infer<typeof melcloudHistorySchema>

interface Bucket {
  t: number
  n: number
  heating: number
  defrost: number
  booster: number
  outdoor: { sum: number; n: number }
  flow: { sum: number; n: number }
  ret: { sum: number; n: number }
}

const mean = (a: { sum: number; n: number }): number | null => (a.n ? Math.round((a.sum / a.n) * 10) / 10 : null)

/**
 * Hourly accumulator. No hidden state: `record` files the sample into its hour, `points` returns
 * what we have. The hour rollover is observable (`rolled`) so that the caller knows when it is
 * worth writing to disk — once an hour rather than on every poll.
 */
export class HeatingHistory {
  private buckets: Bucket[] = []
  private days: Bucket[] = []

  constructor(initial?: MelcloudHistoryState | null) {
    if (!initial) return
    this.buckets = initial.hourly.map(fromPoint)
    this.days = initial.daily ? initial.daily.map(fromPoint) : daysOf(this.buckets)
  }

  /** @returns `true` when this sample opened a new hour. */
  record(system: SystemReading, zones: ZoneReading[], at: number): boolean {
    const hour = Math.floor(at / HOUR_MS) * HOUR_MS
    let b = this.buckets[this.buckets.length - 1]
    let rolled = false
    if (!b || b.t !== hour) {
      // a machine we no longer follow teaches nothing: do not open an hour for it
      if (system.stale) return false
      b = emptyBucket(hour)
      this.buckets.push(b)
      rolled = true
      while (this.buckets.length > HOURLY_POINTS_MAX) this.buckets.shift()
    }
    if (system.stale) return rolled

    const day = dayStart(at)
    let d = this.days[this.days.length - 1]
    if (!d || d.t !== day) {
      d = emptyBucket(day)
      this.days.push(d)
      while (this.days.length > DAILY_POINTS_MAX) this.days.shift()
    }
    fill(b, system, zones)
    fill(d, system, zones)
    return rolled
  }

  points(): HeatingPoint[] {
    return toPoints(this.buckets)
  }

  dailyPoints(): HeatingPoint[] {
    return toPoints(this.days)
  }

  toState(): MelcloudHistoryState {
    return { hourly: this.points(), daily: this.dailyPoints() }
  }
}

const emptyBucket = (t: number): Bucket => ({ t, n: 0, heating: 0, defrost: 0, booster: 0, outdoor: { sum: 0, n: 0 }, flow: { sum: 0, n: 0 }, ret: { sum: 0, n: 0 } })

/** One sample into a bucket (an hour or a day: the same counters). */
function fill(b: Bucket, system: SystemReading, zones: ZoneReading[]): void {
  b.n++
  // `idle` is the key: the machine is ON almost all year round, it only heats at times.
  // Counting `power` would amount to drawing a flat line from January to December. And the
  // machine's own `heating` (`OperationMode`) counts too: on a cascade, the zones stay "idle"
  // while the units run.
  if (system.power && (system.heating || zones.some((z) => !z.idle))) b.heating++
  if (system.defrosting) b.defrost++
  if (system.boosterHeater || system.immersionHeater) b.booster++
  add(b.outdoor, system.outdoorTempC)
  add(b.flow, system.flowTempC)
  add(b.ret, system.returnTempC)
}

function toPoints(buckets: Bucket[]): HeatingPoint[] {
  return buckets.filter((b) => b.n > 0).map((b) => ({
    t: b.t,
    n: b.n,
    heating: b.heating,
    defrost: b.defrost,
    booster: b.booster,
    outdoorC: mean(b.outdoor),
    flowC: mean(b.flow),
    returnC: mean(b.ret),
  }))
}

/** Days rebuilt from hours (a file written before the daily series existed). */
function daysOf(hours: Bucket[]): Bucket[] {
  const out: Bucket[] = []
  for (const h of hours) {
    const t = dayStart(h.t)
    let d = out[out.length - 1]
    if (!d || d.t !== t) { d = emptyBucket(t); out.push(d) }
    d.n += h.n; d.heating += h.heating; d.defrost += h.defrost; d.booster += h.booster
    for (const k of ['outdoor', 'flow', 'ret'] as const) { d[k].sum += h[k].sum; d[k].n += h[k].n }
  }
  return out
}

function add(acc: { sum: number; n: number }, v: number | null): void {
  if (v !== null) { acc.sum += v; acc.n++ }
}

/**
 * A point read back from disk becomes a bucket again. The means have lost their sums: they are put
 * back weighted by the point's samples, which keeps the value right and lets the rest of the hour
 * — or of the DAY, where one sample would weigh nothing against a thousand — correct it in
 * proportion. We only read back at startup, so at most one partial hour and one partial day.
 */
function fromPoint(p: HeatingPoint): Bucket {
  const one = (v: number | null) => (v === null ? { sum: 0, n: 0 } : { sum: v * p.n, n: p.n })
  return {
    t: p.t, n: p.n, heating: p.heating, defrost: p.defrost, booster: p.booster,
    outdoor: one(p.outdoorC), flow: one(p.flowC), ret: one(p.returnC),
  }
}

export interface HistoryStore {
  load(): Promise<MelcloudHistoryState | null>
  save(h: MelcloudHistoryState): Promise<void>
}

/** Atomic write (temporary file then rename); an unreadable read counts as "nothing". */
export function createHistoryFile(path: string, logger?: Logger): HistoryStore {
  return {
    async load() {
      try {
        const parsed = melcloudHistorySchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'MELCloud history file is unreadable (or from an older version), starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(h) {
      try { await writeFileAtomic(path, JSON.stringify(h, null, 2)) }
      catch (err) { logger?.warn({ err, path }, 'could not write the MELCloud history file') }
    },
  }
}
