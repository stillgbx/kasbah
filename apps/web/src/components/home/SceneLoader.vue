<script setup lang="ts">
// The loading veil of the 3D view: the PLAN of the house is drawn while the scene
// prepares (materials, shaders, first frame) — then the real house takes over with a fade. From
// line to house: it is the same object, at two moments.
//
// In SVG and CSS, not in three: a veil that had to compile its own shaders would arrive
// after what it is meant to keep people waiting for.
//
// An EXPLODED VIEW in axonometry, seen from the southeast like the scene's overview: each level
// is a plate, placed above the previous one with enough gap to never cover it,
// linked to it by leader lines at its corners. The levels are drawn one AFTER the other,
// each wall only once (two neighboring rooms share it), in the order of a sweep, like a
// pencil moving forward. First attempt, discarded: the levels at their real height, drawn together — the
// plates overlapped and one read a fog of lines. As long as the house has not
// arrived from the server, a generic house is drawn.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { House } from '@kasbah/shared'
import type { ScenePrepareStage } from '../../three/HouseScene'

const props = defineProps<{
  house: House | null
  /** `house`: the house arrives from the server; then, the scene's steps. */
  stage: 'house' | ScenePrepareStage
  progress: { done: number; total: number } | null
}>()

const emit = defineEmits<{
  /**
   * Can the veil leave? Yes when the minimal drawing cycles have passed (`MIN_DRAWINGS`) AND
   * the last step received has been displayed long enough to be read; NO again as soon as a step
   * is waiting its turn. A state, not a signal: a green light given during the shaders must not
   * let the veil leave before "First frame" has been read.
   */
  settled: [settled: boolean]
}>()

const { t } = useI18n()

type Vec = [number, number]

/** Two levels of three rooms: enough to draw a house before knowing the real one. */
const GENERIC: Vec[][][] = [0, 1].map(() => [
  [[0, 0], [7, 0], [7, 5], [0, 5]], [[7, 0], [12, 0], [12, 5], [7, 5]], [[0, 5], [12, 5], [12, 9], [0, 9]],
])

/** The rooms of each level that has any, from the lowest to the highest. */
const levels = computed<Vec[][][]>(() => {
  const h = props.house
  if (!h) return GENERIC
  const out = [...h.levels]
    .sort((a, b) => a.elevation - b.elevation)
    .map((l) => h.rooms.filter((r) => r.levelId === l.id).map((r) => r.polygon as Vec[]))
    .filter((rooms) => rooms.length > 0)
  return out.length ? out : GENERIC
})

// View from the southeast, dipping about 35°: right = northeast, depth = northwest.
const COS = Math.SQRT1_2, DIP = 0.57
/** Duration of the drawing of ONE level (s), whatever its number of walls. */
const LEVEL_S = 1.1
/** The finished drawing stays displayed before fading out and starting again (s). */
const HOLD_S = 1.4
/**
 * Minimum drawing cycles, once the veil is displayed: a single one went by too fast to be seen.
 * One and a HALF, so that the house replaces a drawing still moving, not a frozen plan.
 */
const MIN_DRAWINGS = 1.5

const drawing = computed(() => {
  // the common footprint (in house reference frame): its corners carry the leader lines
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const rooms of levels.value) for (const r of rooms) for (const [x, y] of r) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  // the plate occupies (x1 - x0 + y1 - y0)·COS·DIP in screen height: the gap exceeds it, the
  // levels never overlap
  const plate = (x1 - x0 + y1 - y0) * COS * DIP
  const gap = plate * 1.15
  const project = ([x, y]: Vec, level: number): Vec => [(x + y) * COS, -((y - x) * COS * DIP + level * gap)]

  const size = (x1 - x0 + y1 - y0) * COS
  const stroke = size * 0.0042
  const key = ([x, y]: Vec) => `${x.toFixed(2)},${y.toFixed(2)}`
  const walls: { x1: number; y1: number; x2: number; y2: number; delay: string }[] = []
  const floors: { points: string; delay: string }[] = []
  levels.value.forEach((rooms, level) => {
    // each wall once: an edge shared by two rooms is only drawn once
    const seen = new Set<string>()
    const edges: [Vec, Vec][] = []
    for (const room of rooms) {
      for (let i = 0; i < room.length; i++) {
        const a = room[i]!, b = room[(i + 1) % room.length]!
        const k = [key(a), key(b)].sort().join('|')
        if (!seen.has(k)) { seen.add(k); edges.push([a, b]) }
      }
      floors.push({ points: room.map((p) => project(p, level).map((v) => v.toFixed(2)).join(',')).join(' '), delay: `${(level * LEVEL_S + LEVEL_S * 0.6).toFixed(2)}s` })
    }
    // sweep from the front (southeast, near the eye) to the back: a pencil moving forward
    edges.sort((p, q) => (p[0][1] - p[0][0] + p[1][1] - p[1][0]) - (q[0][1] - q[0][0] + q[1][1] - q[1][0]))
    const step = LEVEL_S / Math.max(1, edges.length)
    edges.forEach(([a, b], i) => {
      const [ax, ay] = project(a, level), [bx, by] = project(b, level)
      walls.push({ x1: ax, y1: ay, x2: bx, y2: by, delay: `${(level * LEVEL_S + i * step).toFixed(3)}s` })
    })
  })
  // the leader lines, at the four corners of the footprint, from one level to the next
  const corners: Vec[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const leaders = levels.value.slice(1).flatMap((_, i) => corners.map((c) => {
    const [ax, ay] = project(c, i), [bx, by] = project(c, i + 1)
    return { x1: ax, y1: ay, x2: bx, y2: by, delay: `${((i + 1) * LEVEL_S - 0.15).toFixed(2)}s` }
  }))

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const w of [...walls, ...leaders]) {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2)
    minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2)
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.04
  return {
    walls, floors, leaders, stroke: stroke.toFixed(3),
    cycleMs: (levels.value.length * LEVEL_S + HOLD_S) * 1000,
    viewBox: `${(minX - pad).toFixed(2)} ${(minY - pad).toFixed(2)} ${(maxX - minX + 2 * pad).toFixed(2)} ${(maxY - minY + 2 * pad).toFixed(2)}`,
  }
})

// The drawing starts again as long as the veil is there: recreating its group (`:key`) restarts the drawing.
const cycle = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined
let drawnTimer: ReturnType<typeof setTimeout> | undefined
const loop = () => { timer = setTimeout(() => { cycle.value++; loop() }, drawing.value.cycleMs) }
const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
/**
 * The veil has already been seen IN FULL on this workstation: it leaves as soon as the house is ready. The minimums
 * only serve to discover the animation, not to endure it at every reload or relaunch of the app.
 */
const SEEN_KEY = 'kasbah.sceneLoaderSeen'
const seen = (() => { try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false } })()
/** Nothing to wait for: reduced motion, or animation already seen. */
const brief = reduced || seen

// THE STEPS TO READ. Preparation often chains them faster than one reads: the veil keeps its
// own queue, and each step stays displayed at least `MIN_STEP_MS` — fade in, reading,
// fade out. The fades are CSS transitions launched by timer, not `<Transition>`s:
// those wait for a free frame, which the main thread does not give during compilations.
/** Minimum display duration of a step (ms), fades included. */
const MIN_STEP_MS = 1300
/** Duration of the fade out (ms); the fade in is in the CSS. */
const FADE_MS = 250
type Stage = typeof props.stage
const shownStage = ref<Stage>(props.stage)
const fading = ref(false)
const queue: Stage[] = []
let shownAt = Date.now()
let stepTimer: ReturnType<typeof setTimeout> | undefined
let settleTimer: ReturnType<typeof setTimeout> | undefined
let busy = false
/** The LAST step received is displayed, and has been long enough to be read. */
const caughtUp = ref(false)
function pump(): void {
  clearTimeout(settleTimer)
  if (busy) return
  const readFor = Math.max(0, shownAt + (brief ? 0 : MIN_STEP_MS) - Date.now())
  if (queue.length === 0) {
    settleTimer = setTimeout(() => { caughtUp.value = true }, readFor)
    return
  }
  busy = true
  caughtUp.value = false
  stepTimer = setTimeout(() => {
    fading.value = true
    stepTimer = setTimeout(() => {
      shownStage.value = queue.shift()!
      fading.value = false
      shownAt = Date.now()
      busy = false
      pump()
    }, brief ? 0 : FADE_MS)
  }, readFor)
}
watch(() => props.stage, (stage) => {
  if (stage === (queue.at(-1) ?? shownStage.value)) return
  queue.push(stage)
  pump()
})

const step = computed(() => {
  const stage = shownStage.value
  if (stage === 'materials' && props.progress && props.progress.total > 0) {
    return t('scene.loading.materialsCount', { done: props.progress.done, total: props.progress.total })
  }
  return t(`scene.loading.${stage}`)
})

// A quick load must not skip the drawing nor the steps, the first time. Without animation
// (reduced motion) or once the animation has been seen, nothing to wait for.
const drawingDone = ref(false)
watch(() => drawingDone.value && caughtUp.value, (settled) => {
  if (settled && !brief) { try { localStorage.setItem(SEEN_KEY, '1') } catch { /* storage unavailable: we will see it again */ } }
  emit('settled', settled)
})
onMounted(() => {
  loop()
  pump()
  drawnTimer = setTimeout(() => { drawingDone.value = true }, brief ? 0 : MIN_DRAWINGS * drawing.value.cycleMs)
})
onUnmounted(() => { clearTimeout(timer); clearTimeout(drawnTimer); clearTimeout(stepTimer); clearTimeout(settleTimer) })
</script>

<template>
  <div class="loader" role="status" aria-live="polite">
    <svg class="loader__plan" :viewBox="drawing.viewBox" :style="{ '--wall': drawing.stroke }" aria-hidden="true">
      <Transition name="loader-fade">
        <g :key="cycle">
          <polygon v-for="(f, i) in drawing.floors" :key="`f${i}`" class="loader__floor" :points="f.points" :style="{ animationDelay: f.delay }" />
          <line v-for="(l, i) in drawing.leaders" :key="`l${i}`" class="loader__leader" :x1="l.x1" :y1="l.y1" :x2="l.x2" :y2="l.y2" :style="{ animationDelay: l.delay }" />
          <line v-for="(w, i) in drawing.walls" :key="`w${i}`" class="loader__wall" :x1="w.x1" :y1="w.y1" :x2="w.x2" :y2="w.y2" pathLength="1" :style="{ animationDelay: w.delay }" />
        </g>
      </Transition>
    </svg>
    <div class="loader__title">
      {{ t('scene.loading.title') }}<span class="loader__dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>
    </div>
    <!-- one step replaces the other with a fade in; the material count, for its part, advances in place -->
    <div class="loader__step"><span :key="shownStage" class="loader__step-text" :data-fading="fading ? '1' : '0'">{{ step }}</span></div>
  </div>
</template>

<style scoped>
.loader {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  pointer-events: none; user-select: none;
}
.loader__plan { width: min(42vw, 380px); height: min(40vh, 340px); overflow: visible; margin-bottom: 18px; }
/* The stroke is in the PLAN's unit: `vector-effect: non-scaling-stroke` would keep it in pixels,
   but then also computes the dash pattern in pixels, and the wall came out dotted. */
.loader__wall {
  stroke: var(--accent); stroke-width: var(--wall); stroke-linecap: round;
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: loader-draw .3s ease-out both;
}
@keyframes loader-draw { to { stroke-dashoffset: 0; } }
/* a level's plate is barely tinted once its walls are in place */
.loader__floor { fill: var(--accent); fill-opacity: 0; stroke: none; animation: loader-fill .7s ease both; }
@keyframes loader-fill { to { fill-opacity: .08; } }
/* the leader lines, in fine dots, appear when the level above starts */
.loader__leader {
  stroke: var(--muted); stroke-width: calc(var(--wall) * .6); stroke-dasharray: calc(var(--wall) * 3) calc(var(--wall) * 3);
  opacity: 0; animation: loader-leader .5s ease both;
}
@keyframes loader-leader { to { opacity: .55; } }
.loader-fade-enter-active, .loader-fade-leave-active { transition: opacity .45s ease; }
/* Entry by CSS ANIMATION, exit by transition (`data-fading`, set by timer): nothing here
   waits for a free frame of the main thread, busy during compilations. */
.loader__step-text { display: inline-block; animation: loader-step-in .3s ease backwards; transition: opacity .25s ease; }
.loader__step-text[data-fading='1'] { opacity: 0; }
@keyframes loader-step-in { from { opacity: 0; } to { opacity: 1; } }
.loader-fade-enter-from, .loader-fade-leave-to { opacity: 0; }
.loader__title { font-size: 17px; font-weight: 600; letter-spacing: .01em; color: var(--text); }
/* three dots of fixed width: the title does not move while they animate */
.loader__dots { display: inline-block; width: 1.2em; text-align: left; }
.loader__dots i { font-style: normal; opacity: .2; animation: loader-dot 1.4s infinite; }
.loader__dots i:nth-child(2) { animation-delay: .2s; }
.loader__dots i:nth-child(3) { animation-delay: .4s; }
@keyframes loader-dot { 0%, 100% { opacity: .2; } 40% { opacity: 1; } }
/* a reserved line: a step longer than the other shifts nothing */
.loader__step {
  height: 18px; line-height: 18px; font-size: 13px; color: var(--muted);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .loader__wall { animation: none; stroke-dashoffset: 0; }
  .loader__floor { animation: none; fill-opacity: .08; }
  .loader__leader { animation: none; opacity: .55; }
  .loader-fade-enter-active, .loader-fade-leave-active { transition: none; }
  .loader__step-text { animation: none; }
  .loader__dots i { animation: none; opacity: .6; }
}
</style>
