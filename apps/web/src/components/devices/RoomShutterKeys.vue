<script setup lang="ts">
import { computed } from 'vue'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Open / Stop / Close a room's SHUTTERS with a single press, in the header of its card (Covers
// view). The same keys as on a row, applied to the room: like the room's light switch
// (`RoomLightsToggle`), it is a BATCH of commands (`runScene`).
//
// Shutters only (user's choice): no awning, no gate, no garage door — a room that has only
// those has no keys. A cover with no declared kind is a shutter, the default kind (`coverWords`).
//
// Open and close read the TARGETED position (`targetPosition`), like `CoversMaster`: one can
// change one's mind during the travel, and we only write to the shutters that must move.
const props = defineProps<{ entries: DeviceEntry[] }>()
const devices = useDevicesStore()

const shutters = computed(() => props.entries.filter((e) => e.state.kind === 'cover'
  && (e.descriptor.meta.cover?.deviceClass || 'shutter') === 'shutter'))
const reachable = computed(() => shutters.value.filter((e) => e.state.available))
const hasStop = computed(() => shutters.value.some((e) => e.descriptor.capabilities.includes('stop')))
const position = (e: DeviceEntry) => devices.targetPosition(e.descriptor.id) ?? (e.state as StateFor<'cover'>).position
// Stop: MOVING shutters only. A stop on a motionless motor is not harmless: on a radio with no
// feedback it erases the deduced position, and an RTS motor may take it for "my".
// The movement is the one the motor publishes, or that the store sets from the gesture on (`optimistic.ts`).
const moving = computed(() => reachable.value.filter((e) => e.descriptor.capabilities.includes('stop')
  && (e.state as StateFor<'cover'>).motion !== 'stopped'))

function send(targets: DeviceEntry[], command: CommandInput) {
  void devices.runScene(targets.map((e) => ({ deviceId: e.descriptor.id, command })))
}
// unknown position: we send anyway, we do not know where the shutter stands
const open = () => send(reachable.value.filter((e) => (position(e) ?? 0) < 100), { type: 'cover.open' })
const close = () => send(reachable.value.filter((e) => (position(e) ?? 100) > 0), { type: 'cover.close' })
const stop = () => send(moving.value, { type: 'cover.stop' })
</script>

<template>
  <div v-if="shutters.length" class="room-keys">
    <button type="button" class="key" :disabled="!reachable.length"
            :title="$t('rooms.shuttersOpen')" :aria-label="$t('rooms.shuttersOpen')" @click="open">
      <StrokeIcon name="collapseUp" :size="16" />
    </button>
    <!-- grayed out when nothing is moving: the key stays in its place, nothing shifts -->
    <button v-if="hasStop" type="button" class="key" :disabled="!moving.length"
            :title="$t('rooms.shuttersStop')" :aria-label="$t('rooms.shuttersStop')" @click="stop">
      <StrokeIcon name="stop" :size="16" />
    </button>
    <button type="button" class="key" :disabled="!reachable.length"
            :title="$t('rooms.shuttersClose')" :aria-label="$t('rooms.shuttersClose')" @click="close">
      <StrokeIcon name="collapseDown" :size="16" />
    </button>
  </div>
</template>

<style scoped>
/* negative margin: the keys overflow onto the header's bottom margin rather than enlarge it,
   so that the rows of a card with or without shutters start at the same place */
.room-keys { display: flex; gap: 6px; flex: 0 0 auto; margin: -5px 0; }
.key {
  display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px;
  border: 1px solid var(--line); background: transparent; color: var(--text); transition: background .15s, color .15s;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
</style>
