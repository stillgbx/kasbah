import type { DeviceDescriptor, DeviceState } from '@kasbah/shared'
import { mirekToKelvin } from '@kasbah/shared'

// Formats d'affichage. Les libellés traduits passent par `t` ; ici uniquement les nombres/unités.

const nf = (locale: string, digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function formatPower(w: number, locale = 'fr'): string {
  return Math.abs(w) >= 1000 ? `${nf(locale, 1).format(w / 1000)} kW` : `${nf(locale, 0).format(w)} W`
}
export function formatEnergy(wh: number, locale = 'fr'): string {
  return Math.abs(wh) >= 1000 ? `${nf(locale, 1).format(wh / 1000)} kWh` : `${nf(locale, 0).format(wh)} Wh`
}
export const formatTemp = (c: number, locale = 'fr') => `${nf(locale, 1).format(c)} °C`
export const formatPercent = (p: number, locale = 'fr') => `${nf(locale, 0).format(p)} %`
export const formatKelvin = (mirek: number) => `${Math.round(mirekToKelvin(mirek) / 100) * 100} K`
export const formatKm = (km: number, locale = 'fr') => `${nf(locale, 0).format(km)} km`

export function formatDistance(m: number, locale = 'fr'): string {
  return m >= 1000 ? `${nf(locale, 1).format(m / 1000)} km` : `${nf(locale, 0).format(m)} m`
}

/** Valeur d'un capteur avec son unité et sa précision déclarées. */
export function formatSensor(descriptor: DeviceDescriptor, value: number, locale = 'fr'): string {
  const meta = descriptor.meta.sensor
  const digits = meta?.precision ?? 1
  const unit = meta?.unit ?? ''
  return `${nf(locale, digits).format(value)}${unit ? (unit === '%' ? ' %' : ` ${unit}`) : ''}`
}

/** Résumé court d'un état pour les listes (une ligne, sans libellé traduit). */
export function summarize(descriptor: DeviceDescriptor, state: DeviceState, locale = 'fr'): string {
  switch (state.kind) {
    case 'light': return state.on ? (state.brightness !== undefined ? formatPercent(state.brightness, locale) : '●') : '○'
    case 'cover': return state.position === undefined ? '—' : formatPercent(state.position, locale)
    case 'media_player': return state.playback === 'playing' && state.nowPlaying ? state.nowPlaying.title : formatPercent(state.volume, locale)
    case 'climate': return `${formatTemp(state.currentTempC, locale)} → ${formatTemp(state.targetTempC, locale)}`
    case 'vacuum': return formatPercent(state.battery, locale)
    case 'mower': return formatPercent(state.battery, locale)
    case 'sensor': return formatSensor(descriptor, state.value, locale)
    case 'energy': return `${formatPower(state.productionW, locale)} ☀ · ${formatPower(state.consumptionW, locale)}`
    case 'ev_charger': return state.status === 'charging' ? formatPower(state.powerW, locale) : ''
    case 'vehicle': return `${formatPercent(state.soc, locale)} · ${formatKm(state.rangeKm, locale)}`
    case 'camera': return ''
  }
}
