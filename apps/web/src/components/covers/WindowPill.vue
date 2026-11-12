<script setup lang="ts">
import { computed, ref } from 'vue'

// Thumbnail of a motorized window (Velux roof window), the counterpart of `CoverPill`: same size and
// gestures, another drawing — it is not a shutter. The GLASS pane is hinged at the top and swings
// out from the bottom: the more it opens, the shorter it looks and the wider the gap of daylight
// under it. The value is an OPENING (0 = closed, 100 = open), the natural reading of a window.
//
// Gestures as on `CoverPill`: a TAP sends the window to where the finger lands (high = open), a DRAG
// is relative to the current opening, and goes up to open.
const props = defineProps<{
  /** Opening displayed, 0..100; `undefined` = unknown position (nothing to assert). */
  opening?: number
  interactive: boolean
  label: string
}>()
const emit = defineEmits<{ drag: [v: number]; commit: [v: number] }>()

const el = ref<HTMLElement | null>(null)
const dragging = ref(false)
let start: { at: number; from: number; size: number; tapped: number; moved: boolean } | null = null

const clamp = (v: number) => Math.max(0, Math.min(100, v))

function down(ev: PointerEvent) {
  if (!props.interactive || !el.value) return
  const r = el.value.getBoundingClientRect()
  // opening under the finger: the bottom of the thumbnail is closed, its top wide open
  const tapped = clamp((1 - (ev.clientY - r.top) / r.height) * 100)
  start = { at: ev.clientY, from: props.opening ?? 0, size: r.height, tapped, moved: false }
  el.value.setPointerCapture(ev.pointerId)
}
function move(ev: PointerEvent) {
  if (!start) return
  const d = ev.clientY - start.at
  if (!start.moved && Math.abs(d) < 4) return
  start.moved = true
  dragging.value = true
  emit('drag', clamp(start.from - (d / start.size) * 100))
}
function up(ev: PointerEvent) {
  if (!start) return
  const s = start
  start = null
  dragging.value = false
  if (s.moved) emit('commit', clamp(s.from - ((ev.clientY - s.at) / s.size) * 100))
  else if (ev.type === 'pointerup') emit('commit', s.tapped)
}
// Keyboard: up opens, down closes, in steps of 10; each key commands.
function key(ev: KeyboardEvent) {
  if (!props.interactive) return
  const step = { ArrowUp: 10, ArrowRight: 10, ArrowDown: -10, ArrowLeft: -10 }[ev.key]
  const to = ev.key === 'Home' ? 0 : ev.key === 'End' ? 100 : step === undefined ? undefined : clamp((props.opening ?? 0) + step)
  if (to === undefined) return
  ev.preventDefault()
  emit('commit', to)
}

const style = computed(() => ({ '--o': props.opening === undefined ? 0 : props.opening / 100 }))
</script>

<template>
  <div ref="el" class="win" :data-unknown="opening === undefined ? '1' : '0'" :data-dragging="dragging ? '1' : '0'"
       :data-interactive="interactive ? '1' : '0'" :style="style"
       :role="interactive ? 'slider' : 'img'" :tabindex="interactive ? 0 : undefined" :aria-label="label"
       :aria-orientation="interactive ? 'vertical' : undefined"
       :aria-valuemin="interactive ? 0 : undefined" :aria-valuemax="interactive ? 100 : undefined"
       :aria-valuenow="interactive && opening !== undefined ? Math.round(opening) : undefined"
       @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="up" @keydown="key">
    <div class="win__sash"><div class="win__bar" /></div>
  </div>
</template>

<style scoped>
/* Same footprint as `CoverPill` (`--pill-w`, `--pill-h`, `--pill-r`, `--pill-rows`), so that a window
   row lines up with the shutter rows of the same room. */
.win {
  position: relative; overflow: hidden; width: var(--pill-w, 44px); min-height: var(--pill-h, 76px); height: 100%;
  border-radius: var(--pill-r, 12px);
  /* the gap that opens: daylight, the same accent as an open shutter's bay */
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 14%, transparent), color-mix(in srgb, var(--accent) 42%, transparent));
  /* the frame, thicker than a bay's line: what holds the pane */
  box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--text) 30%, var(--surface2));
  grid-row: var(--pill-rows, span 2);
}
.win[data-interactive='1'] { cursor: ns-resize; touch-action: none; }
.win:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.win[data-unknown='1'] { background: transparent; box-shadow: none; outline: 1px dashed var(--line); outline-offset: -1px; }
/* The pane, hinged at the top: opening shortens it (it swings outward), down to 30 % of its height
   wide open, and lightens it (it is seen at a slant). */
.win__sash {
  position: absolute; left: 3px; right: 3px; top: 3px;
  height: calc((100% - 6px) * (1 - var(--o) * .7));
  border-radius: max(2px, calc(var(--pill-r, 12px) - 4px)) max(2px, calc(var(--pill-r, 12px) - 4px)) 3px 3px;
  /* glass: a cool tint with a diagonal glint, not a shutter's opaque apron */
  background:
    linear-gradient(135deg, transparent 0 38%, color-mix(in srgb, #fff 34%, transparent) 38% 46%, transparent 46%),
    color-mix(in srgb, #7fb4d8 calc(70% - var(--o) * 30%), var(--surface2));
  /* the bottom rail: the moving edge, and the visible grip of the drag */
  box-shadow: inset 0 -3px 0 var(--accent);
  transition: height .4s ease, background-color .4s ease;
}
/* the glazing bar, halfway up the pane */
.win__bar { position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; background: color-mix(in srgb, var(--text) 30%, var(--surface2)); opacity: .6; }
.win[data-unknown='1'] .win__sash { display: none; }
.win[data-dragging='1'] .win__sash { transition: none; }
@media (prefers-reduced-motion: reduce) { .win__sash { transition: none; } }
</style>
