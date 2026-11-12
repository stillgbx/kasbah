<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../../stores/devices'
import WindowPill from '../covers/WindowPill.vue'
import PulseDot from '../ui/PulseDot.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Control of a motorized window in the device panel, the counterpart of `CoverControl`: the
// window seen from the front (`WindowPill`) and its maneuvers stacked beside it. The percentage is an
// OPENING (0 = closed). The thumbnail shows the TARGET position as long as the store holds one, like
// a cover's.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'window'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()

const devices = useDevicesStore()
const { t } = useI18n()
const dragging = ref(false)
const drag = ref(0)

const shown = computed(() => devices.targetPosition(props.descriptor.id) ?? props.state.position)
const opening = computed(() => (dragging.value ? drag.value : shown.value ?? 0))
watch(shown, (v) => { if (!dragging.value) drag.value = v ?? 0 }, { immediate: true })

const moving = computed(() => props.state.motion !== 'stopped')
const hasPosition = computed(() => props.descriptor.capabilities.includes('position'))
// A Velux window driven through its box ignores `stop`: the plugin then does not declare it
const hasStop = computed(() => props.descriptor.capabilities.includes('stop'))
const hasQuiet = computed(() => props.descriptor.capabilities.includes('quiet'))
const lineText = computed(() => {
  if (moving.value) return t(`window.${props.state.motion}`)
  if (shown.value === undefined) return t('common.unknown')
  if (shown.value <= 0) return t('window.closed')
  if (shown.value >= 100) return t('window.open')
  return t('window.level')
})

function send(cmd: CommandInput) { emit('command', cmd) }
</script>

<template>
  <div class="window">
    <div class="hero">
      <WindowPill class="hero__pill" :opening="dragging ? drag : shown" :interactive="hasPosition && !disabled"
                  :label="$t('window.level')"
                  @drag="(v: number) => { dragging = true; drag = v }"
                  @commit="(v: number) => { dragging = false; send({ type: 'window.set_position', position: Math.round(v) }) }" />
      <div class="hero__side">
        <!-- one line of constant height: the dot keeps its place, the percentage stays on the right -->
        <div class="line line--hero" :data-moving="moving ? '1' : '0'">
          <PulseDot :on="moving" />
          <span class="line__text">{{ lineText }}</span>
          <span v-if="hasPosition && shown !== undefined" class="line__pct">{{ Math.round(opening) }} %</span>
        </div>
        <button type="button" class="key" :disabled="disabled" @click="send({ type: 'window.open' })">
          <StrokeIcon name="collapseUp" :size="16" /><span>{{ $t('window.actionOpen') }}</span>
        </button>
        <button v-if="hasStop" type="button" class="key" :disabled="disabled" @click="send({ type: 'window.stop' })">
          <StrokeIcon name="stop" :size="16" /><span>{{ $t('common.stop') }}</span>
        </button>
        <button type="button" class="key" :disabled="disabled" @click="send({ type: 'window.close' })">
          <StrokeIcon name="collapseDown" :size="16" /><span>{{ $t('window.actionClose') }}</span>
        </button>
      </div>
    </div>

    <label v-if="hasQuiet" class="quiet" :title="$t('window.quietHint')">
      <StrokeIcon name="moon" :size="16" />
      <span class="quiet__text">{{ $t('cover.quiet') }}</span>
      <v-switch :model-value="!!state.quiet" :disabled="disabled" color="primary" density="compact" hide-details inset
                :aria-label="$t('cover.quiet')"
                @update:model-value="(v: boolean | null) => send({ type: 'window.set_quiet', on: !!v })" />
    </label>
  </div>
</template>

<style scoped>
/* Same layout as `CoverControl`: the thumbnail over the height of the keys column. */
.window { display: grid; gap: 2px; }
.hero { display: grid; grid-template-columns: auto 1fr; gap: 14px; --pill-w: 88px; --pill-h: 150px; --pill-r: 16px; --pill-rows: auto; }
.hero__side { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
.line--hero { margin: 0 0 4px; height: 18px; }
.line[data-moving='1'] { color: var(--accent); }
.line__text { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.line__pct { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.key {
  flex: 0 0 auto; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px;
  height: 40px; padding: 0 6px; border-radius: 10px; border: 1px solid var(--line);
  background: transparent; color: var(--text); font-size: 12px; font-weight: 500;
  white-space: nowrap; overflow: hidden;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
.quiet { display: flex; align-items: center; gap: 8px; height: 40px; margin-top: 6px; font-size: 12px; color: var(--text); cursor: pointer; }
.quiet__text { flex: 1 1 auto; min-width: 0; }
.quiet :deep(.v-switch) { flex: 0 0 auto; }
</style>
