import type { DeviceDescriptor, DeviceState, StateFor } from '@kasbah/shared'
import { mirekToKelvin } from '@kasbah/shared'

// Display formats. Translated labels go through `t`; here only numbers/units.

const nf = (locale: string, digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function formatPower(w: number, locale = 'fr'): string {
  return Math.abs(w) >= 1000 ? `${nf(locale, 1).format(w / 1000)} kW` : `${nf(locale, 0).format(w)} W`
}
/**
 * A portion, IN THE DEVICE'S UNIT (`meta.petFeeder.unit`). It is not always a mass:
 * a Fresh Element Solo counts in CUPS by tenths, an Infinity in grams. Writing "g"
 * everywhere would be off by a factor of ten on the first.
 */
export function formatFeedAmount(v: number, unit: 'cup' | 'g', locale = 'fr'): string {
  if (unit === 'g') return `${nf(locale, 0).format(v)} g`
  return `${nf(locale, 1).format(v / 10)} ${locale.startsWith('fr') ? 'tasse' : 'cup'}`
}

/**
 * The gram counterpart of a portion counted in cups — **an ESTIMATE**, hence the "~".
 * The machine weighs nothing: it counts volume, and the weight depends on the kibble. `gPerCup`
 * comes from a setting the user adjusts after weighing a portion once.
 * Nothing for a feeder that already weighs (`unit: 'g'`): repeating the same value would say nothing.
 */
export function formatFeedGrams(v: number, unit: 'cup' | 'g', gPerCup: number, locale = 'fr'): string | null {
  if (unit === 'g') return null
  return `~ ${nf(locale, 0).format((v / 10) * gPerCup)} g`
}
/** Water drunk, in milliliters up to the liter then in liters: "1.2 L" reads better than "1200 mL". */
export function formatMilliliters(ml: number, locale = 'fr'): string {
  return ml >= 1000 ? `${nf(locale, 1).format(ml / 1000)} L` : `${nf(locale, 0).format(ml)} mL`
}
export function formatEnergy(wh: number, locale = 'fr'): string {
  return Math.abs(wh) >= 1000 ? `${nf(locale, 1).format(wh / 1000)} kWh` : `${nf(locale, 0).format(wh)} Wh`
}
export const formatTemp = (c: number, locale = 'fr') => `${nf(locale, 1).format(c)} °C`
export const formatPercent = (p: number, locale = 'fr') => `${nf(locale, 0).format(p)} %`
export const formatKelvin = (mirek: number) => `${Math.round(mirekToKelvin(mirek) / 100) * 100} K`
export const formatKm = (km: number, locale = 'fr') => `${nf(locale, 0).format(km)} km`
/** Short duration, to the minute: "45 min", "1 h 20". A charge that remains is not counted in decimal hours. */
export function formatMinutes(min: number, locale = 'fr'): string {
  const total = Math.max(0, Math.round(min))
  const h = Math.floor(total / 60)
  return h === 0 ? `${nf(locale, 0).format(total)} min` : `${h} h ${String(total % 60).padStart(2, '0')}`
}

/**
 * Short relative age ("12 min ago", "3 h ago", "yesterday"), to date a reading. Below
 * a minute: "now" depending on the language (Intl, `numeric: 'auto'`). A date IN THE FUTURE is
 * brought back to now: the server's clock and the browser's differ by a few seconds,
 * and the simulation lives in accelerated time — "read in 8 min" means nothing.
 */
export function formatAgo(at: number, now: number, locale = 'fr'): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  const s = Math.min(0, Math.round((at - now) / 1000))
  if (s > -60) return rtf.format(0, 'second')
  const m = Math.round(s / 60)
  if (m > -60) return rtf.format(m, 'minute')
  const h = Math.round(m / 60)
  if (h > -24) return rtf.format(h, 'hour')
  return rtf.format(Math.round(h / 24), 'day')
}

export function formatDistance(m: number, locale = 'fr'): string {
  return m >= 1000 ? `${nf(locale, 1).format(m / 1000)} km` : `${nf(locale, 0).format(m)} m`
}

/**
 * Threshold of a full 1 m³: below this volume, two decimals of m³ would lose precision (93 L, for
 * example, needs three decimals to be written "0.093 m³" without rounding); beyond, two
 * decimals suffice and three would teach nothing (7,545 L → "7.55 m³"). Also serves to choose
 * the unit of a volume AXIS (`volumeAxisUnit`), where the liter would stay readable below.
 */
const VOLUME_M3_THRESHOLD_L = 1000

/**
 * Flow: always both units — the m³/h is that of the vendor's datasheet (2 m³/h
 * max). Three decimals, not two: the flowmeter counts in EXACT steps of 36 L/h (0.036 m³/h), a
 * constant step over its whole range (unlike volume, its resolution does not depend on the
 * measured quantity) — two decimals would already round this step and lose the information at any
 * value, not only the small ones. An EXACTLY zero flow is a measurement, not an approximation:
 * the m³/h adds nothing there, "0 L/h" is enough on its own.
 */
export function formatFlow(lph: number, locale = 'fr'): string {
  if (lph === 0) return `${nf(locale, 0).format(0)} L/h`
  return `${nf(locale, 0).format(lph)} L/h · ${nf(locale, 3).format(lph / 1000)} m³/h`
}

/**
 * The m³ complement is now ALWAYS displayed for a measured non-zero volume (no more threshold hiding
 * it): only the PRECISION adapts, so as never to write "0.00 m³" on a real value — the
 * rule "absent is not zero", applied to rounding. Three decimals below the 1 m³ threshold (any
 * volume in whole liters is then written EXACTLY, without the slightest rounding: 3 L → 0.003 m³),
 * two beyond, where one liter more or less can no longer be read. An EXACTLY zero volume stays
 * "0 L" alone: the m³ teaches nothing there.
 */
export function formatVolume(l: number, locale = 'fr'): string {
  const liters = `${nf(locale, 0).format(l)} L`
  if (l === 0) return liters
  const decimals = Math.abs(l) < VOLUME_M3_THRESHOLD_L ? 3 : 2
  return `${liters} · ${nf(locale, decimals).format(l / 1000)} m³`
}

/**
 * Unit of a volume AXIS (never both at once, unlike `formatVolume`): same threshold
 * as an isolated volume — below, the liter stays readable; beyond, ticks in liters
 * would display five digits (Year view) where the m³ fits in two or three.
 */
export type VolumeAxisUnit = 'L' | 'm³'
export function volumeAxisUnit(maxL: number): VolumeAxisUnit {
  return Math.abs(maxL) >= VOLUME_M3_THRESHOLD_L ? 'm³' : 'L'
}

/** An axis tick in the unit chosen by `volumeAxisUnit`, without the unit repeated at each value. */
export function formatVolumeAxisTick(l: number, unit: VolumeAxisUnit, locale = 'fr'): string {
  return unit === 'm³' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(l / 1000) : nf(locale, 0).format(l)
}

/**
 * The lowest of a water station's consumables (COMAP): the lower it goes, the more it is
 * a concern — same reading as `battery` for a robot. Absent if none is known yet.
 */
export function waterLowestPct(s: StateFor<'water'>): number | undefined {
  const known = [s.prefilterPct, s.carbon1Pct, s.carbon2Pct, s.uvLampPct].filter((v): v is number => v !== undefined)
  return known.length ? Math.min(...known) : undefined
}

/**
 * Alert summary of a water station: `ok` only if BOTH summaries are known and false — a
 * single known one is not enough to assert "no alert" (see `waterStateSchema`).
 */
export function waterAlertState(s: StateFor<'water'>): 'ok' | 'warning' | 'defect' | 'unknown' {
  if (s.defect === true) return 'defect'
  if (s.warning === true) return 'warning'
  if (s.warning === false && s.defect === false) return 'ok'
  return 'unknown'
}

/** Value of a sensor with its declared unit and precision. */
export function formatSensor(descriptor: DeviceDescriptor, value: number, locale = 'fr'): string {
  const meta = descriptor.meta.sensor
  const digits = meta?.precision ?? 1
  const unit = meta?.unit ?? ''
  return `${nf(locale, digits).format(value)}${unit ? (unit === '%' ? ' %' : ` ${unit}`) : ''}`
}

/** Short summary of a state for the lists (one line, without a translated label). */
export function summarize(descriptor: DeviceDescriptor, state: DeviceState, locale = 'fr'): string {
  switch (state.kind) {
    case 'light': return state.on ? (state.brightness !== undefined ? formatPercent(state.brightness, locale) : '●') : '○'
    case 'cover': return state.position === undefined ? '—' : formatPercent(state.position, locale)
    case 'media_player': return state.playback === 'playing' && state.nowPlaying?.title ? state.nowPlaying.title : formatPercent(state.volume, locale)
    case 'climate': return state.mode === 'off' ? formatTemp(state.currentTempC, locale) : `${formatTemp(state.currentTempC, locale)} → ${formatTemp(state.targetTempC, locale)}`
    case 'vacuum': return formatPercent(state.battery, locale)
    case 'mower': return formatPercent(state.battery, locale)
    case 'sensor': return formatSensor(descriptor, state.value, locale)
    case 'energy': return `${formatPower(state.productionW, locale)} ☀ · ${formatPower(state.consumptionW, locale)}`
    case 'ev_charger': return state.status === 'charging' ? formatPower(state.powerW, locale) : ''
    case 'vehicle': return `${formatPercent(state.soc, locale)} · ${formatKm(state.rangeKm, locale)}`
    case 'camera': return ''
    case 'weather': return formatTemp(state.tempC, locale)
    case 'water': { const p = waterLowestPct(state); return p !== undefined ? formatPercent(p, locale) : '—' }
    case 'pet_feeder': {
      const u = descriptor.meta.petFeeder?.unit
      return state.servedToday !== undefined && u ? formatFeedAmount(state.servedToday, u, locale) : '—'
    }
    case 'pet_fountain': return state.drinksToday !== undefined ? `${state.drinksToday}\u00d7` : (state.on ? '●' : '○')
    case 'fan': return state.on ? (state.speed !== undefined ? String(state.speed) : '●') : '○'
  }
}
