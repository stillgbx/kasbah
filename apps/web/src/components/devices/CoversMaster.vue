<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { coverAtRest, isFlatCover, isPassageCover } from '../../lib/cover'
import { useDevicesStore } from '../../stores/devices'
import Segmented from '../ui/Segmented.vue'

// Master control of the covers, at the top of the Covers view. Like the one for lights
// (`LightsMaster`), the protocol has nothing of the kind — it is a BATCH of commands (`runScene`) —
// and there are TWO named gestures rather than a switch: with nineteen covers of which sixteen are
// open, a switch left one guessing what the press would do.
//
// The two gestures are deliberately not symmetrical:
//
// - **"Close all" puts each one AT REST**: shutters and gate closed, awnings RETRACTED. A deployed
//   awning is not a secured house, it is fabric in the wind — closing must therefore never lower
//   it, whereas the `cover.close` command would (`lib/cover.ts`, `coverAtRest`).
// - **"Open all" opens only the SHUTTERS.** Neither the gate nor the awnings move: a master gesture
//   does not open onto the street, and does not deploy a fabric. What is opened by mistake here
//   costs more than what is forgotten to open. With nothing to open (a terrace of awnings and a
//   gate), the segment is grayed out: it does not promise a gesture it would not make.
//
// An unknown position is assumed at rest for the STATE shown (without that, a silent gate was
// enough to never light anything) but still receives the command when closing: we do not know
// where it stands, and closing what is already closed costs nothing.
//
// Everything is read on the TARGETED position when the store holds one (`targetPosition`), never on
// the published position alone. That is what allows changing one's mind: a shutter sent down counts
// as closed from the gesture on, so "Open all" within the next second still sees it as needing
// opening and sends it again — whereas with the motor position, silent during the ~20 s of descent,
// it would have believed it already open and said nothing to it. It is also what makes the segment
// take its target value under the finger, and come back by itself if the server refuses (the store
// releases the target).
type Choice = 'rest' | 'open' | ''

const props = defineProps<{ entries: DeviceEntry[]; label: string }>()
const devices = useDevicesStore()
const { t } = useI18n()

const covers = computed(() => props.entries.filter((e) => e.state.kind === 'cover'))
const reachable = computed(() => covers.value.filter((e) => e.state.available))
const position = (e: DeviceEntry) => devices.targetPosition(e.descriptor.id) ?? (e.state as StateFor<'cover'>).position
const atRest = (e: DeviceEntry) => coverAtRest(e.descriptor, position(e))
/** What the "open" gesture touches: shutters, curtains, windows — never a passage nor an awning. */
const openable = computed(() => reachable.value.filter((e) => !isFlatCover(e.descriptor) && !isPassageCover(e.descriptor)))

const value = computed<Choice>(() => {
  if (reachable.value.length > 0 && reachable.value.every(atRest)) return 'rest'
  if (openable.value.length > 0 && openable.value.every((e) => (position(e) ?? 0) >= 100)) return 'open'
  return ''
})

const options = computed(() => [
  { value: 'rest' as Choice, label: t('covers.allClose'), disabled: reachable.value.length === 0 },
  { value: 'open' as Choice, label: t('covers.allOpen'), disabled: openable.value.length === 0 },
])

function apply(choice: Choice) {
  if (choice === 'open') {
    // the shutters not already known to be wide open
    const targets = openable.value.filter((e) => (position(e) ?? 0) < 100)
    void devices.runScene(targets.map((e) => ({ deviceId: e.descriptor.id, command: { type: 'cover.open' as const } })))
    return
  }
  if (choice !== 'rest') return
  // each toward its rest — close what stands upright, retract the awnings
  const targets = reachable.value.filter((e) => position(e) === undefined || !atRest(e))
  void devices.runScene(targets.map((e) => ({
    deviceId: e.descriptor.id,
    command: { type: isFlatCover(e.descriptor) ? ('cover.open' as const) : ('cover.close' as const) },
  })))
}
</script>

<template>
  <Segmented v-if="covers.length" dense :model-value="value" :options="options" :label="label"
             @update:model-value="apply" />
</template>
