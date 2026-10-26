import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../../core/atomic-file'
import { addDays, dayKey, keyStart, type DayStatus } from './days'

// Day by day, what each micro-inverter produced: the cells of the Energy view's arrays add up the
// period chosen. Same model as the site (`days.ts`): the GATEWAY's counters from now on, and
// Enphase's history fetched on a resync — here one call per day (`inverter_data_x/energy.json`
// only returns a sum over the range asked), spaced out by the caller.
//
// Each inverter's peak of the day comes from Enphase only (`inverter_data_x/time_series.json`, a
// quarter-hour average power): one source for every day, so the peak of a day and that of a year
// compare. Fetched a week per call on a resync, and today with yesterday every quarter of an hour.
//
// Local days come from each inverter's day counter (`/ivp/pdm/device_data`, `wattHours.today`),
// exact; its counter since commissioning (`lifetime.joulesProduced`) is served as is for the
// lifetime, which stays exact even where days are missing.

/** `/ivp/pdm/device_data`: one entry per device, the micro-inverters are `pcu`. */
export const deviceDataSchema = z.record(z.string(), z.unknown()).transform((raw) => {
  const out: { serial: string; todayWh?: number; lifetimeWh?: number }[] = []
  for (const v of Object.values(raw)) {
    const d = z.object({
      devName: z.literal('pcu'),
      sn: z.string(),
      channels: z.array(z.object({
        wattHours: z.object({ today: z.number() }).partial().optional(),
        lifetime: z.object({ joulesProduced: z.number() }).partial().optional(),
      }).passthrough()).min(1),
    }).passthrough().safeParse(v)
    if (!d.success) continue
    const ch = d.data.channels[0]!
    out.push({
      serial: d.data.sn,
      ...(ch.wattHours?.today !== undefined ? { todayWh: ch.wattHours.today } : {}),
      ...(ch.lifetime?.joulesProduced !== undefined ? { lifetimeWh: ch.lifetime.joulesProduced / 3600 } : {}),
    })
  }
  return out
})
export type DeviceData = z.output<typeof deviceDataSchema>

/** `array_layout_x`: where Enlighten says which of its inverter ids is which serial number. */
export const arrayLayoutSchema = z.object({
  arrays: z.array(z.object({
    modules: z.array(z.object({
      inverter: z.object({ inverter_id: z.union([z.number(), z.string()]), serial_num: z.string() }).optional(),
    }).passthrough()),
  }).passthrough()),
}).passthrough().transform((raw) => {
  const map = new Map<string, string>()
  for (const a of raw.arrays) for (const m of a.modules) if (m.inverter) map.set(String(m.inverter.inverter_id), m.inverter.serial_num)
  return map
})

/** `inverter_data_x/energy.json`: what each inverter (by Enlighten id) produced over the range, in Wh. */
export const inverterEnergySchema = z.object({ production: z.record(z.string(), z.number().nullable()) }).passthrough()

/**
 * `inverter_data_x/time_series.json?start_date&end_date`: day key → each inverter's (Enlighten id)
 * highest point of `POWR`, `[epoch s, W averaged over the quarter hour, 900]`. The answer also
 * carries keys that are not days (`haiku`), skipped.
 */
export function peaksOfTimeSeries(raw: unknown): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>()
  if (!raw || typeof raw !== 'object') return out
  for (const [key, day] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !day || typeof day !== 'object') continue
    const peaks: Record<string, number> = {}
    for (const [id, series] of Object.entries(day)) {
      const powr = (series as { POWR?: unknown } | null)?.POWR
      if (!Array.isArray(powr)) continue
      let max = -1
      for (const p of powr) if (Array.isArray(p) && typeof p[1] === 'number' && p[1] > max) max = p[1]
      if (max >= 0) peaks[id] = max
    }
    out.set(key, peaks)
  }
  return out
}

const fileSchema = z.object({
  version: z.literal(1),
  syncedAt: z.number().nullable(),
  /** Day key → where it comes from, and each inverter's Wh (by serial number). */
  days: z.record(z.string(), z.object({
    source: z.enum(['vendor', 'local']),
    wh: z.record(z.string(), z.number()),
    /** Vendor day: Enphase answered, with nothing for any inverter. Known, not to be asked again. */
    empty: z.boolean().optional(),
    /** Local day: when the gateway was last read that day — its counters are whole if it was near midnight. */
    lastAt: z.number().optional(),
  })),
  /** Each inverter's counter since commissioning, last read. */
  lifetimeWh: z.record(z.string(), z.number()),
  /** Day key → each inverter's peak (W, by serial number); `{}` = Enphase had nothing that day. */
  peakW: z.record(z.string(), z.record(z.string(), z.number())).default({}),
})
type InverterFile = z.infer<typeof fileSchema>

/** The gateway may not have reset its day counters yet a little after midnight. */
const LATE_COUNTER_MS = 15 * 60_000
/**
 * A local day is whole when the gateway was read this close to its end: the counters are read
 * every five minutes, a little slack covers a slow reading.
 */
const WHOLE_DAY_SLACK_MS = 20 * 60_000

export class InverterDays {
  private data: InverterFile = { version: 1, syncedAt: null, days: {}, lifetimeWh: {}, peakW: {} }
  /** Each inverter's last day counter, and the day it was given to. */
  private readonly last = new Map<string, { key: string; value: number }>()
  dirty = false

  restore(raw: unknown): boolean {
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) return false
    this.data = parsed.data
    return true
  }
  toJSON(): InverterFile { return this.data }

  get synced(): boolean { return this.data.syncedAt !== null }
  /** Whether any inverter is known at all: without one, the inverters say nothing about a day. */
  get tracked(): boolean { return Object.keys(this.data.lifetimeWh).length > 0 || Object.keys(this.data.days).length > 0 }

  /**
   * A day from Enphase is complete; a local day is when the gateway was read near its end (each
   * counter then holds the whole day, whenever the server started); otherwise partial, or missing.
   */
  dayStatus(key: string): DayStatus {
    const d = this.data.days[key]
    if (!d) return 'm'
    if (d.source === 'vendor') return d.empty ? 'e' : 'c'
    return (d.lastAt ?? 0) >= keyStart(addDays(key, 1)) - WHOLE_DAY_SLACK_MS ? 'c' : 'p'
  }

  /**
   * A gateway reading. A day counter read a little after midnight that did not drop below
   * yesterday's last value is still yesterday's (the same rule as the site's counters).
   */
  recordGateway(readings: DeviceData, at: number): void {
    const key = dayKey(at)
    const yesterday = addDays(key, -1)
    const early = at - keyStart(key) < LATE_COUNTER_MS
    for (const r of readings) {
      if (r.lifetimeWh !== undefined) { this.data.lifetimeWh[r.serial] = Math.round(r.lifetimeWh); this.dirty = true }
      if (r.todayWh === undefined) continue
      const last = this.last.get(r.serial)
      const target = early && last?.key === yesterday && r.todayWh >= last.value ? yesterday : key
      this.last.set(r.serial, { key: target, value: r.todayWh })
      let d = this.data.days[target]
      if (!d) { d = { source: 'local', wh: {} }; this.data.days[target] = d }
      if (d.source !== 'local') continue
      d.wh[r.serial] = Math.round(r.todayWh)
      d.lastAt = Math.max(d.lastAt ?? 0, target === key ? at : keyStart(key) - 1)
      this.dirty = true
    }
  }

  /**
   * One day from Enphase, its ids turned into serial numbers. Today is never taken (the gateway
   * sees it better); yesterday only where nothing local exists — the cloud may not have all of it yet.
   * A day Enphase answers with nothing is remembered as known empty, so a resync does not ask for it
   * again — except yesterday, which the cloud may simply not have received yet. Returns whether
   * values were stored.
   */
  importVendorDay(key: string, production: Record<string, number | null>, serialOf: Map<string, string>, now: number): boolean {
    const today = dayKey(now)
    if (key >= today) return false
    if (key === addDays(today, -1) && this.data.days[key]?.source === 'local') return false
    const wh: Record<string, number> = {}
    for (const [id, v] of Object.entries(production)) {
      const serial = serialOf.get(id)
      if (serial && typeof v === 'number' && v >= 0) wh[serial] = Math.round(v)
    }
    if (Object.keys(wh).length === 0) {
      if (key < addDays(today, -1) && !this.data.days[key]) {
        this.data.days[key] = { source: 'vendor', wh: {}, empty: true }
        this.dirty = true
      }
      return false
    }
    this.data.days[key] = { source: 'vendor', wh }
    this.dirty = true
    return true
  }

  /**
   * One day of peaks from Enphase, its ids turned into serial numbers. An empty answer is kept as
   * known empty only before yesterday: the cloud may not have received the recent days yet.
   */
  importVendorPeaks(key: string, peaks: Record<string, number>, serialOf: Map<string, string>, now: number): void {
    const today = dayKey(now)
    if (key > today) return
    const w: Record<string, number> = {}
    for (const [id, v] of Object.entries(peaks)) {
      const serial = serialOf.get(id)
      if (serial) w[serial] = Math.round(v)
    }
    if (Object.keys(w).length === 0 && key >= addDays(today, -1)) return
    this.data.peakW[key] = w
    this.dirty = true
  }

  /** What all the inverters produced that day (Wh), `undefined` = no inverter known that day. */
  dayWh(key: string): number | undefined {
    const wh = Object.values(this.data.days[key]?.wh ?? {})
    return wh.length > 0 ? wh.reduce((a, b) => a + b, 0) : undefined
  }

  /** An inverter's record: its best daily peak over the whole history (W), `undefined` = none known. */
  recordOf(serial: string): number | undefined {
    let max: number | undefined
    for (const day of Object.values(this.data.peakW)) {
      const w = day[serial]
      if (w !== undefined && (max === undefined || w > max)) max = w
    }
    return max
  }

  /** The days of `from`..`to` (keys, inclusive) whose peaks were never asked of Enphase. */
  peaklessDays(from: string, to: string): string[] {
    const out: string[] = []
    for (let k = from; k <= to; k = addDays(k, 1)) if (!this.data.peakW[k]) out.push(k)
    return out
  }

  markSynced(now: number): void { this.data.syncedAt = now; this.dirty = true }

  /** Day by day from the first day known to today, per inverter — the shape of the contract. */
  snapshot(now: number): {
    from: number; syncedAt: number | null
    devices: { externalId: string; lifetimeWh?: number; wh: (number | null)[]; peakW?: (number | null)[] }[]
  } | undefined {
    const keys = Object.keys(this.data.days).sort()
    const serials = new Set<string>([...Object.keys(this.data.lifetimeWh), ...keys.flatMap((k) => Object.keys(this.data.days[k]!.wh))])
    if (serials.size === 0) return undefined
    const today = dayKey(now)
    const first = keys[0] ?? today
    const span: string[] = []
    for (let k = first; k <= today; k = addDays(k, 1)) span.push(k)
    const peaks = Object.keys(this.data.peakW).length > 0
    return {
      from: keyStart(first),
      syncedAt: this.data.syncedAt,
      devices: [...serials].sort().map((serial) => ({
        externalId: serial,
        ...(this.data.lifetimeWh[serial] !== undefined ? { lifetimeWh: this.data.lifetimeWh[serial] } : {}),
        wh: span.map((k) => this.data.days[k]?.wh[serial] ?? null),
        ...(peaks ? { peakW: span.map((k) => this.data.peakW[k]?.[serial] ?? null) } : {}),
      })),
    }
  }
}

export interface InverterDaysStore {
  load(days: InverterDays): Promise<void>
  save(days: InverterDays): Promise<void>
}

export function createInverterDaysFile(path: string, logger?: Logger): InverterDaysStore {
  return {
    async load(days) {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return }
      let json: unknown = null
      try { json = JSON.parse(raw) } catch { /* reported below */ }
      if (!days.restore(json)) logger?.warn({ path }, 'unreadable Enphase inverter history, starting a new one')
    },
    async save(days) {
      try { await writeFileAtomic(path, `${JSON.stringify(days)}\n`); days.dirty = false }
      catch (err) { logger?.warn({ err, path }, 'could not write the Enphase inverter history') }
    },
  }
}
