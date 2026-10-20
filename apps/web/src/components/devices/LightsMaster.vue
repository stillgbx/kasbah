<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoomLights } from '../../composables/useRoomLights'
import { useDevicesStore } from '../../stores/devices'
import Segmented from '../ui/Segmented.vue'

// Master control of the lights, at the top of the Lights view: TWO named gestures ("Turn all
// off", "Turn all on") rather than a switch.
//
// The switch offered only one gesture at a time, and deduced it from the state: with fifteen lights
// of which three are on, one had to guess what the press would do — and turning the house back on
// took two presses. Here both gestures are always within reach, whatever the state of the device set.
//
// The lit segment shows the STATE, not the last press: nothing is selected while the lights are
// mixed. Since the store applies the command to the state without waiting for the server
// (optimistic update), the segment still takes its TARGET value under the finger — and comes back
// by itself if the server refuses, since the store then restores the previous state.
//
// The per-room switch (`RoomLightsToggle`) has not changed: in a room row there is no room for two
// words, and a room is a small batch where the ambiguity costs less.
type Choice = 'off' | 'on' | ''

const props = defineProps<{ deviceIds: (string | undefined)[]; label: string }>()
const devices = useDevicesStore()
const { t } = useI18n()

// Same reading as the room controls, so that nothing contradicts itself from one screen to another.
const { lights, reachable, on } = useRoomLights(() => props.deviceIds)

const value = computed<Choice>(() =>
  on.value.length === 0 ? 'off' : on.value.length === reachable.value.length ? 'on' : '')

const options = computed(() => {
  // the INVENTORY decides whether the segments are present, reachability whether they are active
  // ("nothing moves" rule): a silent bridge grays out both gestures, it does not make them disappear
  const disabled = reachable.value.length === 0
  return [
    { value: 'off' as Choice, label: t('lights.allOff'), disabled },
    { value: 'on' as Choice, label: t('lights.allOn'), disabled },
  ]
})

function apply(choice: Choice) {
  if (!choice) return
  const next = choice === 'on'
  // only write to the lights that must change: the bridge rate-limits commands
  const targets = reachable.value.filter((l) => l.state.on !== next)
  void devices.runScene(targets.map((l) => ({ deviceId: l.id, command: { type: 'light.set' as const, on: next } })))
}
</script>

<template>
  <Segmented v-if="lights.length" dense :model-value="value" :options="options" :label="label"
             @update:model-value="apply" />
</template>
