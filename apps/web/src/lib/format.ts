import type { DeviceDescriptor, DeviceState, StateFor } from '@kasbah/shared'
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
/** Durée courte, à la minute : « 45 min », « 1 h 20 ». Une charge qui reste ne se compte pas en heures décimales. */
export function formatMinutes(min: number, locale = 'fr'): string {
  const total = Math.max(0, Math.round(min))
  const h = Math.floor(total / 60)
  return h === 0 ? `${nf(locale, 0).format(total)} min` : `${h} h ${String(total % 60).padStart(2, '0')}`
}

/**
 * Âge relatif court (« il y a 12 min », « il y a 3 h », « hier »), pour dater une lecture. En dessous
 * d'une minute : « maintenant » selon la langue (Intl, `numeric: 'auto'`). Une date DANS LE FUTUR est
 * ramenée à maintenant : l'horloge du serveur et celle de la tablette diffèrent de quelques secondes,
 * et la simulation vit dans un temps accéléré — « lu dans 8 min » ne veut rien dire.
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
 * Seuil d'1 m³ plein : sous ce volume, deux décimales de m³ perdraient de la précision (93 L, par
 * exemple, a besoin de trois décimales pour s'écrire « 0,093 m³ » sans arrondi) ; au-delà, deux
 * décimales suffisent et trois n'apprendraient rien (7 545 L → « 7,55 m³ »). Sert aussi à choisir
 * l'unité d'un AXE de volumes (`volumeAxisUnit`), où le litre resterait lisible en dessous.
 */
const VOLUME_M3_THRESHOLD_L = 1000

/**
 * Débit : toujours les deux unités — le m³/h est celui de la fiche technique du fabricant (2 m³/h
 * maxi). Trois décimales, pas deux : le débitmètre compte par pas EXACTS de 36 L/h (0,036 m³/h), un
 * pas constant sur toute sa plage (contrairement au volume, sa résolution ne dépend pas de la
 * grandeur mesurée) — deux décimales arrondiraient déjà ce pas et perdraient l'information à toute
 * valeur, pas seulement les petites. Un débit EXACTEMENT nul est une mesure, pas une approximation :
 * le m³/h n'y ajoute rien, « 0 L/h » se suffit.
 */
export function formatFlow(lph: number, locale = 'fr'): string {
  if (lph === 0) return `${nf(locale, 0).format(0)} L/h`
  return `${nf(locale, 0).format(lph)} L/h · ${nf(locale, 3).format(lph / 1000)} m³/h`
}

/**
 * Le complément m³ s'affiche désormais TOUJOURS pour un volume mesuré non nul (plus de seuil qui le
 * cache) : seule la PRÉCISION s'adapte, pour ne jamais écrire « 0,00 m³ » sur une valeur réelle — la
 * règle « absent n'est pas zéro », appliquée à l'arrondi. Trois décimales sous le seuil d'1 m³ (tout
 * volume en litres entiers s'y écrit alors EXACTEMENT, sans le moindre arrondi : 3 L → 0,003 m³),
 * deux au-delà, où un litre de plus ou de moins ne se lit plus. Un volume EXACTEMENT nul reste
 * « 0 L » seul : le m³ n'y apprend rien.
 */
export function formatVolume(l: number, locale = 'fr'): string {
  const liters = `${nf(locale, 0).format(l)} L`
  if (l === 0) return liters
  const decimals = Math.abs(l) < VOLUME_M3_THRESHOLD_L ? 3 : 2
  return `${liters} · ${nf(locale, decimals).format(l / 1000)} m³`
}

/**
 * Unité d'un AXE de volumes (jamais les deux à la fois, contrairement à `formatVolume`) : même seuil
 * qu'un volume isolé — en dessous, le litre reste lisible ; au-delà, des graduations en litres
 * afficheraient cinq chiffres (vue Année) là où le m³ tient sur deux ou trois.
 */
export type VolumeAxisUnit = 'L' | 'm³'
export function volumeAxisUnit(maxL: number): VolumeAxisUnit {
  return Math.abs(maxL) >= VOLUME_M3_THRESHOLD_L ? 'm³' : 'L'
}

/** Une graduation d'axe dans l'unité choisie par `volumeAxisUnit`, sans l'unité répétée à chaque valeur. */
export function formatVolumeAxisTick(l: number, unit: VolumeAxisUnit, locale = 'fr'): string {
  return unit === 'm³' ? new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(l / 1000) : nf(locale, 0).format(l)
}

/**
 * Le plus bas des consommables d'une station d'eau (COMAP) : plus il descend, plus il faut s'en
 * inquiéter — même lecture que `battery` pour un robot. Absent si aucun n'est encore connu.
 */
export function waterLowestPct(s: StateFor<'water'>): number | undefined {
  const known = [s.prefilterPct, s.carbon1Pct, s.carbon2Pct, s.uvLampPct].filter((v): v is number => v !== undefined)
  return known.length ? Math.min(...known) : undefined
}

/**
 * Résumé d'alerte d'une station d'eau : `ok` seulement si les DEUX résumés sont connus et faux — un
 * seul connu ne suffit pas à affirmer « aucune alerte » (voir `waterStateSchema`).
 */
export function waterAlertState(s: StateFor<'water'>): 'ok' | 'warning' | 'defect' | 'unknown' {
  if (s.defect === true) return 'defect'
  if (s.warning === true) return 'warning'
  if (s.warning === false && s.defect === false) return 'ok'
  return 'unknown'
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
    case 'media_player': return state.playback === 'playing' && state.nowPlaying?.title ? state.nowPlaying.title : formatPercent(state.volume, locale)
    case 'climate': return `${formatTemp(state.currentTempC, locale)} → ${formatTemp(state.targetTempC, locale)}`
    case 'vacuum': return formatPercent(state.battery, locale)
    case 'mower': return formatPercent(state.battery, locale)
    case 'sensor': return formatSensor(descriptor, state.value, locale)
    case 'energy': return `${formatPower(state.productionW, locale)} ☀ · ${formatPower(state.consumptionW, locale)}`
    case 'ev_charger': return state.status === 'charging' ? formatPower(state.powerW, locale) : ''
    case 'vehicle': return `${formatPercent(state.soc, locale)} · ${formatKm(state.rangeKm, locale)}`
    case 'camera': return ''
    case 'weather': return formatTemp(state.tempC, locale)
    case 'water': { const p = waterLowestPct(state); return p !== undefined ? formatPercent(p, locale) : '—' }
  }
}
