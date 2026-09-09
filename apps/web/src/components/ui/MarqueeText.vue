<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Texte sur une ligne qui, s'il ne tient pas dans la place qu'on lui donne, défile lentement d'un
// bout à l'autre et revient, avec un fondu aux deux bords pour dire qu'il continue. S'il tient, rien
// ne bouge et rien ne s'affiche de plus : ni fondu, ni animation. Règle « rien ne doit bouger » : le
// composant occupe toujours une ligne de la même hauteur, quel que soit le texte.
//
// La distance et la durée sont calculées à partir du débordement mesuré (vitesse constante d'environ
// 24 px/s, bornée), avec une pause à chaque extrémité pour laisser lire le début et la fin. Sous
// `prefers-reduced-motion`, on revient à des points de suspension.
const props = defineProps<{ text: string }>()

const wrap = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)
const overflow = ref(0)
let observer: ResizeObserver | null = null

const SPEED_PX_S = 24
const MIN_S = 6
const MAX_S = 30

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
watch(() => props.text, () => void nextTick(measure))

const duration = () => `${Math.min(MAX_S, Math.max(MIN_S, overflow.value / SPEED_PX_S + 4))}s`
</script>

<template>
  <div ref="wrap" class="marquee" :data-scrolling="overflow > 0 ? '1' : '0'"
       :style="{ '--marquee-shift': `-${overflow}px`, '--marquee-duration': duration() }" :title="overflow > 0 ? text : undefined">
    <span ref="inner" class="marquee__inner">{{ text }}</span>
  </div>
</template>

<style scoped>
/* `contain: inline-size` : la largeur du texte ne compte pas dans la largeur minimale du parent.
   Sans lui, un titre long (inline-block, sans retour à la ligne) élargissait tout le panneau et
   poussait le bouton « Déplacer » hors de l'écran, au lieu de déborder ici. */
.marquee { position: relative; overflow: hidden; white-space: nowrap; min-width: 0; contain: inline-size; }
.marquee__inner { display: inline-block; will-change: transform; }
/* le fondu n'existe que quand ça défile : sinon un texte court se retrouverait délavé aux bords */
.marquee[data-scrolling="1"] {
  mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
}
.marquee[data-scrolling="1"] .marquee__inner {
  animation: marquee-slide var(--marquee-duration) ease-in-out infinite;
}
/* pause au départ (20 %), traversée, pause à l'arrivée (20 %), retour. Les 12 px aux deux bouts
   sortent le début et la fin du texte de la zone de fondu pendant les pauses ; la mesure du
   débordement, elle, se fait sans décalage, donc ne dépend pas de l'animation. */
@keyframes marquee-slide {
  0%, 20% { transform: translateX(12px); }
  50%, 70% { transform: translateX(calc(var(--marquee-shift) - 12px)); }
  100% { transform: translateX(12px); }
}
@media (prefers-reduced-motion: reduce) {
  .marquee[data-scrolling="1"] { mask-image: none; -webkit-mask-image: none; text-overflow: ellipsis; }
  .marquee[data-scrolling="1"] .marquee__inner { animation: none; display: inline; }
}
</style>
