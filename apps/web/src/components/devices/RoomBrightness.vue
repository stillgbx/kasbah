<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoomLights } from '../../composables/useRoomLights'
import { useDevicesStore } from '../../stores/devices'

// Brightness of the WHOLE room, next to its master switch (`RoomLightsToggle`): dim the living
// room in one gesture, without going through its five lights. Like the switch, the protocol has
// nothing of the kind — it is a BATCH of commands (`runScene`), one per light.
//
// ABSOLUTE value: all the lit lights receive the same percentage, so the differences one would have
// set light by light are flattened. That is the gesture one comes here for ("set the living room
// to 30 %") and what the market apps do for a group; fine adjustment stays on each light's row.
//
// Writes ONLY to lights that are already on: setting a brightness on an unlit light would turn it
// on with most vendors, and the slider would become a second switch.
const props = defineProps<{ deviceIds: (string | undefined)[] }>()
const devices = useDevicesStore()
const { lights, on } = useRoomLights(() => props.deviceIds)

const dimmable = computed(() => lights.value.filter((l) => l.descriptor?.capabilities.includes('brightness')))
const lit = computed(() => on.value.filter((l) => l.descriptor?.capabilities.includes('brightness')))

/** Local value during the drag, cleared as soon as the command is sent (the state takes over again). */
const draft = ref<number | null>(null)
/** Average of the lit lights: a single value for a single slider. 100 % by default (a light that does not report its brightness is at full). */
const average = computed(() => {
  if (!lit.value.length) return 100
  return Math.round(lit.value.reduce((sum, l) => sum + (l.state.brightness ?? 100), 0) / lit.value.length)
})
const shown = computed(() => draft.value ?? average.value)

function commit(v: number) {
  const brightness = Math.round(v)
  void devices.runScene(lit.value.map((l) => ({ deviceId: l.id, command: { type: 'light.set', brightness } })))
  draft.value = null
}
</script>

<template>
  <!-- RESERVED place: room off, the slider stays there, invisible and inactive — turning a room on
       must not push down what follows it ("nothing must move" rule), exactly like the dimming
       slider of a row in the Lights view. -->
  <v-slider v-if="dimmable.length" :model-value="shown" :min="1" :max="100" :step="1"
            :disabled="lit.length === 0" :class="{ 'room-bright--off': lit.length === 0 }"
            :aria-hidden="lit.length === 0 ? 'true' : 'false'" :aria-label="$t('rooms.brightness')"
            density="compact" hide-details class="room-bright"
            @update:model-value="(v: number) => { draft = v }" @end="commit">
    <!-- The value at the end of the track: without it one aims at 50 % by eye, and the average of a room
         cannot be guessed from the handle. It follows the drag (`shown` carries the draft).
         FIXED width and tabular digits: the track must not shorten when going from
         "9 %" to "100 %", otherwise the handle would move under the finger. -->
    <template #append><span class="room-bright__pct">{{ shown }} %</span></template>
  </v-slider>
</template>

<style scoped>
/* `flex: 0 0 auto`: the side panel is a flex column, and Vuetify sets `flex: 1 1 auto` on
   `.v-input` — without it the slider stretches over the whole free height and pushes the devices to the bottom. */
.room-bright { flex: 0 0 auto; margin: 0 4px; transition: opacity .2s ease; }
.room-bright--off { visibility: hidden; }
/* `min-width` rather than `width`: at high zoom the text must not get cut off. */
.room-bright__pct { min-width: 5ch; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
</style>
