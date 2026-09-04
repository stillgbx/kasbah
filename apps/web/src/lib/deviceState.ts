import type { CommandInput, DeviceDescriptor, DeviceState } from '@kasbah/shared'
import { formatPercent, formatPower, formatSensor, formatTemp } from './format'

// Lecture « métier » d'un état : actif ?, bascule rapide possible ?, libellé court traduit.

/** Vrai si l'appareil est « actif » : lampe allumée, volet ouvert, lecture en cours, robot au travail… */
export function isDeviceOn(s: DeviceState): boolean {
  if (!s.available) return false
  switch (s.kind) {
    case 'light': return s.on
    case 'cover': return s.position > 0
    case 'media_player': return s.playback === 'playing'
    case 'climate': return s.mode !== 'off'
    case 'vacuum': return s.activity === 'cleaning'
    case 'mower': return s.activity === 'mowing'
    case 'ev_charger': return s.status === 'charging'
    case 'vehicle': return s.charging
    case 'energy': return s.productionW > 0
    case 'sensor': return false
  }
}

/** Commande de bascule rapide (interrupteur des listes), ou null si l'appareil n'en a pas. */
export function toggleCommand(s: DeviceState): CommandInput | null {
  switch (s.kind) {
    case 'light': return { type: 'light.set', on: !s.on }
    case 'cover': return s.position > 0 ? { type: 'cover.close' } : { type: 'cover.open' }
    case 'media_player': return s.playback === 'playing' ? { type: 'media_player.pause' } : { type: 'media_player.play' }
    case 'vacuum': return s.activity === 'cleaning' ? { type: 'vacuum.dock' } : { type: 'vacuum.start' }
    case 'mower': return s.activity === 'mowing' ? { type: 'mower.park', untilNextSchedule: true } : { type: 'mower.start', durationMin: 60 }
    default: return null
  }
}

type Translate = (key: string, named?: Record<string, unknown>) => string

/** Libellé court d'état pour les listes et l'en-tête du panneau appareil. */
export function statusLabel(descriptor: DeviceDescriptor, s: DeviceState, t: Translate, locale: string): string {
  if (!s.available) return t('common.unavailable')
  switch (s.kind) {
    case 'light': return s.on ? `${t('common.on')}${s.brightness !== undefined ? ` · ${formatPercent(s.brightness, locale)}` : ''}` : t('common.off')
    case 'cover': return s.position <= 0 ? t('cover.closed') : s.position >= 100 ? t('cover.open') : formatPercent(s.position, locale)
    case 'media_player': return s.playback === 'playing' ? `${t('media.playing')}${s.nowPlaying ? ` · ${s.nowPlaying.title}` : ''}` : t(`media.${s.playback}`)
    case 'climate': return `${formatTemp(s.currentTempC, locale)} → ${formatTemp(s.targetTempC, locale)}`
    case 'vacuum': return `${t(`vacuum.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'mower': return `${t(`mower.activities.${s.activity}`)} · ${formatPercent(s.battery, locale)}`
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    case 'energy': return formatPower(s.productionW, locale)
    case 'ev_charger': return s.status === 'charging' ? formatPower(s.powerW, locale) : t(`charger.status.${s.status}`)
    case 'vehicle': return `${formatPercent(s.soc, locale)} · ${Math.round(s.rangeKm)} km`
  }
}

/** Grande valeur en tête du panneau appareil. */
export function headlineValue(descriptor: DeviceDescriptor, s: DeviceState, t: Translate, locale: string): string {
  switch (s.kind) {
    case 'light': return s.on ? (s.brightness !== undefined ? formatPercent(s.brightness, locale) : t('common.on')) : t('common.off')
    case 'cover': return formatPercent(s.position, locale)
    case 'media_player': return s.nowPlaying?.title ?? t(`media.${s.playback}`)
    case 'climate': return formatTemp(s.currentTempC, locale)
    case 'vacuum': return t(`vacuum.activities.${s.activity}`)
    case 'mower': return t(`mower.activities.${s.activity}`)
    case 'sensor': return formatSensor(descriptor, s.value, locale)
    case 'energy': return formatPower(s.productionW, locale)
    case 'ev_charger': return formatPower(s.powerW, locale)
    case 'vehicle': return formatPercent(s.soc, locale)
  }
}
