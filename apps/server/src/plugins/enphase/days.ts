import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { EnergyDay } from '@kasbah/shared'
import { writeFileAtomic } from '../../core/atomic-file'
import type { PluginEnergyDays } from '../../core/plugin'

// Daily energy totals of the site: what the week, month, year and lifetime views add up.
//
// Two sources. The VENDOR's history (`GET /pv/systems/{site}/lifetime_energy`, Enlighten's private
// API, one call for every day since commissioning), fetched once when the history is empty and
// again only on request (the "Resync" button). And what the server MEASURES while it runs: the
// gateway's day counters for production and consumption (exact), the power readings integrated
// over time for the rest (grid, battery, the shares of the house, the charger — approximate, the
// gateway keeps no reliable counter for them), the charger's session energy for the charger.
//
// Days are keyed by their LOCAL date ('YYYY-MM-DD'), not by an epoch: a day lasts 23 or 25 hours
// when the clocks change, and a date key does not care.

export const ENERGY_FIELDS = [
  'productionWh', 'consumptionWh', 'importWh', 'exportWh', 'chargeWh', 'dischargeWh',
  'solarHomeWh', 'batteryHomeWh', 'gridHomeWh', 'evseWh',
] as const
export type EnergyField = (typeof ENERGY_FIELDS)[number]
type Totals = Partial<Record<EnergyField, number>>

/** The vendor's series, by their name in `lifetime_energy`. */
const VENDOR_SERIES: Record<EnergyField, string> = {
  productionWh: 'production', consumptionWh: 'consumption', importWh: 'import', exportWh: 'export',
  chargeWh: 'charge', dischargeWh: 'discharge', solarHomeWh: 'solar_home', batteryHomeWh: 'battery_home',
  gridHomeWh: 'grid_home', evseWh: 'evse',
}

const seriesSchema = z.array(z.number().nullable()).optional()
/** `lifetime_energy`: one value per day from `start_date`, `null` = not reported. */
export const lifetimeEnergySchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Last report the cloud received (epoch SECONDS): the days from then on may still be incomplete. */
  last_report_date: z.number().optional(),
}).catchall(z.unknown()).transform((raw) => ({
  start: raw.start_date,
  lastReportAt: raw.last_report_date !== undefined ? raw.last_report_date * 1000 : undefined,
  series: Object.fromEntries(ENERGY_FIELDS.map((f) => {
    const parsed = seriesSchema.safeParse(raw[VENDOR_SERIES[f]])
    return [f, parsed.success ? parsed.data ?? [] : []]
  })) as Record<EnergyField, (number | null)[]>,
}))
export type LifetimeEnergy = z.output<typeof lifetimeEnergySchema>

const storedDaySchema = z.object({
  source: z.enum(['vendor', 'local']),
  /** Vendor day taken although the cloud had not received all of it yet. */
  partial: z.boolean().optional(),
  /** Local day: how long the power readings covered, to tell a whole day from a partial one. */
  coveredMs: z.number().optional(),
  /** Local day: the gateway's day counters, which win over the integration. */
  counters: z.object({ productionWh: z.number().optional(), consumptionWh: z.number().optional() }).optional(),
  ...Object.fromEntries(ENERGY_FIELDS.map((f) => [f, z.number().optional()])) as Record<EnergyField, z.ZodOptional<z.ZodNumber>>,
})
type StoredDay = z.infer<typeof storedDaySchema>

const daysFileSchema = z.object({
  version: z.literal(1),
  since: z.string().nullable(),
  syncedAt: z.number().nullable(),
  days: z.record(z.string(), storedDaySchema),
})
type DaysFile = z.infer<typeof daysFileSchema>

export interface SitePower { productionW?: number; consumptionW?: number; gridW?: number; batteryW?: number }
export interface DayCounters { todayProductionWh?: number; todayConsumptionWh?: number }

/** The gateway may not have reset its day counters yet a little after midnight. */
const LATE_COUNTER_MS = 15 * 60_000
/** A past local day covered for less than its length minus this is partial. */
const PARTIAL_SLACK_MS = 30 * 60_000
const HOUR_MS = 3_600_000

export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** Local midnight of a day key. */
export function keyStart(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).getTime()
}
/**
 * Where a past day stands: `c` complete (Enphase gave it, or the server watched it whole), `p`
 * incomplete (the server missed part of it, or the cloud had not received all of it yet), `m`
 * missing, `e` known empty (Enphase was asked and has nothing for it — the days of commissioning,
 * before the inverters reported). A resync only takes again what is incomplete or missing.
 */
export type DayStatus = 'c' | 'e' | 'p' | 'm'

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return dayKey(new Date(y, m - 1, d + n).getTime())
}

export interface EnergyDaysOptions {
  /** Longest gap between two site readings still integrated (beyond, the span is not counted). */
  siteGapMs: number
}

export class EnergyDays {
  private data: DaysFile = { version: 1, since: null, syncedAt: null, days: {} }
  private site: { at: number; power: Required<SitePower> } | null = null
  /** Each charger's last session energy. */
  private readonly chargers = new Map<string, number>()
  /** Each day counter's last reading, and the day it was given to. */
  private readonly lastCounters = new Map<keyof DayCounters, { key: string; value: number }>()
  /** Something changed since the last save. */
  dirty = false

  constructor(private readonly opts: EnergyDaysOptions) {}

  /** Restores a saved history; an unreadable one is ignored (the caller logs it). */
  restore(raw: unknown): boolean {
    const parsed = daysFileSchema.safeParse(raw)
    if (!parsed.success) return false
    this.data = parsed.data
    return true
  }
  toJSON(): DaysFile { return this.data }

  /** No day from the vendor yet: the history must be fetched. */
  get synced(): boolean { return this.data.syncedAt !== null }
  /** First day of operation, as Enphase gave it. */
  get sinceKey(): string | null { return this.data.since }

  /** A local day the server did not watch whole: before today, the whole day; today, since midnight. */
  private partialLocal(key: string, d: StoredDay, now: number): boolean {
    const today = dayKey(now)
    const t = keyStart(key)
    const seen = key < today ? keyStart(addDays(key, 1)) - t : now - t
    return key <= today && (d.coveredMs ?? 0) < seen - PARTIAL_SLACK_MS
  }

  dayStatus(key: string, now: number): DayStatus {
    const d = this.data.days[key]
    if (!d) return 'm'
    const partial = d.source === 'local' ? this.partialLocal(key, d, now) : !!d.partial
    return partial ? 'p' : 'c'
  }

  private day(key: string): StoredDay {
    let d = this.data.days[key]
    if (!d) { d = { source: 'local' }; this.data.days[key] = d }
    return d
  }

  private add(key: string, totals: Totals, coveredMs: number): void {
    const d = this.day(key)
    if (d.source !== 'local') return
    for (const f of ENERGY_FIELDS) {
      const v = totals[f]
      if (v !== undefined && v > 0) d[f] = (d[f] ?? 0) + v
    }
    d.coveredMs = (d.coveredMs ?? 0) + coveredMs
    this.dirty = true
  }

  /** Spreads a span over the days it crosses, at constant power. */
  private spread(from: number, to: number, perHour: (hours: number) => Totals): void {
    let at = from
    while (at < to) {
      const key = dayKey(at)
      const end = Math.min(to, keyStart(addDays(key, 1)))
      this.add(key, perHour((end - at) / HOUR_MS), end - at)
      at = end
    }
  }

  /**
   * A real-time reading of the site. The span since the previous reading is counted at the
   * PREVIOUS power (what flowed until now). A patch may carry only some fields: the others keep
   * their last value.
   */
  recordSite(power: SitePower, at: number): void {
    const prev = this.site
    const merged: Required<SitePower> = {
      productionW: power.productionW ?? prev?.power.productionW ?? 0,
      consumptionW: power.consumptionW ?? prev?.power.consumptionW ?? 0,
      gridW: power.gridW ?? prev?.power.gridW ?? 0,
      batteryW: power.batteryW ?? prev?.power.batteryW ?? 0,
    }
    if (prev && at > prev.at && at - prev.at <= this.opts.siteGapMs) {
      const p = prev.power
      // the same balance as the flow diagram's ring: consumption = production + grid − battery
      const fromGrid = Math.max(0, p.gridW)
      const fromBattery = Math.max(0, -p.batteryW)
      const fromSolar = Math.min(Math.max(0, p.productionW), Math.max(0, p.consumptionW - fromGrid - fromBattery))
      this.spread(prev.at, at, (h) => ({
        productionWh: Math.max(0, p.productionW) * h,
        consumptionWh: Math.max(0, p.consumptionW) * h,
        importWh: fromGrid * h,
        exportWh: Math.max(0, -p.gridW) * h,
        chargeWh: Math.max(0, p.batteryW) * h,
        dischargeWh: fromBattery * h,
        solarHomeWh: fromSolar * h,
        batteryHomeWh: fromBattery * h,
        gridHomeWh: fromGrid * h,
      }))
    }
    this.site = { at, power: merged }
  }

  /**
   * A charger's session energy. The cloud gives the charger no power, only what the current
   * session delivered: the day gets what it grew by since the last reading, and a value that drops
   * is a new session, which counts from zero.
   */
  recordChargerSession(serial: string, sessionWh: number, at: number): void {
    const prev = this.chargers.get(serial)
    this.chargers.set(serial, sessionWh)
    if (prev === undefined) return
    const delta = sessionWh >= prev ? sessionWh - prev : sessionWh
    if (delta > 0) this.add(dayKey(at), { evseWh: delta }, 0)
  }

  /**
   * The gateway's day counters. Read a little after midnight, they may still carry yesterday's
   * total: a value that did not drop below yesterday's last one, in the first minutes, is
   * yesterday's.
   */
  recordCounters(c: DayCounters, at: number): void {
    const key = dayKey(at)
    const yesterday = addDays(key, -1)
    const early = at - keyStart(key) < LATE_COUNTER_MS
    for (const [counter, field] of [['todayProductionWh', 'productionWh'], ['todayConsumptionWh', 'consumptionWh']] as const) {
      const v = c[counter]
      if (v === undefined) continue
      const last = this.lastCounters.get(counter)
      const target = early && last?.key === yesterday && v >= last.value ? yesterday : key
      this.lastCounters.set(counter, { key: target, value: v })
      const d = this.day(target)
      if (d.source !== 'local') continue
      d.counters = { ...d.counters, [field]: v }
      this.dirty = true
    }
  }

  /**
   * Takes the vendor's history. Every day before the last complete one replaces what the server
   * measured; from the cloud's last report on, a local day wins (the cloud may not have all of it
   * yet), and a vendor day is only taken where nothing local exists, marked partial. Today stays
   * local whatever happens: the gateway sees it better than the cloud.
   *
   * `onlyIncomplete`: a day already complete is left as it is — the "smart" resync, which takes
   * again only what is missing or partial.
   */
  importVendor(v: LifetimeEnergy, now: number, opts: { onlyIncomplete?: boolean } = {}): { days: number; since: string } {
    const today = dayKey(now)
    const complete = v.lastReportAt !== undefined ? dayKey(v.lastReportAt) : today
    const length = Math.max(0, ...ENERGY_FIELDS.map((f) => v.series[f].length))
    let count = 0
    for (let i = 0; i < length; i++) {
      const key = addDays(v.start, i)
      if (key >= today) break
      const totals: Totals = {}
      for (const f of ENERGY_FIELDS) {
        const value = v.series[f][i]
        if (typeof value === 'number' && value >= 0) totals[f] = Math.round(value)
      }
      if (Object.keys(totals).length === 0) continue
      const existing = this.data.days[key]
      if (opts.onlyIncomplete && this.dayStatus(key, now) === 'c') continue
      const trusted = key < complete
      if (!trusted && existing?.source === 'local') continue
      this.data.days[key] = { source: 'vendor', ...(trusted ? {} : { partial: true }), ...totals }
      count++
    }
    this.data.since = v.start
    this.data.syncedAt = now
    this.dirty = true
    return { days: count, since: v.start }
  }

  snapshot(now: number): PluginEnergyDays {
    const days: EnergyDay[] = Object.keys(this.data.days).sort().map((key) => {
      const d = this.data.days[key]!
      const t = keyStart(key)
      const out: EnergyDay = { t, source: d.source }
      for (const f of ENERGY_FIELDS) if (d[f] !== undefined) out[f] = Math.round(d[f]!)
      if (d.source === 'local') {
        if (d.counters?.productionWh !== undefined) out.productionWh = Math.round(d.counters.productionWh)
        if (d.counters?.consumptionWh !== undefined) out.consumptionWh = Math.round(d.counters.consumptionWh)
        // a past day must have been seen whole; today, since midnight (a restart at noon leaves its
        // integrated fields short of the gateway's day counters)
        if (this.partialLocal(key, d, now)) out.partial = true
      } else if (d.partial) out.partial = true
      return out
    })
    return { since: this.data.since ? keyStart(this.data.since) : null, syncedAt: this.data.syncedAt, days }
  }
}

/** The history's file under `.state/`, written atomically. */
export interface DaysStore {
  load(days: EnergyDays): Promise<void>
  save(days: EnergyDays): Promise<void>
}

export function createDaysFile(path: string, logger?: Logger): DaysStore {
  return {
    async load(days) {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return }
      let json: unknown = null
      try { json = JSON.parse(raw) } catch { /* reported below */ }
      if (!days.restore(json)) logger?.warn({ path }, 'unreadable Enphase energy history, starting a new one')
    },
    async save(days) {
      try { await writeFileAtomic(path, `${JSON.stringify(days)}\n`); days.dirty = false }
      catch (err) { logger?.warn({ err, path }, 'could not write the Enphase energy history') }
    },
  }
}
