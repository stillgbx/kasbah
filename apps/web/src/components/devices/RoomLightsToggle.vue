<script setup lang="ts">
import { computed } from 'vue'
import { useRoomLights } from '../../composables/useRoomLights'
import { useDevicesStore } from '../../stores/devices'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Master switch for the lights of a room: turn all on or all off in one gesture, without going
// through the list. On the protocol side nothing of the kind exists — the plugins only know
// devices — so it is a BATCH of commands (`runScene`), with its optimistic update and its
// per-light rollback.
//
// Deliberately limited to lights: "turn off the room" must neither close the shutters nor cut
// the heating. The vendor's light scenes (`SceneChips.vue`) already turn the room off by re-tapping
// the one that is running, but only where there are any; this switch works everywhere.
// No label next to it: the thumb's bulb already says it, and the word "Lights" repeated the view.
// It only ever commands one ROOM: at the top of the Lights view, the whole house is commanded by
// two named gestures (`LightsMaster`), because a whole device set is rarely in a single state.
const props = defineProps<{ deviceIds: (string | undefined)[] }>()
const devices = useDevicesStore()

// Lights of the room: reading shared with the brightness slider (`useRoomLights`), so that
// the two master controls always see the same room.
const { lights, reachable, on } = useRoomLights(() => props.deviceIds)
/**
 * Checked as soon as ONE light is on: the switch then answers "turn off the room", the
 * gesture one comes here for. Turning a half-lit room back on therefore takes two presses —
 * accepted, it is the rare case.
 */
const checked = computed(() => on.value.length > 0)

function toggle() {
  const next = !checked.value
  // only write to the lights that must change: the bridge rate-limits commands
  const targets = next ? reachable.value : on.value
  void devices.runScene(targets.map((l) => ({ deviceId: l.id, command: { type: 'light.set', on: next } })))
}
</script>

<template>
  <div v-if="lights.length" class="master">
    <v-switch :model-value="checked" :disabled="reachable.length === 0" density="compact"
              :aria-label="$t('rooms.allLights')" :title="$t('rooms.allLights')"
              @click.stop @update:model-value="toggle">
      <!-- bulb INSIDE the thumb: it is the only switch of the app that has no named device
           next to it, the glyph says what it acts on. Not sun/moon, already the
           vocabulary of the light/dark appearance in the rail. -->
      <template #thumb><StrokeIcon name="light" :size="12" /></template>
    </v-switch>
  </div>
</template>

<style scoped>
.master { display: flex; align-items: center; flex: 0 0 auto; }
/* the bulb takes the color of the thumb that carries it: gray on the off thumb, accent on the on one */
.master :deep(.v-switch__thumb) { color: var(--muted); }
.master :deep(.v-selection-control--dirty .v-switch__thumb) { color: var(--accent); }
</style>
