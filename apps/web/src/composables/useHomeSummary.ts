import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { findEnergySite } from '../lib/energy'
import { formatPower, formatTemp } from '../lib/format'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

// Summary figures shared by the header and the tiles: lights on, shutters open,
// blinds lowered, players playing, cameras, solar production, battery, indoor temperature.
//
// Shutters and blinds are counted SEPARATELY: they are not described in the same words (a shutter is
// open, a blind is lowered) and the user does not look at them for the same reason. The kind
// comes from `meta.cover.deviceClass`, set by the plugin. Gates, garage doors, curtains
// and motorized windows are in neither counter: their wording remains to be decided.

export function useHomeSummary() {
  const devices = useDevicesStore()
  const house = useHouseStore()
  const { t, locale } = useI18n()

  const lights = computed(() => devices.list.filter((e) => e.state.kind === 'light'))
  const lightsOn = computed(() => lights.value.filter((e) => (e.state as StateFor<'light'>).on && e.state.available).length)
  const covers = computed(() => devices.list.filter((e) => e.state.kind === 'cover'))
  const pos = (e: DeviceEntry) => (e.state as StateFor<'cover'>).position
  const coversOpen = computed(() => covers.value.filter((e) => (pos(e) ?? 0) > 0).length)
  /** `undefined` counts as a shutter: it is the default nature of a cover. */
  const ofClass = (e: DeviceEntry, ...classes: string[]) =>
    classes.includes(e.descriptor.meta.cover?.deviceClass ?? 'shutter')
  // Unknown position = OUT of both counters, numerator AND denominator: an RTS cover never says
  // where it stands, and "2/2 blinds lowered" when they are raised is worse than a
  // mute counter. An empty denominator makes the line and the tile disappear; the first
  // command from Kasbah gives a deduced position, and they reappear.
  const known = (e: DeviceEntry) => pos(e) !== undefined
  const shutters = computed(() => covers.value.filter((e) => ofClass(e, 'shutter') && known(e)))
  const shuttersOpen = computed(() => shutters.value.filter((e) => pos(e)! > 0).length)
  const awnings = computed(() => covers.value.filter((e) => ofClass(e, 'awning', 'blind') && known(e)))
  // a "lowered" blind is deployed, hence low position — the opposite of an open shutter
  const awningsDown = computed(() => awnings.value.filter((e) => pos(e)! < 100).length)
  // the SITE: a battery is also an `energy`, but measures neither production nor the grid
  const energy = computed(() => findEnergySite(devices.list)?.state as StateFor<'energy'> | undefined)
  const climate = computed(() => devices.list.find((e) => e.state.kind === 'climate')?.state as StateFor<'climate'> | undefined)
  const indoorTemp = computed<number | null>(() => {
    if (climate.value) return climate.value.currentTempC
    const s = devices.list.find((e) => e.descriptor.kind === 'sensor' && e.descriptor.meta.sensor?.deviceClass === 'temperature' && e.descriptor.name.toLowerCase().indexOf('ext') < 0)
    return s ? (s.state as StateFor<'sensor'>).value : null
  })
  // players (speakers, screens, TVs): how many are broadcasting right now — their own playback, or another's
  // sound (a TV's soundbar over HDMI ARC, `lib/audioRouting.ts`): both devices count
  const players = computed(() => devices.list.filter((e) => e.state.kind === 'media_player'))
  const playing = computed(() => players.value.filter((e) => e.state.available
    && ((e.state as StateFor<'media_player'>).playback === 'playing' || house.soundRoutes.relays.has(e.descriptor.id))).length)
  // cameras: only the COUNT is known — the Nest API says neither whether a camera is recording nor whether it is
  // reachable (see `cameraStateSchema`), and the "active" of the Cameras view comes from the polling of the
  // thumbnails, which the house panel does not do. So no fraction here.
  const cameras = computed(() => devices.list.filter((e) => e.state.kind === 'camera'))
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
    players, playing, cameras, energy, climate, indoorTemp, vehicles, chargers, headline,
  }
}
