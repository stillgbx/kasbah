<script setup lang="ts">
// Le voile de chargement de la vue 3D : le PLAN de la maison se dessine pendant que la scène se
// prépare (matières, shaders, première image) — puis la vraie maison prend le relais en fondu. Du
// trait à la maison : c'est le même objet, à deux moments.
//
// En SVG et en CSS, pas en three : un voile qui devrait compiler ses propres shaders arriverait
// après ce qu'il est censé faire patienter.
//
// Une VUE ÉCLATÉE en axonométrie, vue du sud-est comme la vue d'ensemble de la scène : chaque niveau
// est une plaque, posée au-dessus de la précédente avec assez d'écart pour ne jamais la recouvrir,
// reliée à elle par des lignes de rappel à ses coins. Les niveaux se tracent l'un APRÈS l'autre,
// chaque mur une seule fois (deux pièces voisines le partagent), dans l'ordre d'un balayage, comme un
// crayon qui avance. Premier essai, écarté : les niveaux à leur vraie hauteur, tracés ensemble — les
// plaques se chevauchaient et on lisait un brouillard de traits. Tant que la maison n'est pas
// arrivée du serveur, c'est une maison générique qui se dessine.
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { House } from '@kasbah/shared'
import type { ScenePrepareStage } from '../../three/HouseScene'

const props = defineProps<{
  house: House | null
  /** `house` : la maison arrive du serveur ; ensuite, les étapes de la scène. */
  stage: 'house' | ScenePrepareStage
  progress: { done: number; total: number } | null
}>()

const emit = defineEmits<{
  /**
   * Le voile peut-il partir ? Oui quand les cycles de dessin minimaux sont passés (`MIN_DRAWINGS`) ET
   * que la dernière étape reçue a été affichée le temps d'être lue ; NON de nouveau dès qu'une étape
   * attend son tour. Un état, pas un signal : un feu vert donné pendant les shaders ne doit pas
   * laisser partir le voile avant que « Première image » ait été lue.
   */
  settled: [settled: boolean]
}>()

const { t } = useI18n()

type Vec = [number, number]

/** Deux niveaux de trois pièces : de quoi dessiner une maison avant de connaître la vraie. */
const GENERIC: Vec[][][] = [0, 1].map(() => [
  [[0, 0], [7, 0], [7, 5], [0, 5]], [[7, 0], [12, 0], [12, 5], [7, 5]], [[0, 5], [12, 5], [12, 9], [0, 9]],
])

/** Les pièces de chaque niveau qui en a, du plus bas au plus haut. */
const levels = computed<Vec[][][]>(() => {
  const h = props.house
  if (!h) return GENERIC
  const out = [...h.levels]
    .sort((a, b) => a.elevation - b.elevation)
    .map((l) => h.rooms.filter((r) => r.levelId === l.id).map((r) => r.polygon as Vec[]))
    .filter((rooms) => rooms.length > 0)
  return out.length ? out : GENERIC
})

// Vue du sud-est, plongée d'environ 35° : droite = nord-est, profondeur = nord-ouest.
const COS = Math.SQRT1_2, DIP = 0.57
/** Durée du tracé d'UN niveau (s), quel que soit son nombre de murs. */
const LEVEL_S = 1.1
/** Le dessin fini reste affiché avant de s'effacer et de recommencer (s). */
const HOLD_S = 1.4
/**
 * Cycles de dessin au minimum, une fois le voile affiché : un seul passait trop vite pour être vu.
 * Un et DEMI, pour que la maison remplace un dessin encore en mouvement, pas un plan figé.
 */
const MIN_DRAWINGS = 1.5

const drawing = computed(() => {
  // l'emprise commune (en repère maison) : ses coins portent les lignes de rappel
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const rooms of levels.value) for (const r of rooms) for (const [x, y] of r) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
  }
  // la plaque occupe (x1 - x0 + y1 - y0)·COS·DIP en hauteur d'écran : l'écart la dépasse, les
  // niveaux ne se recouvrent jamais
  const plate = (x1 - x0 + y1 - y0) * COS * DIP
  const gap = plate * 1.15
  const project = ([x, y]: Vec, level: number): Vec => [(x + y) * COS, -((y - x) * COS * DIP + level * gap)]

  const size = (x1 - x0 + y1 - y0) * COS
  const stroke = size * 0.0042
  const key = ([x, y]: Vec) => `${x.toFixed(2)},${y.toFixed(2)}`
  const walls: { x1: number; y1: number; x2: number; y2: number; delay: string }[] = []
  const floors: { points: string; delay: string }[] = []
  levels.value.forEach((rooms, level) => {
    // chaque mur une fois : une arête partagée par deux pièces n'est dessinée qu'une fois
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
    // balayage de l'avant (sud-est, près de l'œil) vers l'arrière : un crayon qui avance
    edges.sort((p, q) => (p[0][1] - p[0][0] + p[1][1] - p[1][0]) - (q[0][1] - q[0][0] + q[1][1] - q[1][0]))
    const step = LEVEL_S / Math.max(1, edges.length)
    edges.forEach(([a, b], i) => {
      const [ax, ay] = project(a, level), [bx, by] = project(b, level)
      walls.push({ x1: ax, y1: ay, x2: bx, y2: by, delay: `${(level * LEVEL_S + i * step).toFixed(3)}s` })
    })
  })
  // les lignes de rappel, aux quatre coins de l'emprise, d'un niveau au suivant
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

// Le dessin recommence tant que le voile est là : recréer son groupe (`:key`) relance le tracé.
const cycle = ref(0)
let timer: ReturnType<typeof setTimeout> | undefined
let drawnTimer: ReturnType<typeof setTimeout> | undefined
const loop = () => { timer = setTimeout(() => { cycle.value++; loop() }, drawing.value.cycleMs) }
const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
/**
 * Le voile a déjà été vu EN ENTIER sur ce poste : il part dès que la maison est prête. Les minimums
 * ne servent qu'à découvrir l'animation, pas à la subir à chaque rechargement ou relance de l'app.
 */
const SEEN_KEY = 'kasbah.sceneLoaderSeen'
const seen = (() => { try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false } })()
/** Rien à attendre : mouvements réduits, ou animation déjà vue. */
const brief = reduced || seen

// LES ÉTAPES À LIRE. La préparation les enchaîne souvent plus vite qu'on ne lit : le voile tient sa
// propre file, et chaque étape reste affichée au moins `MIN_STEP_MS` — fondu d'entrée, lecture,
// fondu de sortie. Les fondus sont des transitions CSS lancées par minuterie, pas des `<Transition>` :
// celles-ci attendent une image libre, que le fil principal ne donne pas pendant les compilations.
/** Durée minimale d'affichage d'une étape (ms), fondus compris. */
const MIN_STEP_MS = 1300
/** Durée du fondu de sortie (ms) ; celui d'entrée est dans le CSS. */
const FADE_MS = 250
type Stage = typeof props.stage
const shownStage = ref<Stage>(props.stage)
const fading = ref(false)
const queue: Stage[] = []
let shownAt = Date.now()
let stepTimer: ReturnType<typeof setTimeout> | undefined
let settleTimer: ReturnType<typeof setTimeout> | undefined
let busy = false
/** La DERNIÈRE étape reçue est affichée, et l'a été assez longtemps pour être lue. */
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

// Un chargement rapide ne doit escamoter ni le dessin ni les étapes, la première fois. Sans animation
// (mouvements réduits) ou une fois l'animation vue, rien à attendre.
const drawingDone = ref(false)
watch(() => drawingDone.value && caughtUp.value, (settled) => {
  if (settled && !brief) { try { localStorage.setItem(SEEN_KEY, '1') } catch { /* stockage indisponible : on la reverra */ } }
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
    <!-- une étape remplace l'autre en fondu d'entrée ; le compte des matières, lui, avance sur place -->
    <div class="loader__step"><span :key="shownStage" class="loader__step-text" :data-fading="fading ? '1' : '0'">{{ step }}</span></div>
  </div>
</template>

<style scoped>
.loader {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  pointer-events: none; user-select: none;
}
.loader__plan { width: min(42vw, 380px); height: min(40vh, 340px); overflow: visible; margin-bottom: 18px; }
/* Le trait est dans l'unité du PLAN : `vector-effect: non-scaling-stroke` le tiendrait en pixels,
   mais calcule alors aussi le motif du tracé en pixels, et le mur sortait en pointillés. */
.loader__wall {
  stroke: var(--accent); stroke-width: var(--wall); stroke-linecap: round;
  stroke-dasharray: 1; stroke-dashoffset: 1;
  animation: loader-draw .3s ease-out both;
}
@keyframes loader-draw { to { stroke-dashoffset: 0; } }
/* la plaque d'un niveau se teinte à peine une fois ses murs posés */
.loader__floor { fill: var(--accent); fill-opacity: 0; stroke: none; animation: loader-fill .7s ease both; }
@keyframes loader-fill { to { fill-opacity: .08; } }
/* les lignes de rappel, en pointillés fins, apparaissent quand le niveau du dessus commence */
.loader__leader {
  stroke: var(--muted); stroke-width: calc(var(--wall) * .6); stroke-dasharray: calc(var(--wall) * 3) calc(var(--wall) * 3);
  opacity: 0; animation: loader-leader .5s ease both;
}
@keyframes loader-leader { to { opacity: .55; } }
.loader-fade-enter-active, .loader-fade-leave-active { transition: opacity .45s ease; }
/* Entrée par ANIMATION CSS, sortie par transition (`data-fading`, posé par minuterie) : rien ici
   n'attend une image libre du fil principal, occupé pendant les compilations. */
.loader__step-text { display: inline-block; animation: loader-step-in .3s ease backwards; transition: opacity .25s ease; }
.loader__step-text[data-fading='1'] { opacity: 0; }
@keyframes loader-step-in { from { opacity: 0; } to { opacity: 1; } }
.loader-fade-enter-from, .loader-fade-leave-to { opacity: 0; }
.loader__title { font-size: 17px; font-weight: 600; letter-spacing: .01em; color: var(--text); }
/* trois points de largeur fixe : le titre ne bouge pas pendant qu'ils s'animent */
.loader__dots { display: inline-block; width: 1.2em; text-align: left; }
.loader__dots i { font-style: normal; opacity: .2; animation: loader-dot 1.4s infinite; }
.loader__dots i:nth-child(2) { animation-delay: .2s; }
.loader__dots i:nth-child(3) { animation-delay: .4s; }
@keyframes loader-dot { 0%, 100% { opacity: .2; } 40% { opacity: 1; } }
/* une ligne réservée : une étape plus longue que l'autre ne décale rien */
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
