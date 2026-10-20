<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IconName } from '../../lib/strokeIcons'
import StrokeIcon from './StrokeIcon.vue'
import { primeArtUrl } from './artThumbLoader'

// YT Music cover art: `<img referrerpolicy="no-referrer">` — a CSS `background-image`
// sends the Referer and Chrome blocks (net::ERR_BLOCKED_BY_ORB) on ggpht / googleusercontent.
// Loading: IntersectionObserver + shared queue (URL dedup, max 4 in parallel). An image that does
// not come (a radio logo that disappeared, a direct link refused) leaves the icon, not the
// browser's broken image.

const props = withDefaults(defineProps<{
  src?: string | null
  round?: boolean
  /** Icon while loading / without a URL (artist / album / track / playlist). */
  icon?: IconName
  /** Side in px (square) — 44 in lists, larger in the player and the tiles. */
  size?: number
}>(), {
  src: null,
  round: false,
  icon: 'music',
  size: 44,
})

const root = ref<HTMLElement | null>(null)
const inView = ref(false)
const displaySrc = ref<string | null>(null)
let io: IntersectionObserver | null = null
let gen = 0

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') {
    inView.value = true
    return
  }
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        inView.value = true
        io?.disconnect()
        io = null
      }
    },
    { rootMargin: '160px 0px' },
  )
  if (root.value) io.observe(root.value)
})

onBeforeUnmount(() => {
  io?.disconnect()
  io = null
})

watch(
  () => [props.src, inView.value] as const,
  async ([url, visible]) => {
    const id = ++gen
    if (!url || !visible) {
      displaySrc.value = null
      return
    }
    await primeArtUrl(url)
    if (id !== gen) return
    displaySrc.value = url
  },
  { immediate: true },
)
</script>

<template>
  <div ref="root" class="art-wrap" :class="{ 'art-wrap--round': round, 'art-wrap--img': !!displaySrc }" :style="{ '--art': `${props.size}px` }">
    <img
      v-if="displaySrc"
      class="art"
      :class="{ 'art--round': round }"
      :src="displaySrc"
      alt=""
      width="44"
      height="44"
      referrerpolicy="no-referrer"
      decoding="async"
      @error="displaySrc = null"
    >
    <div v-else class="art art--empty" :class="{ 'art--round': round }">
      <StrokeIcon :name="icon" :size="18" />
    </div>
  </div>
</template>

<style scoped>
.art-wrap {
  width: var(--art, 44px);
  height: var(--art, 44px);
  flex: 0 0 auto;
}
.art-wrap--round { border-radius: 999px; overflow: hidden; }
/* A veil that darkens the bottom of each cover art (0 → 25% black): a page full of images screams
   less, without hiding anything. Only on a real image (not on the waiting icon), at the corner
   radius of the cover art; the play buttons set on top stay above. */
.art-wrap--img { position: relative; border-radius: 6px; overflow: hidden; }
.art-wrap--round.art-wrap--img { border-radius: 999px; }
/* the corner radius is that of the cover art that carries it (a parent can change it, the detail has it at 10 px) */
.art-wrap--img::after {
  content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
  background: linear-gradient(to bottom, rgb(0 0 0 / 0) 0, rgb(0 0 0 / .25) 100%);
}
.art {
  width: var(--art, 44px);
  height: var(--art, 44px);
  border-radius: 6px;
  object-fit: cover;
  display: block;
  background-color: color-mix(in srgb, var(--muted) 18%, transparent);
}
.art--round { border-radius: 999px; }
.art--empty { display: grid; place-items: center; color: var(--muted); }
</style>
