<script setup lang="ts">
import { computed } from 'vue'

// La phase de la lune dessinée : la moitié éclairée côté soleil, fermée par le terminateur, une
// demi-ellipse de rayon r·|1 − 2f|. Miroir quand la lune décroît, et encore dans l'hémisphère sud,
// où on la voit à l'envers.
const props = defineProps<{
  /** Part éclairée, 0 à 1. */
  fraction: number
  /** Âge dans le cycle, 0 à 1 (0,5 = pleine lune). */
  phase: number
  /** Vue de l'hémisphère sud. */
  south?: boolean
}>()

const lit = computed(() => {
  const rx = (12 * Math.abs(1 - 2 * props.fraction)).toFixed(2)
  return `M14 2 A12 12 0 0 1 14 26 A${rx} 12 0 0 ${props.fraction < 0.5 ? 0 : 1} 14 2 Z`
})
const mirror = computed(() => (props.phase > 0.5) !== !!props.south)
</script>

<template>
  <svg viewBox="0 0 28 28" class="moon-disc" aria-hidden="true">
    <circle cx="14" cy="14" r="12" class="moon-disc__dark" />
    <path :d="lit" class="moon-disc__lit" :transform="mirror ? 'matrix(-1 0 0 1 28 0)' : undefined" />
    <circle cx="14" cy="14" r="12" class="moon-disc__rim" />
  </svg>
</template>

<style scoped>
.moon-disc { display: block; }
.moon-disc__dark { fill: var(--line); }
/* la part éclairée garde une teinte de lune quel que soit le thème (la couleur du texte la noircirait
   en clair) ; un liseré la détache d'un fond de carte blanc */
.moon-disc__lit { fill: color-mix(in oklab, var(--cat-light) 18%, #f3efe4); }
.moon-disc__rim { fill: none; stroke: var(--muted); stroke-opacity: .35; stroke-width: 1; vector-effect: non-scaling-stroke; }
</style>
