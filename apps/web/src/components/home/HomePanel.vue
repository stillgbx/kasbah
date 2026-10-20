<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { DeviceAlert, StateFor } from '@kasbah/shared'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { useAlertsStore, type RailAlert } from '../../stores/alerts'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { deviceIcon } from '../../lib/deviceIcons'
import { formatPercent, formatPower } from '../../lib/format'
import MarqueeText from '../ui/MarqueeText.vue'
import StatTile from '../ui/StatTile.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// "House" panel: summary tiles, and at the bottom the list of ongoing alerts.
// Each tile leads to the view that gives its detail (`to`: route name of the rail).
const house = useHouseStore()
const devices = useDevicesStore()
const alerts = useAlertsStore()
const router = useRouter()
const summary = useHomeSummary()
const { t, locale } = useI18n()

/**
 * Never read: a vehicle discovered ASLEEP carries the contract's defaults (0 %, 0 km), which would
 * read here as an empty battery. Same trade-off as the Vehicles view: "—" tells the truth.
 */
const unreadVehicle = (s: StateFor<'vehicle'>) =>
  s.soc === 0 && s.rangeKm === 0 && s.odometerKm === undefined && s.location === undefined

const stats = computed(() => {
  const out: { key: string; value: string; label: string; to: string }[] = []
  if (summary.lights.value.length) out.push({ key: 'lights', value: String(summary.lightsOn.value), label: t('home.lightsOn'), to: 'lights' })
  // shutters and awnings have their own tile: "open" and "lowered" are not the same measure
  if (summary.shutters.value.length) out.push({ key: 'shutters', value: `${summary.shuttersOpen.value}/${summary.shutters.value.length}`, label: t('home.shuttersOpen'), to: 'covers' })
  if (summary.awnings.value.length) out.push({ key: 'awnings', value: `${summary.awningsDown.value}/${summary.awnings.value.length}`, label: t('home.awningsDown'), to: 'covers' })
  // cameras and players: these two counters lacked a place where they could be seen at a glance.
  if (summary.cameras.value.length) out.push({ key: 'cameras', value: String(summary.cameras.value.length), label: t('home.cameras'), to: 'cameras' })
  if (summary.players.value.length) out.push({ key: 'players', value: `${summary.playing.value}/${summary.players.value.length}`, label: t('home.players'), to: 'media' })
  // energy: the instantaneous production, and the site's battery charge when there is one —
  // two distinct measures, hence two tiles. The detail stays in the Energy view.
  const site = summary.energy.value
  if (site) out.push({ key: 'solar', value: formatPower(site.productionW, locale.value), label: t('home.solarNow'), to: 'energy' })
  if (site?.batterySoc !== undefined) out.push({ key: 'battery', value: formatPercent(site.batterySoc, locale.value), label: t('home.battery'), to: 'energy' })
  // one tile PER car: two cars do not boil down to one figure, and it is their charge
  // that one comes to look at. The name serves as the label; `devices.list` is sorted by name, the order holds.
  for (const v of summary.vehicles.value) {
    const s = v.state as StateFor<'vehicle'>
    out.push({
      key: v.descriptor.id,
      value: unreadVehicle(s) ? '—' : formatPercent(s.soc, locale.value),
      label: house.houseDeviceFor(v.descriptor.id)?.name ?? v.descriptor.name,
      to: 'vehicles',
    })
  }
  // 2-column grid: the tiles wrap. The cap leaves room for the 5 counters
  // of the house, the 2 energy tiles and three cars — none is ever truncated here.
  return out.slice(0, 10)
})

/** An alert's text: what there is to do, in the words of the device's card. */
function alertText(a: DeviceAlert): string {
  switch (a.type) {
    case 'software_update': return a.detail ? t('alerts.updateVersion', { version: a.detail }) : t('alerts.update')
    case 'device_error': return a.detail ?? t('alerts.deviceError')
    case 'vigilance': return t('weather.alerts.label', {
      level: t(`weather.alerts.levels.${a.severity === 'critical' ? 'red' : 'orange'}`), type: t(`weather.alerts.types.${a.detail}`),
    })
    case 'supply_low': return t(a.kind === 'pet_fountain' ? 'pets.waterLow' : 'pets.foodLow')
    case 'consumable': return t(a.detail === 'filter' ? 'alerts.filter' : 'alerts.desiccant')
    case 'battery_low': return t('alerts.batteryLow')
    case 'tire_low': return t('alerts.tireLow', { tires: (a.detail ?? '').split(',').map((k) => t(`vehicle.tire.${k}`)).join(', ') })
  }
}

/**
 * One row per DEVICE, its alerts following: it is the device one goes to see, and a
 * dispenser that is both empty and out of desiccant does not need to take two rows. `active` is sorted
 * from most to least serious: the first alert of a device gives the color of its row, and
 * the most serious device comes first. The `info` already seen stay: the list says what is
 * ongoing, the rail's badge what is new or needs adjusting.
 */
const alertRows = computed(() => {
  const byDevice = new Map<string, RailAlert[]>()
  for (const a of alerts.active) byDevice.set(a.deviceId, [...(byDevice.get(a.deviceId) ?? []), a])
  return [...byDevice.values()].map((list) => {
    const first = list[0]!
    const descriptor = devices.descriptors[first.deviceId]
    return {
      deviceId: first.deviceId,
      view: first.view,
      severity: first.severity,
      name: house.houseDeviceFor(first.deviceId)?.name ?? descriptor?.name ?? first.deviceId,
      icon: deviceIcon(descriptor, devices.states[first.deviceId]),
      text: list.map(alertText).join(' · '),
    }
  })
})

/** A device of the house: we select it in the scene (its room is framed, its panel opens). Otherwise, its view. */
function openAlert(deviceId: string, view: string) {
  const hd = house.houseDeviceFor(deviceId)
  if (hd) house.selectDevice(hd.id)
  else void router.push({ name: view })
}
</script>

<template>
  <div v-if="stats.length" class="tiles">
    <router-link v-for="s in stats" :key="s.key" :to="{ name: s.to }" class="tile-link">
      <StatTile :value="s.value" :label="s.label" />
    </router-link>
  </div>
  <!-- wedged at the BOTTOM of the panel (margin-top: auto): it appears and leaves without moving anything above -->
  <section v-if="alertRows.length" class="alerts" :aria-label="$t('alerts.title')">
    <div class="section-label">{{ $t('alerts.title') }}</div>
    <button v-for="r in alertRows" :key="r.deviceId" type="button" class="alert-row" :data-severity="r.severity"
            :title="`${r.name} · ${r.text}`" @click="openAlert(r.deviceId, r.view)">
      <span class="icon-square"><StrokeIcon :name="r.icon" :size="18" /></span>
      <span class="alert-row__main">
        <span class="alert-row__name">{{ r.name }}</span>
        <MarqueeText class="alert-row__text" :text="r.text" />
      </span>
      <StrokeIcon class="alert-row__go" name="chevron" :size="16" />
    </button>
  </section>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
/* the tile stays a tile: no underline nor link color, only the background responds to hover */
.tile-link { display: block; min-width: 0; color: inherit; text-decoration: none; border-radius: var(--radius); }
.tile-link:hover .stat-tile { background: var(--accent-soft); }
.tile-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.alerts { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
/* same line as the rooms' (`RoomRows`): two text lines of fixed height */
.alert-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius); border: 0;
  background: var(--surface2); color: var(--text); text-align: left; width: 100%; font: inherit; cursor: pointer;
}
.alert-row:hover { filter: brightness(1.03); }
.alert-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.alert-row__main { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.alert-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alert-row__text { font-size: 12px; color: var(--muted); }
.alert-row[data-severity='problem'] .alert-row__text { color: rgb(var(--v-theme-warning)); }
.alert-row[data-severity='critical'] .alert-row__text { color: rgb(var(--v-theme-error)); }
/* same contrast fix as the pet cards: the raw `warning` token falls below AA in light mode */
html[data-theme='light'] .alert-row[data-severity='problem'] .alert-row__text { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
.alert-row__go { flex: none; color: var(--muted); }
</style>
