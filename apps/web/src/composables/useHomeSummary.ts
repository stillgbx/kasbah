import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { formatPower, formatTemp } from '../lib/format'
import { useDevicesStore } from '../stores/devices'

// Chiffres de synthèse partagés par l'en-tête et les tuiles : lumières allumées, volets ouverts,
// stores baissés, lecteurs en lecture, production solaire, batterie, température intérieure.
//
// Volets et stores sont comptés SÉPARÉMENT : ils ne se disent pas dans les mêmes mots (un volet est
// ouvert, un store est baissé) et l'utilisateur ne les regarde pas pour la même raison. La nature
// vient de `meta.cover.deviceClass`, posée par le plugin. Les portails, portes de garage, rideaux
// et fenêtres motorisées ne sont dans aucun des deux compteurs : leur formulation reste à décider.

export function useHomeSummary() {
  const devices = useDevicesStore()
  const { t, locale } = useI18n()

  const lights = computed(() => devices.list.filter((e) => e.state.kind === 'light'))
  const lightsOn = computed(() => lights.value.filter((e) => (e.state as StateFor<'light'>).on && e.state.available).length)
  const covers = computed(() => devices.list.filter((e) => e.state.kind === 'cover'))
  const pos = (e: DeviceEntry) => (e.state as StateFor<'cover'>).position
  const coversOpen = computed(() => covers.value.filter((e) => (pos(e) ?? 0) > 0).length)
  /** `undefined` compte comme un volet : c'est la nature par défaut d'un ouvrant. */
  const ofClass = (e: DeviceEntry, ...classes: string[]) =>
    classes.includes(e.descriptor.meta.cover?.deviceClass ?? 'shutter')
  // Position inconnue = HORS des deux compteurs, numérateur ET dénominateur : un ouvrant RTS ne dit
  // jamais où il en est, et « 2/2 stores baissés » alors qu'ils sont remontés est pire qu'un
  // compteur muet. Un dénominateur vide fait disparaître la ligne et la tuile ; la première
  // commande depuis Kasbah donne une position déduite, et elles réapparaissent.
  const known = (e: DeviceEntry) => pos(e) !== undefined
  const shutters = computed(() => covers.value.filter((e) => ofClass(e, 'shutter') && known(e)))
  const shuttersOpen = computed(() => shutters.value.filter((e) => pos(e)! > 0).length)
  const awnings = computed(() => covers.value.filter((e) => ofClass(e, 'awning', 'blind') && known(e)))
  // un store « baissé » est déployé, donc position basse — l'inverse d'un volet ouvert
  const awningsDown = computed(() => awnings.value.filter((e) => pos(e)! < 100).length)
  const energy = computed(() => devices.list.find((e) => e.state.kind === 'energy')?.state as StateFor<'energy'> | undefined)
  const climate = computed(() => devices.list.find((e) => e.state.kind === 'climate')?.state as StateFor<'climate'> | undefined)
  const indoorTemp = computed<number | null>(() => {
    if (climate.value) return climate.value.currentTempC
    const s = devices.list.find((e) => e.descriptor.kind === 'sensor' && e.descriptor.meta.sensor?.deviceClass === 'temperature' && e.descriptor.name.toLowerCase().indexOf('ext') < 0)
    return s ? (s.state as StateFor<'sensor'>).value : null
  })
  // lecteurs (enceintes, écrans, téléviseurs) : combien jouent en ce moment
  const players = computed(() => devices.list.filter((e) => e.state.kind === 'media_player'))
  const playing = computed(() => players.value.filter((e) => (e.state as StateFor<'media_player'>).playback === 'playing' && e.state.available).length)
  const vehicles = computed(() => devices.list.filter((e) => e.state.kind === 'vehicle'))
  const chargers = computed(() => devices.list.filter((e) => e.state.kind === 'ev_charger'))

  const headline = computed(() => {
    const parts: string[] = []
    if (lights.value.length) parts.push(t('summary.lightsOn', { n: lightsOn.value }, lightsOn.value))
    if (shutters.value.length) parts.push(t('summary.shuttersOpen', { n: shuttersOpen.value }, shuttersOpen.value))
    if (awnings.value.length) parts.push(t('summary.awningsDown', { n: awningsDown.value }, awningsDown.value))
    if (players.value.length) parts.push(t('summary.playing', { n: playing.value }, playing.value))
    if (indoorTemp.value !== null) parts.push(formatTemp(indoorTemp.value, locale.value))
    if (energy.value) parts.push(`${formatPower(energy.value.productionW, locale.value)} ${t('summary.solar').toLowerCase()}`)
    return parts.join(' · ')
  })

  return {
    lights, lightsOn, covers, coversOpen, shutters, shuttersOpen, awnings, awningsDown,
    players, playing, energy, climate, indoorTemp, vehicles, chargers, headline,
  }
}
