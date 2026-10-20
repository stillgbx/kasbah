<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isDeviceOn } from '../../lib/deviceState'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import RoomLightsToggle from '../devices/RoomLightsToggle.vue'

// Room rows (or garden zone rows), shared by the house panel and a level's
// panel: name, counters, master switch for the lights, selection on click. `where` is only used by the
// house panel, which mixes all the levels — in a level, it would repeat the title.
const props = defineProps<{ rows: { id: string; name: string; where?: string; deviceIds: (string | undefined)[] }[] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const { t } = useI18n()

/** "5 devices · 2 active": the room's inventory, and what is active in it right now. */
function counts(ids: (string | undefined)[]) {
  const bound = ids.filter((id): id is string => !!id && !!devices.states[id])
  // active by itself, or because it plays another one's sound (a TV's soundbar, `lib/audioRouting.ts`)
  const on = bound.filter((id) => isDeviceOn(devices.states[id]!, devices.descriptors[id]) || house.soundRoutes.relays.has(id)).length
  return `${t('home.devicesCount', { n: ids.length }, ids.length)} · ${t('home.active', { n: on }, on)}`
}
const list = computed(() => props.rows.map((r) => ({ ...r, sub: counts(r.deviceIds) })))
</script>

<template>
  <!-- `div` and not `button`: the row carries a switch, and a button inside a button is not
       valid HTML (the nesting breaks the click on Safari iOS) -->
  <div v-for="r in list" :key="r.id" class="room-row" role="button" tabindex="0"
       :data-on="house.selectedRoomId === r.id ? '1' : '0'" @click="house.selectRoom(r.id)" @keydown.enter="house.selectRoom(r.id)">
    <div class="room-row__main">
      <div class="room-row__name">{{ r.name }}</div>
      <div class="room-row__sub">{{ r.sub }}</div>
    </div>
    <div v-if="r.where" class="room-row__where">{{ r.where }}</div>
    <!-- turn a room off without entering it: the shortest gesture from the panel -->
    <RoomLightsToggle :device-ids="r.deviceIds" />
  </div>
</template>

<style scoped>
.room-row {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius); border: 0;
  background: var(--surface2); color: var(--text); text-align: left; width: 100%; transition: background .15s;
  cursor: pointer;
}
.room-row:hover { filter: brightness(1.03); }
.room-row[data-on='1'] { outline: 2px solid var(--accent); outline-offset: -2px; }
.room-row__main { flex: 1 1 0; min-width: 0; }
/* one line each, cut with ellipsis as everywhere else: the master switch
   took 52 px, and without this "Game room · Ground floor" went onto two lines — the
   list would no longer have had rows of the same height */
.room-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-row__sub { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-row__where { font-size: 12px; color: var(--muted); white-space: nowrap; }
</style>
