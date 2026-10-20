<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceKind, Parking } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import StrokeIcon from '../ui/StrokeIcon.vue'

// The "Parking spots" section: the list, and the button that arms a placement. It lives in TWO
// places — the house panel in edit mode (all the spots) and a room's panel
// (those of this room, placed in ITS level) — and it is the same section, not two copies:
// the user must find the same gesture wherever they think of a spot.
const props = defineProps<{
  /** The spots to list. */
  list: Parking[]
  /** Room from which we place: its level is imposed on the created spot. Absent = the touched surface decides. */
  levelId?: string
  /** The title is already carried by the header that wraps it (collapsible section of the house panel). */
  hideLabel?: boolean
}>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

function row(p: Parking) {
  const who = p.deviceId
    ? house.houseDeviceFor(p.deviceId)?.name ?? devices.descriptors[p.deviceId]?.name ?? p.deviceId
    : t('parking.shared')
  return {
    id: p.id,
    label: p.name ?? p.id,
    sub: `${p.accepts === 'vehicle' ? t('parking.bay') : t('parking.dock')} · ${who}`,
    size: `${p.size[0].toFixed(2)} × ${p.size[1].toFixed(2)} m`,
  }
}

/**
 * What can be placed: a shared car spot, and the base of each robot THAT HAS NONE.
 * A robot has only one base — offering a second one only creates a spot that nobody will
 * come to occupy, the nearest winning (`assignParkings`). Its own is adjusted from its row.
 */
const choices = computed(() => {
  const robots = Object.values(devices.descriptors)
    .filter((d) => (d.kind === 'mower' || d.kind === 'vacuum') && !house.dockFor(d.id))
    .map((d) => ({
      accepts: d.kind as DeviceKind, deviceId: d.id as string | undefined,
      label: t('parking.addDock', { name: house.houseDeviceFor(d.id)?.name ?? d.name }),
    }))
  return [{ accepts: 'vehicle' as DeviceKind, deviceId: undefined, label: t('parking.addBay') }, ...robots]
})
const armed = computed(() => house.placingParking)
</script>

<template>
  <section class="block">
    <div v-if="!props.hideLabel" class="section-label">{{ $t('parking.list') }}</div>
    <div v-if="props.list.length" class="rows">
      <button v-for="p in props.list.map(row)" :key="p.id" type="button" class="park-row" @click="house.selectParking(p.id)">
        <span class="icon-square"><StrokeIcon name="parking" :size="18" /></span>
        <div class="park-row__main">
          <div class="park-row__name">{{ p.label }}</div>
          <div class="muted park-row__sub">{{ p.sub }}</div>
        </div>
        <span class="muted park-row__size">{{ p.size }}</span>
        <StrokeIcon name="chevron" :size="18" class="muted park-row__chevron" />
      </button>
    </div>
    <p v-else class="muted empty">{{ $t('parking.none') }}</p>

    <!-- Add: the menu gives what goes in, the tap on the ground gives the place. The button keeps the
         same box once armed (it becomes "Cancel"): nothing moves under the finger. -->
    <v-menu v-if="!armed" location="bottom start">
      <template #activator="{ props: menu }">
        <button v-bind="menu" type="button" class="pill add" :disabled="house.savingParking">
          <StrokeIcon name="plus" :size="16" /> {{ $t('parking.add') }}
        </button>
      </template>
      <div class="add-list card">
        <div class="section-label add-list__title">{{ $t('parking.add') }}</div>
        <button v-for="c in choices" :key="c.deviceId ?? c.accepts" type="button" class="add-item"
                @click="house.startPlacingParking(c.accepts, c.deviceId, props.levelId)">
          {{ c.label }}
        </button>
      </div>
    </v-menu>
    <button v-else type="button" class="pill add add--armed" @click="house.cancelPlacingParking()">
      {{ $t('parking.cancel') }}
    </button>
    <!-- reserved place: the instruction appears without pushing the list (fixed height, two lines) -->
    <p class="muted hint">{{ armed ? $t('parking.placeHint') : '' }}</p>
  </section>
</template>

<style scoped>
.block { display: grid; gap: 8px; }
.rows { display: grid; gap: 8px; }
/* same row as that of an opening in a room's panel */
.park-row {
  display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface2); border: 0; width: 100%; text-align: left; font: inherit; color: inherit;
  cursor: pointer; transition: filter .15s; min-width: 0;
}
.park-row:hover { filter: brightness(1.03); }
/* `min-width: 0` on the block AND on its rows: without it, a long name PUSHES the row out of the
   panel instead of being cut (the intrinsic width of a flex child rules by default). */
.park-row__main { flex: 1 1 0; min-width: 0; }
.park-row__name, .park-row__sub { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.park-row__name { font-weight: 500; font-size: 14px; }
.park-row__sub { font-size: 12px; }
/* the measurements stay readable and are never cut: it is the left row that yields */
.park-row__size { flex: none; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.park-row__chevron { flex: none; }
.empty { font-size: 13px; margin: 0; }
.add { width: 100%; justify-content: center; gap: 8px; }
.add--armed { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.hint { margin: 0; font-size: 12px; min-height: 32px; }
.add-list { padding: 8px; display: grid; gap: 2px; min-width: 200px; max-width: min(280px, 80vw); }
.add-list__title { padding: 2px 8px 4px; }
.add-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.add-item:hover { background: var(--surface2); }
</style>
