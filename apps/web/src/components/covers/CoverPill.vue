<script setup lang="ts">
import { computed, ref } from 'vue'

// Thumbnail of a cover in a row of the Covers view: it IS the cover, seen from the front. The
// background is the opening (soft accent tint: the daylight coming through), and the apron comes
// down from the top by the CLOSURE share (0 % = open, see `lib/cover.ts`). A horizontal slider read
// backwards from the real gesture: a shutter, a blind, a garage door move up and down. Only a
// gate closes sideways (`axis: 'horizontal'`, the leaf comes in from the left).
//
// Two gestures. A TAP without dragging sends the cover to where the finger lands ("halfway"). A
// DRAG is relative: it starts from the current position and not from the finger, to adjust without
// the apron first jumping under the finger. `touch-action: none` on the thumbnail only: a gesture
// that starts on it belongs to it (it does not scroll the page), and it is narrow enough for the
// page to scroll everywhere else.
const props = defineProps<{
  /** Closure displayed, 0..100; `undefined` = unknown position (nothing to assert). */
  closure?: number
  /** Favorite motor position, as closure: a reference mark on the thumbnail. */
  preset?: number
  interactive: boolean
  /** Kind of cover (`meta.cover.deviceClass`): it decides the direction and the material. */
  deviceClass?: string
  label: string
}>()
// A gate closes sideways; everything else top to bottom. Slats for what rolls up or folds in
// panels (roller shutter, garage door), a plain fabric for the rest.
const axis = computed(() => (props.deviceClass === 'gate' ? 'horizontal' : 'vertical'))
const slats = computed(() => props.deviceClass === 'shutter' || props.deviceClass === 'garage')
const emit = defineEmits<{ drag: [v: number]; commit: [v: number] }>()

const el = ref<HTMLElement | null>(null)
const dragging = ref(false)
let start: { at: number; from: number; size: number; tapped: number; moved: boolean } | null = null

const clamp = (v: number) => Math.max(0, Math.min(100, v))
const pos = (ev: PointerEvent) => (axis.value === 'vertical' ? ev.clientY : ev.clientX)

function down(ev: PointerEvent) {
  if (!props.interactive || !el.value) return
  const r = el.value.getBoundingClientRect()
  const size = axis.value === 'vertical' ? r.height : r.width
  // closure under the finger, from the top (or the left for a gate): the target of a tap
  const tapped = clamp(((pos(ev) - (axis.value === 'vertical' ? r.top : r.left)) / size) * 100)
  start = { at: pos(ev), from: props.closure ?? 0, size, tapped, moved: false }
  el.value.setPointerCapture(ev.pointerId)
}
function move(ev: PointerEvent) {
  if (!start) return
  const d = pos(ev) - start.at
  // a threshold of a few pixels: a shaky tap is not a drag
  if (!start.moved && Math.abs(d) < 4) return
  start.moved = true
  dragging.value = true
  emit('drag', clamp(start.from + (d / start.size) * 100))
}
function up(ev: PointerEvent) {
  if (!start) return
  const s = start
  start = null
  dragging.value = false
  if (s.moved) emit('commit', clamp(s.from + ((pos(ev) - s.at) / s.size) * 100))
  // a `pointercancel` (the browser takes the gesture back) is never a tap
  else if (ev.type === 'pointerup') emit('commit', s.tapped)
}
// Keyboard: up / left opens, down / right closes, in steps of 10; each key commands.
function key(ev: KeyboardEvent) {
  if (!props.interactive) return
  const step = { ArrowUp: -10, ArrowLeft: -10, ArrowDown: 10, ArrowRight: 10 }[ev.key]
  const to = ev.key === 'Home' ? 0 : ev.key === 'End' ? 100 : step === undefined ? undefined : clamp((props.closure ?? 0) + step)
  if (to === undefined) return
  ev.preventDefault()
  emit('commit', to)
}

const style = computed(() => ({
  '--c': props.closure === undefined ? 0 : props.closure / 100,
  '--p': props.preset === undefined ? 0 : props.preset / 100,
}))
</script>

<template>
  <div ref="el" class="pill" :data-axis="axis" :data-slats="slats ? '1' : '0'"
       :data-unknown="closure === undefined ? '1' : '0'" :data-dragging="dragging ? '1' : '0'"
       :data-interactive="interactive ? '1' : '0'" :style="style"
       :role="interactive ? 'slider' : 'img'" :tabindex="interactive ? 0 : undefined" :aria-label="label"
       :aria-orientation="interactive ? axis : undefined"
       :aria-valuemin="interactive ? 0 : undefined" :aria-valuemax="interactive ? 100 : undefined"
       :aria-valuenow="interactive && closure !== undefined ? Math.round(closure) : undefined"
       @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown="key">
    <div class="pill__fill" />
    <div v-if="preset !== undefined" class="pill__preset" aria-hidden="true" />
  </div>
</template>

<style scoped>
/* Size adjustable by the parent (`--pill-w`, `--pill-h`, inherited properties): 44 px wide
   in a list row, large in the device panel. */
.pill {
  position: relative; overflow: hidden; width: var(--pill-w, 44px); min-height: var(--pill-h, 76px); height: 100%;
  border-radius: var(--pill-r, 12px);
  /* the open bay: a daylight of accent, more vivid at the top, so that an open cover stands out */
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 42%, transparent), color-mix(in srgb, var(--accent) 14%, transparent));
  /* the bay frame: a thin line, so that a fully closed thumbnail keeps its edges */
  box-shadow: inset 0 0 0 1px var(--line);
  /* 1st column of the row, over the height of the name AND the keys (see `.controls` of the view) */
  grid-row: var(--pill-rows, span 2);
}
.pill[data-interactive='1'] { cursor: ns-resize; touch-action: none; }
.pill[data-interactive='1'][data-axis='horizontal'] { cursor: ew-resize; }
.pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* unknown position: the bay dotted, no apron — nothing is asserted about a silent motor */
.pill[data-unknown='1'] { background: transparent; box-shadow: none; outline: 1px dashed var(--line); outline-offset: -1px; }
.pill__fill {
  /* at least 5 px: the chest of the rolled-up apron, so that the final slat stays visible (and
     graspable by eye) on a fully open cover */
  position: absolute; left: 0; top: 0; width: 100%; height: max(5px, calc(var(--c) * 100%));
  background: color-mix(in srgb, var(--text) 26%, var(--surface2));
  /* the final slat: the moving edge, and the visible grip of the drag */
  box-shadow: inset 0 -3px 0 var(--accent);
  transition: height .4s ease, width .4s ease;
}
.pill[data-slats='1'] .pill__fill {
  background-image: repeating-linear-gradient(180deg, transparent 0 5px, color-mix(in srgb, var(--bg) 30%, transparent) 5px 6px);
  background-color: color-mix(in srgb, var(--text) 26%, var(--surface2));
}
.pill[data-axis='horizontal'] .pill__fill { height: 100%; width: max(5px, calc(var(--c) * 100%)); box-shadow: inset -3px 0 0 var(--accent); }
.pill[data-unknown='1'] .pill__fill { display: none; }
/* during the drag, the apron follows the finger without lag */
.pill[data-dragging='1'] .pill__fill { transition: none; }
/* favorite position mark: same warning tint as on the panel slider */
.pill__preset {
  position: absolute; left: 6px; right: 6px; top: calc(var(--p) * 100%); height: 2px; margin-top: -1px;
  border-radius: 1px; background: rgb(var(--v-theme-warning)); pointer-events: none;
}
.pill[data-axis='horizontal'] .pill__preset { top: 6px; bottom: 6px; left: calc(var(--p) * 100%); width: 2px; height: auto; margin: 0 0 0 -1px; }
@media (prefers-reduced-motion: reduce) { .pill__fill { transition: none; } }
</style>
