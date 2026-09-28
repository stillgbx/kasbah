<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Les genres d'un mix, en pastilles sur une ligne de hauteur fixe : sur Mixcloud, le style d'une
// émission est un critère de choix, il doit se lire d'un coup d'œil. Un genre gardé par le filtre
// s'allume.
//
// Ce qui ne tient pas s'estompe au bord droit (la suite existe) et défile, comme `MarqueeText` : au
// survol de la tuile ou de la ligne sur un écran à souris, en continu sur un écran tactile, qui n'a
// pas de survol. Vitesse constante, pause à chaque bout ; sous `prefers-reduced-motion`, rien ne défile.
const props = defineProps<{ genres: { slug: string; name: string }[]; kept?: ReadonlySet<string> }>()

const wrap = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)
const overflow = ref(0)
let observer: ResizeObserver | null = null

const SPEED_PX_S = 30
const MIN_S = 4
const MAX_S = 20

function measure(): void {
  const w = wrap.value, i = inner.value
  if (!w || !i) return
  overflow.value = Math.max(0, Math.ceil(i.scrollWidth - w.clientWidth))
}
onMounted(() => {
  measure()
  observer = new ResizeObserver(() => measure())
  if (wrap.value) observer.observe(wrap.value)
})
onBeforeUnmount(() => observer?.disconnect())
watch(() => props.genres, () => void nextTick(measure))

const duration = () => `${Math.min(MAX_S, Math.max(MIN_S, (overflow.value / SPEED_PX_S) * 2 + 3))}s`
</script>

<template>
  <div ref="wrap" class="gp" :data-overflow="overflow > 0 ? '1' : '0'"
       :style="{ '--gp-shift': `-${overflow}px`, '--gp-duration': duration() }">
    <div ref="inner" class="gp__inner">
      <span v-for="g in genres" :key="g.slug" class="gp__pill" :data-on="kept?.has(g.slug) ? '1' : '0'">{{ g.name }}</span>
    </div>
  </div>
</template>

<style scoped>
.gp { position: relative; height: 20px; min-width: 0; overflow: hidden; contain: inline-size; }
/* `flex` + `max-content`, pas `inline-flex` : posé sur la ligne de base, il descendait de 4 px et le
   bas des pastilles était rogné */
.gp__inner { display: flex; width: max-content; gap: 4px; will-change: transform; }
.gp__pill {
  flex: 0 0 auto; height: 20px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--line);
  background: var(--surface2); color: var(--text); font-size: 11px; line-height: 18px; white-space: nowrap;
}
/* couleur seulement : un gras élargirait la pastille, et le défilement mesuré ne serait plus le bon */
.gp__pill[data-on='1'] { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
/* au repos : la suite s'estompe à droite */
.gp[data-overflow='1'] {
  mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent 100%);
  -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent 100%);
}
/* en défilement : fondu aux deux bords, comme MarqueeText */
@media (hover: none) {
  .gp[data-overflow='1'] {
    mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
  }
  .gp[data-overflow='1'] .gp__inner { animation: gp-slide var(--gp-duration) ease-in-out infinite; }
}
@media (hover: hover) {
  :is(.tile, .row):hover .gp[data-overflow='1'], .gp[data-overflow='1']:hover {
    mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
    -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
  }
  :is(.tile, .row):hover .gp[data-overflow='1'] .gp__inner, .gp[data-overflow='1']:hover .gp__inner {
    animation: gp-slide var(--gp-duration) ease-in-out infinite;
  }
}
/* départ à 0 (le repos, sans à-coup au survol), traversée, pause à l'arrivée, retour */
@keyframes gp-slide {
  0%, 15% { transform: translateX(0); }
  50%, 65% { transform: translateX(calc(var(--gp-shift) - 12px)); }
  100% { transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .gp[data-overflow='1'] .gp__inner { animation: none !important; }
}
</style>
