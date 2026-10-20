<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceState, HouseDevice, Opening } from '@kasbah/shared'
import { openingLabel } from '@kasbah/shared'
import { relayLabel } from '../../lib/audioRouting'
import { presentRoomFilters, ROOM_FILTER_ICONS, roomFilterCategory, type RoomFilterCat } from '../../lib/deviceIcons'
import { isDeviceOn, isDevicePulsing, statusLabel, toggleChecked, toggleCommand } from '../../lib/deviceState'
import { lightTintCss } from '../../lib/lightTint'
import { kindIcon } from '../../lib/strokeIcons'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useScenesStore } from '../../stores/scenes'
import { useSettingsStore } from '../../stores/settings'
import RoomBrightness from '../devices/RoomBrightness.vue'
import RoomLightsToggle from '../devices/RoomLightsToggle.vue'
import RoomRows from './RoomRows.vue'
import SceneChips from '../scenes/SceneChips.vue'
import MarqueeText from '../ui/MarqueeText.vue'
import Segmented from '../ui/Segmented.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import PulseDot from '../ui/PulseDot.vue'

// "Room" panel (or garden zone, or LEVEL): breadcrumb, title, devices with quick
// toggle. A level only enters it through what it carries itself, outside any room — a roof and its
// camera; its rooms, for their part, are listed in the house panel.
const emit = defineEmits<{ back: [] }>()
const house = useHouseStore()
const devices = useDevicesStore()
const scenes = useScenesStore()
const settings = useSettingsStore()
const { t, locale } = useI18n()

// Edit mode only: the list of THE ROOM's openings (a garden zone has none), a fallback
// way to reach one that is not visible from the current angle — the main gesture stays
// dragging it in the 3D.
const roomOpenings = computed(() => (settings.houseEditing ? house.selectedRoom?.openings ?? [] : []))
// `openingLabel` is THE display rule for an opening (name if it has one, otherwise its survey
// id): the same as the settings panel's title and the 3D label, never three different names
// for the same window. The kind and the measurements stay in the sub-line.
function openingRow(o: Opening) {
  return { id: o.id, label: openingLabel(o), sub: `${t(`opening.types.${o.type}`)} · ${o.width.toFixed(2)} × ${o.height.toFixed(2)} m` }
}

const roomTarget = computed(() => {
  const idx = house.index
  if (!idx || !house.selectedRoomId) return null
  const room = idx.roomsById.get(house.selectedRoomId)
  if (room) return { name: room.name, where: idx.levelsById.get(room.levelId)?.name ?? '', list: idx.devicesByRoom.get(room.id) ?? [], rooms: [] }
  const zone = idx.zonesById.get(house.selectedRoomId)
  if (zone) return { name: zone.name, where: t('home.garden'), list: idx.devicesByZone.get(zone.id) ?? [], rooms: [] }
  return null
})
const levelTarget = computed(() => {
  const idx = house.index
  const level = idx && house.selectedLevelId ? idx.levelsById.get(house.selectedLevelId) : undefined
  if (!level) return null
  const rooms = (idx!.roomsByLevel.get(level.id) ?? []).filter((r) => r.kind !== 'stairs')
  return {
    name: level.name,
    where: rooms.length ? t('home.roomsCount', { n: rooms.length }, rooms.length) : house.house?.name ?? '',
    list: (idx!.devicesByLevel.get(level.id) ?? []).filter((d) => !d.roomId),
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, deviceIds: (idx!.devicesByRoom.get(r.id) ?? []).map((d) => d.deviceId) })),
  }
})
/** The parent where back leads: the LEVEL of a room; the house for a zone or a level. */
const crumb = computed(() => (house.selectedRoom ? house.index?.levelsById.get(house.selectedRoom.levelId)?.name ?? t('nav.home') : t('nav.home')))

function row(d: HouseDevice) {
  const descriptor = d.deviceId ? devices.descriptors[d.deviceId] : undefined
  const state = d.deviceId ? devices.states[d.deviceId] : undefined
  const aimed = d.deviceId ? devices.targetPosition(d.deviceId) : undefined
  // Soundbar playing the sound of a TV that is playing: active, checked and pulsing like it, the status says
  // so, the TV's cover art serves as its background — and its switch acts on the TV (pausing what
  // one hears), the bar having no playback of its own.
  const relay = d.deviceId ? house.relaySource(d.deviceId) : undefined
  const toggle = relay ? toggleCommand(relay.state) : state ? toggleCommand(state, aimed) : null
  return {
    key: d.id, name: d.name ?? descriptor?.name ?? d.id, icon: kindIcon(descriptor?.kind ?? d.kind, descriptor),
    cat: roomFilterCategory(descriptor?.kind ?? d.kind, descriptor),
    on: !!state && (isDeviceOn(state, descriptor) || !!relay),
    // `on` tints the icon (an OPEN shutter is the active one), `checked` is the value of
    // the switch (a CLOSED shutter is checked) — see `lib/cover.ts`. The target held by the store
    // enters `checked`: the switch toggles at the gesture, not at the end of the travel.
    checked: !!state && (toggleChecked(state, aimed) || !!relay),
    busy: !!state && (isDevicePulsing(state, aimed !== undefined) || !!relay),
    status: relay ? relayLabel(relay.name, relay.state, t)
      : descriptor && state ? statusLabel(descriptor, state, t, locale.value) : t('device.unbound', { id: d.deviceId ?? '—' }),
    // `target`: who receives the switch's command (the TV for a bar that relays)
    toggle, target: relay ? relay.descriptor.id : d.deviceId, available: state?.available ?? false,
    // row background: cover art of the track (player playing, or the one it relays) or tint of the lit light
    ...backdrop(state, relay?.state),
  }
}
/** Background style and its key (the cover art changes with the track; the tint follows the light without cross-fade). */
function backdrop(state: DeviceState | undefined, heard?: DeviceState): { backdrop?: Record<string, string>; backdropKey?: string } {
  if (!state || !state.available) return {}
  const media = heard ?? state
  if (media.kind === 'media_player' && media.nowPlaying?.artUrl) return { backdrop: { backgroundImage: `url(${JSON.stringify(media.nowPlaying.artUrl)})` }, backdropKey: media.nowPlaying.artUrl }
  if (state.kind === 'light') { const tint = lightTintCss(state); if (tint) return { backdrop: { background: tint }, backdropKey: 'tint' } }
  return {}
}
const target = computed(() => roomTarget.value ?? levelTarget.value)
const rows = computed(() => (target.value?.list ?? []).map(row))
/** Linked devices of the room: the master switch looks for the lights there. */
const deviceIds = computed(() => (target.value?.list ?? []).map((d) => d.deviceId))
/** Vendor light scenes attached to this room (matched by name) — a level has none. */
const roomScenes = computed(() => (roomTarget.value ? scenes.forRoom(roomTarget.value.name) : []))

// List filter: "All" plus the categories actually present. A single category
// does not show the bar (the gesture would do nothing). We go back to "All" when changing room.
type RoomFilter = 'all' | RoomFilterCat
const filter = ref<RoomFilter>('all')
const filterCats = computed(() => presentRoomFilters(rows.value.map((r) => r.cat)))
const filterOptions = computed(() => [
  { value: 'all' as RoomFilter, label: t('common.all'), icon: ROOM_FILTER_ICONS.all },
  ...filterCats.value.map((c) => ({ value: c as RoomFilter, label: t(`home.filter.${c}`), icon: ROOM_FILTER_ICONS[c] })),
])
const visibleRows = computed(() => (filter.value === 'all' ? rows.value : rows.value.filter((r) => r.cat === filter.value)))
watch(() => house.selectedRoomId ?? house.selectedLevelId ?? '', () => { filter.value = 'all' })
watch(filterCats, (cats) => { if (filter.value !== 'all' && !cats.includes(filter.value)) filter.value = 'all' })
</script>

<template>
  <template v-if="target">
    <!-- sticky: the breadcrumb and the title stay in view when the list scrolls (styles/app.css) -->
    <div class="panel-head">
      <button type="button" class="crumb" @click="emit('back')"><StrokeIcon name="back" :size="14" /> {{ crumb }}</button>
      <div class="head">
        <div class="min0">
          <div class="title">{{ target.name }}</div>
          <div class="muted sub">{{ target.where }} · {{ $t('home.devicesCount', { n: rows.length }, rows.length) }}</div>
        </div>
        <!-- turn the room off (or on) in one gesture, without going through the list -->
        <RoomLightsToggle :device-ids="deviceIds" />
      </div>
    </div>
    <!-- brightness of the whole room: on its own row, under the switch it extends -->
    <RoomBrightness :device-ids="deviceIds" />
    <SceneChips v-if="roomTarget" :scenes="roomScenes" :label="$t('scenes.title')" :add-to="target.name" />
    <!-- a level carries its rooms first, then what is placed on it outside any room -->
    <section v-if="target.rooms.length" class="block">
      <div class="section-label">{{ $t('home.rooms') }}</div>
      <RoomRows :rows="target.rooms" />
    </section>
    <div class="block">
      <Segmented v-if="filterCats.length > 1" dense fill :model-value="filter" :options="filterOptions"
                 :label="$t('home.filter.aria')" @update:model-value="filter = $event" />
      <div class="rows">
        <div v-for="r in visibleRows" :key="r.key" class="dev-row" role="button" tabindex="0" @click="house.selectDevice(r.key)" @keydown.enter="house.selectDevice(r.key)">
          <!-- background under the content (cover art or tint), fading toward the switch; absolute, it shifts nothing -->
          <Transition name="rowart">
            <div v-if="r.backdrop" :key="r.backdropKey" class="dev-row__art" :style="r.backdrop" aria-hidden="true" />
          </Transition>
          <span class="icon-square" :data-on="r.on ? '1' : '0'"><StrokeIcon :name="r.icon" :size="18" /></span>
          <div class="dev-row__main">
            <div class="dev-row__name">{{ r.name }}</div>
            <!-- status too long (a track title): it scrolls with a fade rather than being cut -->
            <div class="dev-row__status"><PulseDot :on="r.busy" class="dev-row__dot" /><MarqueeText class="dev-row__statustext" :text="r.status" /></div>
          </div>
          <v-switch v-if="r.toggle && r.target" :model-value="r.checked" :disabled="!r.available" class="dev-row__switch"
                    @click.stop @update:model-value="devices.sendCommand(r.target!, r.toggle!)" />
          <StrokeIcon v-else name="chevron" :size="18" class="muted" />
        </div>
      </div>
    </div>
    <!-- edit mode: fallback way to an opening that is not visible from the current angle —
         the main gesture stays dragging it in the 3D once selected -->
    <section v-if="roomOpenings.length" class="block">
      <div class="section-label">{{ $t('opening.list') }}</div>
      <div class="rows">
        <button v-for="o in roomOpenings.map(openingRow)" :key="o.id" type="button" class="dev-row opening-row" @click="house.selectOpening(o.id)">
          <span class="icon-square"><StrokeIcon name="room" :size="18" /></span>
          <div class="dev-row__main">
            <div class="dev-row__name">{{ o.label }}</div>
            <div class="muted dev-row__status">{{ o.sub }}</div>
          </div>
          <StrokeIcon name="chevron" :size="18" class="muted" />
        </button>
      </div>
    </section>
  </template>
</template>

<style scoped>
.crumb { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--muted); font-size: 13px; padding: 0; align-self: flex-start; }
.crumb:hover { color: var(--text); }
/* title on the left, master switch stuck to the right (it does not move when the name gets longer) */
.head { display: flex; align-items: center; gap: 12px; }
.min0 { flex: 1 1 0; min-width: 0; }
.title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
.sub { font-size: 13px; margin-top: 2px; }
.block { display: grid; gap: 8px; }
.rows { display: grid; gap: 8px; }
.dev-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface2); cursor: pointer; transition: filter .15s;
  /* reference, stacking context and clipping of the background cover art */
  position: relative; isolation: isolate; overflow: hidden;
}
.dev-row__art {
  position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-size: auto; background-position: center; opacity: .22;
  mask-image: linear-gradient(90deg, #000 0, #000 35%, transparent 75%);
  -webkit-mask-image: linear-gradient(90deg, #000 0, #000 35%, transparent 75%);
}
.rowart-enter-active, .rowart-leave-active { transition: opacity .6s ease; }
.rowart-enter-from, .rowart-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .rowart-enter-active, .rowart-leave-active { transition: none; } }
.dev-row:hover { filter: brightness(1.03); }
/* the opening row is a <button> (no toggle in its place): we take back the default styles from it */
.opening-row { border: 0; width: 100%; text-align: left; font: inherit; color: inherit; }
.dev-row__main { flex: 1 1 0; min-width: 0; }
/* name too long (id of an unlinked device): cut with ellipsis, as in the banded views */
.dev-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-row__status { font-size: 12px; color: var(--muted); display: flex; align-items: center; min-width: 0; }
.dev-row__statustext { flex: 1 1 auto; min-width: 0; }
.dev-row__dot { margin-right: 6px; color: var(--accent); }
.dev-row__switch { flex: 0 0 auto; }
</style>
