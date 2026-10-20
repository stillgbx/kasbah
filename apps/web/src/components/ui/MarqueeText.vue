<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

// Single-line text that, if it does not fit in the space it is given, slowly scrolls from one
// end to the other and back, with a fade at both edges to say it continues. If it fits, nothing
// moves and nothing more is shown: no fade, no animation. "Nothing must move" rule: the
// component always takes a line of the same height, whatever the text.
//
// The distance and the duration are computed from the measured overflow (constant speed of about
// 24 px/s, bounded), with a pause at each end to let the start and the end be read. Under
// `prefers-reduced-motion`, we fall back to an ellipsis.
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
/* `contain: inline-size`: the text width does not count in the parent's minimum width.
   Without it, a long title (inline-block, no line wrapping) widened the whole panel and
   pushed the "Move" button off the screen, instead of overflowing here. */
.marquee { position: relative; overflow: hidden; white-space: nowrap; min-width: 0; contain: inline-size; }
.marquee__inner { display: inline-block; will-change: transform; }
/* the fade only exists while it scrolls: otherwise a short text would end up washed out at the edges */
.marquee[data-scrolling="1"] {
  mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%);
}
.marquee[data-scrolling="1"] .marquee__inner {
  animation: marquee-slide var(--marquee-duration) ease-in-out infinite;
}
/* pause at the start (20%), traverse, pause at the end (20%), return. The 12 px at both ends
   take the start and end of the text out of the fade zone during the pauses; the overflow
   measurement, for its part, is done without offset, so it does not depend on the animation. */
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
