<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { coverWords, fromClosure, toClosure } from '../../lib/cover'
import { formatPercent } from '../../lib/format'
import { useDevicesStore } from '../../stores/devices'
import CoverPill from '../covers/CoverPill.vue'
import PulseDot from '../ui/PulseDot.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import LightHistoryChart from './LightHistoryChart.vue'

// Control of a cover in the device panel. The percentage is a CLOSURE (0 % = open),
// see `lib/cover.ts` — the big number at the top of the panel follows the same convention, so this
// control does not repeat it.
//
// The slider shows the TARGET POSITION as long as the store holds it (`targetPosition`): a motor that
// only publishes its position at the end of the travel would otherwise make the handle jump back just
// after the gesture. If the cover stops elsewhere, the store drops the target and the slider goes back
// to reality on its own.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'cover'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()

const devices = useDevicesStore()
const { t } = useI18n()
const dragging = ref(false)
const drag = ref(0)

// the target is only an overlay: without it, the state received as a prop is authoritative
const target = computed(() => devices.targetPosition(props.descriptor.id))
// `undefined` = unknown position (one-way radio that has received nothing): nothing to assert,
// so no percentage and an "Unknown" label. The slider, though, needs a number.
const shown = computed(() => {
  const p = target.value ?? props.state.position
  return p === undefined ? undefined : toClosure(p)
})
const closure = computed(() => (dragging.value ? drag.value : shown.value ?? 0))
watch(shown, (v) => { if (!dragging.value) drag.value = v ?? 0 }, { immediate: true })

// i18n prefix of the vocabulary: a shutter opens, a blind is raised (see `lib/cover.ts`)
const w = computed(() => coverWords(props.descriptor))
const moving = computed(() => props.state.motion !== 'stopped')
/**
 * Text of the status line: the movement when there is one, otherwise "Open" / "Closed" at the
 * extremes, otherwise the name of the setting. Never the percentage — it is already at the end of the line.
 */
// COMPUTED capabilities, not read once: the panel keeps this component when going from one
// cover to another, and a shutter would otherwise have inherited the previous one's lines (tilt, battery).
const hasPosition = computed(() => props.descriptor.capabilities.includes('position'))
const lineText = computed(() => {
  if (moving.value) return t(`cover.${w.value}.${props.state.motion}`)
  // Position never received: the big value shows the ASSUMED state ("Closed", "Raised") and this
  // line is where we say so — without it, the word would pass for a certainty.
  if (shown.value === undefined) return t('cover.assumedHint')
  // Motor without position feedback and with a deduced position: the big value already says the word, the line keeps its
  // height without repeating it (it speaks again as soon as a movement starts).
  if (!hasPosition.value) return '—'
  if (shown.value <= 0) return t(`cover.${w.value}.open`)
  if (shown.value >= 100) return t(`cover.${w.value}.closed`)
  return t(`cover.${w.value}.level`)
})
const hasTilt = computed(() => props.descriptor.capabilities.includes('tilt'))
const hasStop = computed(() => props.descriptor.capabilities.includes('stop'))

// Favorite position memorized IN the motor (Somfy's "my"). The capability says it can be
// recalled; the value, only that it can be shown — a one-way motor has the first
// without the second. Hence two distinct notions rather than one.
const hasPreset = computed(() => props.descriptor.capabilities.includes('preset'))
const presetClosure = computed(() =>
  props.state.presetPosition === undefined ? undefined : toClosure(props.state.presetPosition))
// Rewriting the motor's memory: we store the CURRENT position, like the remote's gesture
// of Somfy (bring the cover to the right place, then memorize) — so we never record a
// position we have not seen. Impossible mid-travel: the position there is the starting one.
const hasPresetSet = computed(() => props.descriptor.capabilities.includes('preset_set'))
const canSavePreset = computed(() => !props.disabled && !moving.value && props.state.position !== undefined)

// Quiet mode: a switch held by the server, applied to the NEXT maneuvers (slow
// speed). Toggling it moves nothing, so it stays active during a travel.
const hasQuiet = computed(() => props.descriptor.capabilities.includes('quiet'))
/** Battery-powered motor (solar shutter): the line is reserved as soon as the capability exists, the value may be missing. */
const hasBattery = computed(() => props.descriptor.capabilities.includes('battery'))

// Solar shutter: its panel is a separate brightness sensor, which declares `meta.linkedTo` to
// this shutter. We display it here rather than as one more device.
const lightSensor = computed(() => {
  const e = devices.list.find((x) => x.descriptor.kind === 'sensor' && x.descriptor.meta.linkedTo === props.descriptor.id)
  return e && e.state.kind === 'sensor' ? { descriptor: e.descriptor, state: e.state } : undefined
})

function send(cmd: CommandInput) { emit('command', cmd) }
</script>

<template>
  <div class="cover">
    <!-- The cover seen from the front, large, and its three maneuvers STACKED beside it in the direction of
         movement (Open at the top, Close at the bottom): the same thumbnail as the Covers view, which can be
         dragged vertically. A horizontal slider read backwards for a shutter. -->
    <div class="hero">
      <CoverPill class="hero__pill" :closure="dragging ? drag : shown" :preset="presetClosure"
                 :interactive="hasPosition && !disabled" :device-class="descriptor.meta.cover?.deviceClass"
                 :label="$t(`cover.${w}.level`)"
                 @drag="(v: number) => { dragging = true; drag = v }"
                 @commit="(v: number) => { dragging = false; send({ type: 'cover.set_position', position: fromClosure(Math.round(v)) }) }" />
      <div class="hero__side">
        <!-- ONE single line, of constant height: the dot keeps its place even off, the text
             takes the middle and the percentage stays glued to the right. A line that appears and
             disappears would shift everything that follows at each movement. -->
        <div class="line line--hero" :data-moving="moving ? '1' : '0'">
          <PulseDot :on="moving" />
          <span class="line__text">{{ lineText }}</span>
          <span v-if="hasPosition && shown !== undefined" class="line__pct">{{ Math.round(closure) }} %</span>
        </div>
        <button type="button" class="key" :disabled="disabled" @click="send({ type: 'cover.open' })">
          <StrokeIcon name="collapseUp" :size="16" /><span>{{ $t(`cover.${w}.actionOpen`) }}</span>
        </button>
        <button v-if="hasStop" type="button" class="key" :disabled="disabled" @click="send({ type: 'cover.stop' })">
          <StrokeIcon name="stop" :size="16" /><span>{{ $t('common.stop') }}</span>
        </button>
        <button type="button" class="key" :disabled="disabled" @click="send({ type: 'cover.close' })">
          <StrokeIcon name="collapseDown" :size="16" /><span>{{ $t(`cover.${w}.actionClose`) }}</span>
        </button>
      </div>
    </div>

    <!-- A single line for both: the recall takes the place (its label and value are
         written), the memorization shrinks to an icon. The latter carries a WARNING
         tint because it rewrites a memory that lives in the motor and also serves the
         "my" button of wall remotes — it is not one more maneuver. -->
    <div v-if="hasPreset || hasPresetSet" class="preset">
      <button v-if="hasPreset" type="button" class="key preset__recall" :disabled="disabled" @click="send({ type: 'cover.preset' })">
        <StrokeIcon name="crosshair" :size="16" />
        <span>{{ $t('cover.preset') }}</span>
        <span v-if="presetClosure !== undefined" class="key__pct">{{ Math.round(presetClosure) }} %</span>
      </button>
      <button v-if="hasPresetSet" type="button" class="key preset__save" :disabled="!canSavePreset"
              :title="$t('cover.presetSave')" :aria-label="$t('cover.presetSave')"
              @click="send({ type: 'cover.set_preset', position: state.position! })">
        <!-- Star = "favorite / memorized", the only glyph that reads at 16 px for this idea. A
             check mark (read as "validated") then a pipette (unreadable at this size) were discarded. -->
        <StrokeIcon name="star" :size="16" />
      </button>
    </div>

    <label v-if="hasQuiet" class="quiet" :title="$t('cover.quietHint')">
      <StrokeIcon name="moon" :size="16" />
      <span class="quiet__text">{{ $t('cover.quiet') }}</span>
      <v-switch :model-value="!!state.quiet" :disabled="disabled" color="primary" density="compact" hide-details inset
                :aria-label="$t('cover.quiet')"
                @update:model-value="(v: boolean | null) => send({ type: 'cover.set_quiet', on: !!v })" />
    </label>

    <div v-if="hasBattery" class="battery">
      <StrokeIcon name="battery" :size="16" />
      <span class="battery__text">{{ $t('cover.battery') }}</span>
      <span class="battery__pct" :class="{ 'battery__pct--low': (state.batteryPct ?? 100) < 20 }">{{ state.batteryPct !== undefined ? formatPercent(state.batteryPct, $i18n.locale) : '—' }}</span>
    </div>

    <template v-if="hasTilt">
      <!-- Tilt: the ANGLE of the slats (venetian blind, adjustable sun-shading louvers), without raising or
           lowering — hence a horizontal slider here, which mimics no movement. -->
      <div class="line">
        <PulseDot :on="false" />
        <span class="line__text">{{ $t('cover.tilt') }}</span>
        <span class="line__pct">{{ state.tilt ?? 0 }} %</span>
      </div>
      <v-slider :model-value="state.tilt ?? 0" :min="0" :max="100" :step="10" :disabled="disabled"
                density="compact" hide-details
                @end="(v: number) => send({ type: 'cover.set_tilt', tilt: Math.round(v) })" />
    </template>

    <LightHistoryChart v-if="lightSensor" :descriptor="lightSensor.descriptor" :state="lightSensor.state" />
  </div>
</template>

<style scoped>
.cover { display: grid; gap: 2px; }
/* The thumbnail over the whole height of the keys column (status line + three keys). */
.hero { display: grid; grid-template-columns: auto 1fr; gap: 14px; --pill-w: 88px; --pill-h: 150px; --pill-r: 16px; --pill-rows: auto; }
.hero__side { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.line--hero { margin: 0 0 4px; height: 18px; }
.line { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin-top: 10px; }
.line[data-moving='1'] { color: var(--accent); }
.line__text { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
/* fixed-width digits: the percentage does not flicker when it changes */
.line__pct { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
/* `min-width: 0` is essential: three buttons at default minimum width overflow the
   panel's 340 px. */
.key {
  flex: 0 0 auto; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px;
  height: 40px; padding: 0 6px; border-radius: 10px; border: 1px solid var(--line);
  background: transparent; color: var(--text); font-size: 12px; font-weight: 500;
  white-space: nowrap; overflow: hidden;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
.key__pct { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
/* The two custom-position keys on ONE line: the recall stretches (its label and value
   are written), the memorization shrinks to a 40 px icon. */
.preset { display: flex; gap: 6px; margin-top: 6px; }
/* Quiet mode: a fixed-height line, the switch on the right as in the settings. */
.quiet { display: flex; align-items: center; gap: 8px; height: 40px; margin-top: 6px; font-size: 12px; color: var(--text); cursor: pointer; }
.quiet__text { flex: 1 1 auto; min-width: 0; }
.quiet :deep(.v-switch) { flex: 0 0 auto; }
/* Battery: same template as the quiet-mode line, the value on the right in fixed digits. */
.battery { display: flex; align-items: center; gap: 8px; height: 32px; font-size: 12px; color: var(--text); }
.battery__text { flex: 1 1 auto; min-width: 0; }
.battery__pct { flex: 0 0 auto; color: var(--muted); font-variant-numeric: tabular-nums; }
.battery__pct--low { color: rgb(var(--v-theme-error)); }
.preset__recall { flex: 1 1 auto; justify-content: flex-start; gap: 8px; }
/* WARNING tint: this key rewrites a setting that lives in the motor and also serves the
   "my" button of wall remotes. Rules placed AFTER `.key:hover`, of the same specificity,
   so it is the order that makes them win. */
.preset__save { flex: 0 0 40px; color: rgb(var(--v-theme-warning)); border-color: rgba(var(--v-theme-warning), .45); }
.preset__save:hover:not(:disabled) { background: rgba(var(--v-theme-warning), .14); color: rgb(var(--v-theme-warning)); border-color: transparent; }
</style>
