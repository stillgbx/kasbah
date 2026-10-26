import type { DeviceEnergyDays, EnergyDay, StateFor } from '@kasbah/shared'
import { bucketSlots, type PeriodMode } from './consumption'

/**
 * The periods of the Energy view. `instant` and `day` read the live state (and the hourly history
 * of the day); the others add up the site's daily totals (`GET /api/devices/:id/energy-days`).
 * `week`, `month` and `year` are cut rolling or calendar (`PeriodMode`); `lifetime` runs from the
 * first day the vendor knows, by month, and does not care for the mode.
 */
export type EnergyPeriod = 'instant' | 'day' | 'week' | 'month' | 'year' | 'lifetime'
export const ENERGY_PERIODS: readonly EnergyPeriod[] = ['instant', 'day', 'week', 'month', 'year', 'lifetime']
/** The periods whose cut the rolling / calendar mode changes. */
export const MODE_PERIODS: readonly EnergyPeriod[] = ['week', 'month', 'year']

export const ENERGY_FIELDS = [
  'productionWh', 'consumptionWh', 'importWh', 'exportWh', 'chargeWh', 'dischargeWh',
  'solarHomeWh', 'batteryHomeWh', 'gridHomeWh', 'evseWh',
] as const
export type EnergyField = (typeof ENERGY_FIELDS)[number]

/**
 * What flowed over a period. A field no day of the period carries stays absent, not zero.
 * `incomplete`: a day of the period is partial or missing — the totals fall short.
 */
export type EnergyTotals = Partial<Record<EnergyField, number>> & { incomplete: boolean }

const midnight = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d }

/** First day a period counts (local midnight). */
export function periodStart(period: EnergyPeriod, mode: PeriodMode, now: number, since: number | null): number {
  const d = midnight(now)
  switch (period) {
    case 'instant':
    case 'day': break
    case 'week': d.setDate(d.getDate() - (mode === 'calendar' ? (d.getDay() + 6) % 7 : 6)); break
    case 'month': if (mode === 'calendar') d.setDate(1); else d.setDate(d.getDate() - 30); break
    case 'year': if (mode === 'calendar') d.setMonth(0, 1); else { d.setDate(1); d.setMonth(d.getMonth() - 11) } break
    case 'lifetime': return since ?? Number.NEGATIVE_INFINITY
  }
  return d.getTime()
}

/**
 * Today's day with the live counters of the gateway: they are fresher than the server's last
 * snapshot for production and consumption.
 */
function withLive(days: readonly EnergyDay[], now: number, live: StateFor<'energy'> | undefined): EnergyDay[] {
  const today = midnight(now).getTime()
  if (!live || (live.todayProductionWh === undefined && live.todayConsumptionWh === undefined)) return [...days]
  const found = days.find((d) => d.t === today)
  const patched: EnergyDay = {
    ...(found ?? { t: today, source: 'local' as const }),
    ...(live.todayProductionWh !== undefined ? { productionWh: live.todayProductionWh } : {}),
    ...(live.todayConsumptionWh !== undefined ? { consumptionWh: live.todayConsumptionWh } : {}),
  }
  return found ? days.map((d) => (d === found ? patched : d)) : [...days, patched]
}

/** Number of calendar days from one local midnight to another, both included. */
function daysBetween(from: number, to: number): number {
  let n = 0
  for (const d = new Date(from); d.getTime() <= to; d.setDate(d.getDate() + 1)) n++
  return n
}

export function periodTotals(
  days: readonly EnergyDay[], period: EnergyPeriod, mode: PeriodMode, now: number,
  since: number | null, live?: StateFor<'energy'>,
): EnergyTotals {
  const all = withLive(days, now, live)
  const today = midnight(now).getTime()
  const from = periodStart(period, mode, now, since)
  const inside = all.filter((d) => d.t >= from && d.t <= today)
  const totals: EnergyTotals = { incomplete: false }
  for (const d of inside) {
    for (const f of ENERGY_FIELDS) {
      const v = d[f]
      if (v !== undefined) totals[f] = (totals[f] ?? 0) + v
    }
  }
  // days missing from the period, counted from the first day anything is known: before it, there
  // was nothing to measure
  const first = all.length ? Math.max(from, all[0]!.t) : today
  totals.incomplete = inside.some((d) => d.partial) || inside.length < daysBetween(first, today)
  return totals
}

/** A bar of the production chart: `wh` null = never measured; `future` = a step still to come. */
export interface EnergyBar { t: number; wh: number | null; future: boolean }

/** Days summed into calendar months (local). */
function byMonth(days: readonly EnergyDay[]): { t: number; litres: number }[] {
  const out: { t: number; litres: number }[] = []
  for (const d of days) {
    if (d.productionWh === undefined) continue
    const m = new Date(d.t); m.setDate(1); m.setHours(0, 0, 0, 0)
    const last = out[out.length - 1]
    if (last && last.t === m.getTime()) last.litres += d.productionWh
    else out.push({ t: m.getTime(), litres: d.productionWh })
  }
  return out
}

/**
 * Production per step of the period: days for the week and the month, months for the year and the
 * lifetime. Reuses the steps of the water chart (`bucketSlots`), which carry a number per step.
 */
export function periodBars(
  days: readonly EnergyDay[], period: 'week' | 'month' | 'year' | 'lifetime', mode: PeriodMode, now: number,
  since: number | null, live?: StateFor<'energy'>,
): EnergyBar[] {
  const all = withLive(days, now, live)
  const future = (t: number) => t > now
  if (period === 'week' || period === 'month') {
    const points = all.flatMap((d) => (d.productionWh !== undefined ? [{ t: d.t, litres: d.productionWh }] : []))
    return bucketSlots(points, period, now, mode).map((s) => ({ t: s.t, wh: s.litres, future: future(s.t) }))
  }
  const months = byMonth(all)
  if (period === 'year') return bucketSlots(months, 'year', now, mode).map((s) => ({ t: s.t, wh: s.litres, future: future(s.t) }))
  // lifetime: every month from the first one known to the current one
  const start = new Date(since ?? all[0]?.t ?? now); start.setDate(1); start.setHours(0, 0, 0, 0)
  const bars: EnergyBar[] = []
  for (const m = start; m.getTime() <= now; m.setMonth(m.getMonth() + 1)) {
    const hit = months.find((p) => p.t === m.getTime())
    bars.push({ t: m.getTime(), wh: hit ? hit.litres : null, future: false })
  }
  return bars
}

/**
 * What each micro-inverter produced over the period (`externalId` → Wh), `null` when none of its
 * days in the period was measured. The lifetime is its own counter when the gateway gives it: exact
 * even where days are missing.
 */
export function inverterTotals(
  inv: DeviceEnergyDays['inverters'], period: EnergyPeriod, mode: PeriodMode, now: number, since: number | null,
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  if (!inv) return out
  const from = periodStart(period, mode, now, since)
  const today = midnight(now).getTime()
  for (const d of inv.devices) {
    if (period === 'lifetime' && d.lifetimeWh !== undefined) { out.set(d.externalId, d.lifetimeWh); continue }
    let sum: number | null = null
    const day = new Date(inv.from)
    for (const v of d.wh) {
      const t = day.getTime()
      if (v !== null && t >= from && t <= today) sum = (sum ?? 0) + v
      day.setDate(day.getDate() + 1)
    }
    out.set(d.externalId, sum)
  }
  return out
}

/**
 * Each inverter's record over the period: its highest daily peak (W), `null` = no peak known. A
 * quarter-hour average for every day, so the record of a day and that of a year compare.
 */
export function inverterPeaks(
  inv: DeviceEnergyDays['inverters'], period: EnergyPeriod, mode: PeriodMode, now: number, since: number | null,
): Map<string, number | null> {
  const out = new Map<string, number | null>()
  if (!inv) return out
  const from = periodStart(period, mode, now, since)
  const today = midnight(now).getTime()
  for (const d of inv.devices) {
    let max: number | null = null
    const day = new Date(inv.from)
    for (const v of d.peakW ?? []) {
      const t = day.getTime()
      if (v !== null && t >= from && t <= today && (max === null || v > max)) max = v
      day.setDate(day.getDate() + 1)
    }
    out.set(d.externalId, max)
  }
  return out
}

/**
 * The whole history `full` brought up to date with its last days `recent` (`getEnergyDays(id, n)`):
 * what `recent` holds replaces `full` from its first day on. `null` when the two do not fit — a
 * resync rewrote the past (`syncedAt`), an inverter appeared, the days do not line up (the day
 * changed in between) —: the caller then reloads the whole history.
 */
export function mergeRecentDays(full: DeviceEnergyDays, recent: DeviceEnergyDays): DeviceEnergyDays | null {
  if (full.since !== recent.since || full.syncedAt !== recent.syncedAt) return null
  const byDay = new Map(full.days.map((d) => [d.t, d]))
  for (const d of recent.days) byDay.set(d.t, d)
  const days = [...byDay.values()].sort((a, b) => a.t - b.t)
  const fi = full.inverters, ri = recent.inverters
  if (!fi && !ri) return { ...recent, days }
  if (!fi || !ri || fi.syncedAt !== ri.syncedAt) return null
  // where `recent` starts in `full`, in calendar days like `inverterTotals`
  const day = new Date(fi.from)
  let k = 0
  while (day.getTime() < ri.from) { day.setDate(day.getDate() + 1); k++ }
  if (day.getTime() !== ri.from) return null
  const held = new Map(fi.devices.map((v) => [v.externalId, v]))
  const devices: NonNullable<DeviceEnergyDays['inverters']>['devices'] = []
  for (const v of ri.devices) {
    const o = held.get(v.externalId)
    if (!o || o.wh.length < k || !o.peakW !== !v.peakW) return null
    devices.push({ ...v, wh: [...o.wh.slice(0, k), ...v.wh], ...(v.peakW ? { peakW: [...o.peakW!.slice(0, k), ...v.peakW] } : {}) })
  }
  return { ...recent, days, inverters: { ...ri, from: fi.from, devices } }
}

/**
 * A unit shared by a set of energies (the cells of an array): chosen from the largest, so the cells
 * hold a bare number and the unit is written once. `digits` keeps three significant figures.
 */
export function energyUnit(maxWh: number): { unit: 'Wh' | 'kWh' | 'MWh'; div: number; digits: number } {
  if (maxWh >= 1_000_000) return { unit: 'MWh', div: 1_000_000, digits: 2 }
  if (maxWh >= 100_000) return { unit: 'kWh', div: 1000, digits: 0 }
  if (maxWh >= 1000) return { unit: 'kWh', div: 1000, digits: 1 }
  return { unit: 'Wh', div: 1, digits: 0 }
}

/**
 * An energy over a period: kWh with one decimal up to 100 kWh, whole kWh up to 1 MWh, then MWh —
 * two decimals up to 10 MWh, one beyond (asked on 2026-10-25). A year of production in
 * "9 231,0 kWh" was too wide for a node of the flow diagram.
 */
export function formatEnergyTotal(wh: number, locale = 'fr'): string {
  const nf = (digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const a = Math.abs(wh)
  if (a >= 10_000_000) return `${nf(1).format(wh / 1_000_000)} MWh`
  if (a >= 1_000_000) return `${nf(2).format(wh / 1_000_000)} MWh`
  if (a >= 100_000) return `${nf(0).format(wh / 1000)} kWh`
  if (a >= 1000) return `${nf(1).format(wh / 1000)} kWh`
  return `${nf(0).format(wh)} Wh`
}
