<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CommandInput, CoverCalibration, DeviceDescriptor, StateFor } from '@kasbah/shared'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Calibration of a shutter, measured by eye (see `packages/shared/src/devices/cover-calibration.ts`).
// The box drives the MOTOR on its own scale (`cover.set_position` with `motor: true`), past the current
// calibration: the user brings the apron to each mark and records the motor value there. Everything
// is shown as a CLOSURE, like the rest of the interface (0 % = open).
//
// Nothing is saved before "Save": the marks live in the box, the shutter's current calibration keeps
// working meanwhile.

const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'cover'>; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const open = defineModel<boolean>({ required: true })

/** The marks, as the share of the window COVERED; the sill and the top of the glass are mandatory. */
const MARKS = [
  { covered: 0, key: 'top', required: true },
  { covered: 25, key: 'quarter', required: false },
  { covered: 50, key: 'half', required: false },
  { covered: 75, key: 'threeQuarters', required: false },
  { covered: 100, key: 'sill', required: true },
] as const

/** Motor position (contract scale, 0 = closed) recorded at each mark, by covered share. */
const marks = ref<Record<number, number | undefined>>({})

// opening the box starts again from the saved calibration
watch(open, (v) => {
  if (!v) return
  const next: Record<number, number | undefined> = {}
  for (const p of props.state.calibration ?? []) next[100 - p.position] = p.motor
  marks.value = next
}, { immediate: true })

/** The motor's own position: published apart once calibrated, otherwise it is `position`. */
const motor = computed(() => props.state.motorPosition ?? props.state.position)
const motorClosure = computed(() => (motor.value === undefined ? undefined : 100 - motor.value))
const moving = computed(() => props.state.motion !== 'stopped')
const dragging = ref(false)
const drag = ref(0)
watch(motorClosure, (v) => { if (!dragging.value) drag.value = v ?? 0 }, { immediate: true })
const shownClosure = computed(() => (dragging.value ? drag.value : motorClosure.value))

function goTo(closure: number) {
  emit('command', { type: 'cover.set_position', position: 100 - Math.min(100, Math.max(0, Math.round(closure))), motor: true })
}
function nudge(delta: number) {
  if (motorClosure.value !== undefined) goTo(motorClosure.value + delta)
}

const canMark = computed(() => !props.disabled && !moving.value && motor.value !== undefined)
function mark(covered: number) {
  if (canMark.value) marks.value = { ...marks.value, [covered]: motor.value }
}

/** Points sorted from the sill (position 0) to the top of the glass (position 100). */
const points = computed<CoverCalibration>(() => MARKS
  .filter((m) => marks.value[m.covered] !== undefined)
  .map((m) => ({ position: 100 - m.covered, motor: marks.value[m.covered]! }))
  .sort((a, b) => a.position - b.position))
const missing = computed(() => MARKS.some((m) => m.required && marks.value[m.covered] === undefined))
// each mark lower on the window must sit lower on the motor's travel
const disordered = computed(() => points.value.some((p, i) => i > 0 && p.motor <= points.value[i - 1]!.motor))
const problem = computed(() => (missing.value ? 'missing' : disordered.value ? 'invalid' : null))

function save() {
  if (problem.value || props.disabled) return
  emit('command', { type: 'cover.set_calibration', points: points.value })
  open.value = false
}
function clear() {
  emit('command', { type: 'cover.set_calibration', points: null })
  open.value = false
}
</script>

<template>
  <v-dialog v-model="open" max-width="480" scrollable>
    <div class="card box">
      <div class="box__head">
        <div class="min0">
          <h2 class="box__title">{{ $t('cover.calibration.title') }}</h2>
          <div class="muted box__sub">{{ descriptor.name }}</div>
        </div>
        <button type="button" class="box__close" :title="$t('common.close')" :aria-label="$t('common.close')" @click="open = false">
          <StrokeIcon name="close" :size="18" />
        </button>
      </div>
      <div class="box__body">
        <p class="muted intro">{{ $t('cover.calibration.intro') }}</p>

        <!-- the motor on its own scale: a fine slider, and steps of 1 and 5 % around the stop -->
        <section class="sec">
          <div class="motor">
            <span class="section-label">{{ $t('cover.calibration.motor') }}</span>
            <span class="motor__pct" :data-moving="moving ? '1' : '0'">{{ shownClosure === undefined ? '—' : `${Math.round(shownClosure)} %` }}</span>
          </div>
          <v-slider :model-value="shownClosure ?? 0" :min="0" :max="100" :step="1" :disabled="disabled" color="primary"
                    density="compact" hide-details :aria-label="$t('cover.calibration.motor')"
                    @update:model-value="(v: number) => { dragging = true; drag = v }"
                    @end="(v: number) => { dragging = false; goTo(v) }" />
          <div class="nudges">
            <button type="button" class="key" :disabled="disabled || motorClosure === undefined" :aria-label="$t('cover.calibration.nudgeUp', { n: 5 })" @click="nudge(-5)">−5</button>
            <button type="button" class="key" :disabled="disabled || motorClosure === undefined" :aria-label="$t('cover.calibration.nudgeUp', { n: 1 })" @click="nudge(-1)">−1</button>
            <button type="button" class="key" :disabled="disabled" :aria-label="$t('common.stop')" @click="emit('command', { type: 'cover.stop' })">
              <StrokeIcon name="stop" :size="16" />
            </button>
            <button type="button" class="key" :disabled="disabled || motorClosure === undefined" :aria-label="$t('cover.calibration.nudgeDown', { n: 1 })" @click="nudge(1)">+1</button>
            <button type="button" class="key" :disabled="disabled || motorClosure === undefined" :aria-label="$t('cover.calibration.nudgeDown', { n: 5 })" @click="nudge(5)">+5</button>
          </div>
        </section>

        <!-- the marks, from the top of the window to the sill: one FIXED-height row each -->
        <section class="sec">
          <div class="section-label">{{ $t('cover.calibration.marks') }}</div>
          <div v-for="m in MARKS" :key="m.key" class="mark">
            <span class="mark__text">
              <span class="mark__name">{{ $t(`cover.calibration.${m.key}`) }}<span v-if="m.required" class="muted"> · {{ $t('cover.calibration.required') }}</span></span>
              <span class="muted mark__hint">{{ $t(`cover.calibration.${m.key}Hint`) }}</span>
            </span>
            <span class="mark__pct">{{ marks[m.covered] === undefined ? '—' : `${100 - marks[m.covered]!} %` }}</span>
            <button type="button" class="key mark__btn" :disabled="!canMark" @click="mark(m.covered)">
              <StrokeIcon name="crosshair" :size="16" /><span>{{ $t('cover.calibration.mark') }}</span>
            </button>
          </div>
          <!-- a reserved line: the warning appears without pushing the buttons -->
          <div class="problem" :data-on="problem ? '1' : '0'">{{ problem ? $t(`cover.calibration.${problem}`) : '' }}</div>
        </section>

        <div class="acts">
          <button v-if="state.calibration" type="button" class="pill acts__clear" :disabled="disabled" @click="clear">
            <StrokeIcon name="trash" :size="16" />{{ $t('cover.calibration.clear') }}
          </button>
          <span class="acts__end">
            <button type="button" class="pill" @click="open = false">{{ $t('common.cancel') }}</button>
            <button type="button" class="pill" data-on="1" :disabled="!!problem || disabled" @click="save">{{ $t('cover.calibration.save') }}</button>
          </span>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.box { width: 100%; padding: 18px 20px 20px; display: grid; gap: 12px; box-shadow: var(--shadow); max-height: 85vh; grid-template-rows: auto minmax(0, 1fr); }
.box__head { display: flex; align-items: flex-start; gap: 12px; }
.min0 { min-width: 0; flex: 1 1 auto; }
.box__title { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; }
.box__sub { font-size: 13px; margin-top: 2px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.box__close { flex: 0 0 auto; width: 32px; height: 32px; margin: -4px -6px 0 0; border: 0; border-radius: 10px; background: transparent; color: var(--muted); display: grid; place-items: center; }
.box__close:hover { background: var(--surface2); color: var(--text); }
/* `overflow-x: hidden`: the slider's thumb halo, at the end of its track, made the body scroll sideways */
.box__body { overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; display: grid; gap: 18px; align-content: start; margin-right: -8px; padding-right: 8px; }
.intro { margin: 0; font-size: 13px; line-height: 1.45; }
.sec { display: grid; gap: 8px; }
.motor { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.motor__pct { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.motor__pct[data-moving='1'] { color: var(--accent); }
.nudges { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; }
.key {
  min-width: 0; display: flex; align-items: center; justify-content: center; gap: 5px;
  height: 40px; padding: 0 8px; border-radius: 10px; border: 1px solid var(--line);
  background: transparent; color: var(--text); font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden;
}
.key:hover:not(:disabled) { background: var(--accent-soft); color: var(--accent); border-color: transparent; }
.key:disabled { opacity: .4; }
.mark { display: flex; align-items: center; gap: 10px; height: 48px; }
.mark__text { flex: 1 1 auto; min-width: 0; display: grid; }
.mark__name, .mark__hint { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.mark__name { font-size: 14px; font-weight: 500; }
.mark__hint { font-size: 12px; }
.mark__pct { flex: 0 0 4.5ch; text-align: right; font-variant-numeric: tabular-nums; color: var(--muted); }
.mark__btn { flex: 0 0 auto; }
.problem { height: 18px; font-size: 12px; color: rgb(var(--v-theme-warning)); }
.acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.acts__end { display: inline-flex; gap: 8px; margin-left: auto; }
</style>
