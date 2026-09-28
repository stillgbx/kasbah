<script setup lang="ts">
import { computed, ref } from 'vue'

// Vignette d'un ouvrant dans une ligne de la vue Ouvrants : elle EST l'ouvrant, vu de face. Le fond
// est la baie (teinte d'accent douce : le jour qui passe), le tablier descend depuis le haut de la
// part de FERMETURE (0 % = ouvert, voir `lib/cover.ts`). Un curseur horizontal se lisait à
// l'envers du geste réel : un volet, un store, une porte de garage bougent de haut en bas. Seul un
// portail se ferme de côté (`axis: 'horizontal'`, le vantail entre par la gauche).
//
// Glissement RELATIF, jamais « là où tombe le doigt » : sur une tablette, un doigt qui fait défiler
// la page et se pose sur la vignette ne doit pas envoyer l'ouvrant à l'autre bout. Un simple appui
// ne commande rien. `touch-action: none` sur la vignette seule : elle est étroite, la page défile
// partout ailleurs.
const props = defineProps<{
  /** Fermeture affichée, 0..100 ; `undefined` = position inconnue (rien à affirmer). */
  closure?: number
  /** Position favorite du moteur, en fermeture : un repère sur la vignette. */
  preset?: number
  interactive: boolean
  /** Nature de l'ouvrant (`meta.cover.deviceClass`) : elle décide du sens et de la matière. */
  deviceClass?: string
  label: string
}>()
// Un portail se ferme de côté ; tout le reste de haut en bas. Des lames pour ce qui se roule ou se
// replie par panneaux (volet roulant, porte de garage), une toile unie pour le reste.
const axis = computed(() => (props.deviceClass === 'gate' ? 'horizontal' : 'vertical'))
const slats = computed(() => props.deviceClass === 'shutter' || props.deviceClass === 'garage')
const emit = defineEmits<{ drag: [v: number]; commit: [v: number] }>()

const el = ref<HTMLElement | null>(null)
const dragging = ref(false)
let start: { at: number; from: number; size: number; moved: boolean } | null = null

const clamp = (v: number) => Math.max(0, Math.min(100, v))
const pos = (ev: PointerEvent) => (axis.value === 'vertical' ? ev.clientY : ev.clientX)

function down(ev: PointerEvent) {
  if (!props.interactive || !el.value) return
  const r = el.value.getBoundingClientRect()
  start = { at: pos(ev), from: props.closure ?? 0, size: axis.value === 'vertical' ? r.height : r.width, moved: false }
  el.value.setPointerCapture(ev.pointerId)
}
function move(ev: PointerEvent) {
  if (!start) return
  const d = pos(ev) - start.at
  // un seuil de quelques pixels : un appui qui tremble n'est pas un glissement
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
}
// Clavier : haut / gauche ouvre, bas / droite ferme, par pas de 10 ; chaque touche commande.
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
/* Taille réglable par le parent (`--pill-w`, `--pill-h`, propriétés héritées) : 44 px de large
   dans une ligne de liste, en grand dans le panneau appareil. */
.pill {
  position: relative; overflow: hidden; width: var(--pill-w, 44px); min-height: var(--pill-h, 76px); height: 100%;
  border-radius: var(--pill-r, 12px);
  /* la baie ouverte : un jour d'accent, plus vif en haut, pour qu'un ouvrant ouvert se remarque */
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 42%, transparent), color-mix(in srgb, var(--accent) 14%, transparent));
  /* le cadre de la baie : un trait fin, pour qu'une vignette toute fermée garde ses bords */
  box-shadow: inset 0 0 0 1px var(--line);
  /* 1re colonne de la ligne, sur la hauteur du nom ET des touches (voir `.controls` de la vue) */
  grid-row: var(--pill-rows, span 2);
}
.pill[data-interactive='1'] { cursor: ns-resize; touch-action: none; }
.pill[data-interactive='1'][data-axis='horizontal'] { cursor: ew-resize; }
.pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* position inconnue : la baie en pointillés, sans tablier — on n'affirme rien d'un moteur muet */
.pill[data-unknown='1'] { background: transparent; box-shadow: none; outline: 1px dashed var(--line); outline-offset: -1px; }
.pill__fill {
  /* 5 px au moins : le coffre du tablier enroulé, pour que la lame finale reste visible (et saisissable
     à l'œil) sur un ouvrant tout ouvert */
  position: absolute; left: 0; top: 0; width: 100%; height: max(5px, calc(var(--c) * 100%));
  background: color-mix(in srgb, var(--text) 26%, var(--surface2));
  /* la lame finale : le bord qui bouge, et la prise visible du glissement */
  box-shadow: inset 0 -3px 0 var(--accent);
  transition: height .4s ease, width .4s ease;
}
.pill[data-slats='1'] .pill__fill {
  background-image: repeating-linear-gradient(180deg, transparent 0 5px, color-mix(in srgb, var(--bg) 30%, transparent) 5px 6px);
  background-color: color-mix(in srgb, var(--text) 26%, var(--surface2));
}
.pill[data-axis='horizontal'] .pill__fill { height: 100%; width: max(5px, calc(var(--c) * 100%)); box-shadow: inset -3px 0 0 var(--accent); }
.pill[data-unknown='1'] .pill__fill { display: none; }
/* pendant le glissement, le tablier suit le doigt sans retard */
.pill[data-dragging='1'] .pill__fill { transition: none; }
/* repère de position favorite : même teinte d'avertissement que sur le curseur du panneau */
.pill__preset {
  position: absolute; left: 6px; right: 6px; top: calc(var(--p) * 100%); height: 2px; margin-top: -1px;
  border-radius: 1px; background: rgb(var(--v-theme-warning)); pointer-events: none;
}
.pill[data-axis='horizontal'] .pill__preset { top: 6px; bottom: 6px; left: calc(var(--p) * 100%); width: 2px; height: auto; margin: 0 0 0 -1px; }
@media (prefers-reduced-motion: reduce) { .pill__fill { transition: none; } }
</style>
