<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import RoomBrightness from '../components/devices/RoomBrightness.vue'
import LightsMaster from '../components/devices/LightsMaster.vue'
import RoomLightsToggle from '../components/devices/RoomLightsToggle.vue'
import { lightTintCss } from '../lib/lightTint'
import { useDevicesStore } from '../stores/devices'
import StrokeIcon from '../components/ui/StrokeIcon.vue'

// Lights view: the per-room list and its link diagnostic live in `RoomBands`
// (shared with the Covers view); only the control specific to a lamp remains here —
// switch, and dimming slider when it is on and can vary.
// A ceiling light linked to a fan also shows the fan's switch.
const devices = useDevicesStore()

const lights = computed(() => devices.list.filter((e) => e.state.kind === 'light'))
const unlinkedFans = computed(() => devices.list.filter(
  (e) => e.state.kind === 'fan' && !e.descriptor.meta.linkedTo,
))
const onCount = computed(() => lights.value.filter((e) => (e.state as StateFor<'light'>).on && e.state.available).length)
const rowsKind = ['light', 'fan'] as const

const fanByLightId = computed(() => {
  const map = new Map<string, DeviceEntry>()
  for (const e of devices.list) {
    if (e.descriptor.kind === 'fan' && e.descriptor.meta.linkedTo) {
      map.set(e.descriptor.meta.linkedTo, e)
    }
  }
  return map
})

// Local value during the drag, cleared as soon as the command has gone out (the state takes over again).
const draft = ref<Record<string, number>>({})
function drag(id: string, v: number) { draft.value = { ...draft.value, [id]: v } }
function commit(id: string, v: number) {
  void devices.sendCommand(id, { type: 'light.set', brightness: Math.round(v) })
  const next = { ...draft.value }
  delete next[id]
  draft.value = next
}
function toggleFan(fan: DeviceEntry): void {
  const on = (fan.state as StateFor<'fan'>).on
  void devices.sendCommand(fan.descriptor.id, { type: 'fan.set', on: !on })
}
</script>

<template>
  <div class="page">
    <PageHeader>
      <!-- turn everything off or on without going through the rooms: two named gestures rather than a
           switch, because the house is rarely all on or all off -->
      <div class="head">
        <div class="muted count">{{ $t('lights.summary', { on: onCount, total: lights.length }) }}</div>
        <LightsMaster :device-ids="lights.map((e) => e.descriptor.id)" :label="$t('lights.all')" />
      </div>
    </PageHeader>
    <div class="page__scroll">
      <div v-if="lights.length === 0 && unlinkedFans.length === 0" class="card card--soft empty muted">{{ $t('lights.none') }}</div>
      <RoomBands :kind="[...rowsKind]" hide-linked>
        <!-- the room's master switch: turn everything on / off without going through the rows -->
        <template #room-action="{ entries }">
          <RoomLightsToggle :device-ids="entries.map((e: DeviceEntry) => e.descriptor.id)" />
        </template>
        <!-- brightness of the whole room, under its header: the same gesture as the master switch,
             in shades. Space reserved when the room is off. -->
        <template #room-under="{ entries }">
          <RoomBrightness :device-ids="entries.map((e: DeviceEntry) => e.descriptor.id)" />
        </template>
        <!-- the lamp's color as the row's background, like a player's cover art in the Media view -->
        <template #backdrop="{ entry }">
          <Transition name="rowtint">
            <div v-if="entry.state.kind === 'light' && lightTintCss(entry.state as StateFor<'light'>)" class="row-tint"
                 :style="{ background: lightTintCss(entry.state as StateFor<'light'>) }" aria-hidden="true" />
          </Transition>
        </template>
        <template #control="{ entry, on }">
          <div v-if="entry.state.kind === 'light'" class="row__switches" :data-dual="fanByLightId.has(entry.descriptor.id) ? '1' : undefined">
            <v-switch :model-value="on" :disabled="!entry.state.available" density="compact" hide-details class="row__switch"
                      :aria-label="$t('kinds.light')"
                      @update:model-value="devices.sendCommand(entry.descriptor.id, { type: 'light.set', on: !on })">
              <!-- Bulb in the thumb when a fan is also there: without it the two
                   switches look alike. Only the dual case — a lone lamp does not need it. -->
              <template v-if="fanByLightId.has(entry.descriptor.id)" #thumb>
                <StrokeIcon name="light" :size="12" />
              </template>
            </v-switch>
            <v-switch
              v-if="fanByLightId.get(entry.descriptor.id)"
              :model-value="(fanByLightId.get(entry.descriptor.id)!.state as StateFor<'fan'>).on"
              :disabled="!fanByLightId.get(entry.descriptor.id)!.state.available" density="compact" hide-details
              class="row__switch"
              :aria-label="$t('kinds.fan')"
              @update:model-value="toggleFan(fanByLightId.get(entry.descriptor.id)!)"
            >
              <template #thumb><StrokeIcon name="wind" :size="12" /></template>
            </v-switch>
          </div>
          <v-switch v-else-if="entry.state.kind === 'fan'" :model-value="on" :disabled="!entry.state.available" density="compact" hide-details class="row__switch"
                    @update:model-value="devices.sendCommand(entry.descriptor.id, { type: 'fan.set', on: !on })" />
          <!-- the slider keeps its place when the lamp is off (invisible, inactive): turning on a lamp
               no longer pushes down the rows below — "nothing must move" rule -->
          <v-slider v-if="entry.state.kind === 'light' && entry.descriptor.capabilities.includes('brightness')"
                    :model-value="draft[entry.descriptor.id] ?? (entry.state as StateFor<'light'>).brightness ?? 100"
                    :min="1" :max="100" :step="1" density="compact" hide-details class="row__slider"
                    :class="{ 'row__slider--off': !on }" :disabled="!on || !entry.state.available" :aria-hidden="on ? 'false' : 'true'"
                    @update:model-value="(v: number) => drag(entry.descriptor.id, v)"
                    @end="(v: number) => commit(entry.descriptor.id, v)" />
        </template>
      </RoomBands>
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 var(--page-x) calc(var(--safe-bottom) + 24px); }
.head { display: flex; align-items: center; gap: 14px; }
.count { font-size: 13px; }
.empty { padding: 24px; text-align: center; }
.row__switches { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex: 0 0 auto; }
.row__switches[data-dual='1'] { margin: -2px 0; }
.row__switch { flex: 0 0 auto; }
/* Glyph in the thumb: same logic as `RoomLightsToggle` — color of the thumb that carries it. */
.row__switches[data-dual='1'] :deep(.v-switch__thumb) { color: var(--muted); }
.row__switches[data-dual='1'] :deep(.v-selection-control--dirty .v-switch__thumb) { color: var(--accent); }
.row__slider { grid-column: 1 / -1; margin: 0 4px; transition: opacity .2s ease; }
/* reserved space: invisible but present, the row has the same height on or off */
.row__slider--off { visibility: hidden; }
/* tint of the lamp behind the row: under the icon and the name, faded before the buttons;
   overflows by 4 px to cover up to the edges */
.row-tint { position: absolute; inset: 0 -4px; z-index: -1; pointer-events: none; }
.rowtint-enter-active, .rowtint-leave-active { transition: opacity .4s ease; }
.rowtint-enter-from, .rowtint-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) { .rowtint-enter-active, .rowtint-leave-active { transition: none; } }
</style>
