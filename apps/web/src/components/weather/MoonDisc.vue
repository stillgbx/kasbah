<script setup lang="ts">
import { computed } from 'vue'

// The drawn moon phase: the half lit on the sun's side, closed by the terminator, a
// half-ellipse of radius r·|1 − 2f|. Mirrored when the moon is waning, and again in the southern hemisphere,
// where it is seen upside down.
const props = defineProps<{
  /** Lit share, 0 to 1. */
  fraction: number
  /** Age in the cycle, 0 to 1 (0.5 = full moon). */
  phase: number
  /** View from the southern hemisphere. */
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
/* the lit part keeps a moon tint whatever the theme (the text color would blacken it
   in light mode); a fine edge detaches it from a white map background */
.moon-disc__lit { fill: color-mix(in oklab, var(--cat-light) 18%, #f3efe4); }
.moon-disc__rim { fill: none; stroke: var(--muted); stroke-opacity: .35; stroke-width: 1; vector-effect: non-scaling-stroke; }
</style>
