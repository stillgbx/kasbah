<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { IconName } from '../../lib/strokeIcons'
import StrokeIcon from './StrokeIcon.vue'
import { primeArtUrl } from './artThumbLoader'

// Pochette YT Music : `<img referrerpolicy="no-referrer">` — un `background-image`
// CSS envoie le Referer et Chrome bloque (net::ERR_BLOCKED_BY_ORB) sur ggpht / googleusercontent.
// Chargement : IntersectionObserver + file partagée (dédup URL, max 4 en parallèle).

const props = withDefaults(defineProps<{
  src?: string | null
  round?: boolean
  /** Icône pendant le chargement / sans URL (artiste / album / titre / playlist). */
  icon?: IconName
}>(), {
  src: null,
  round: false,
  icon: 'music',
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
  <div ref="root" class="art-wrap" :class="{ 'art-wrap--round': round }">
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
    >
    <div v-else class="art art--empty" :class="{ 'art--round': round }">
      <StrokeIcon :name="icon" :size="18" />
    </div>
  </div>
</template>

<style scoped>
.art-wrap {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
}
.art-wrap--round { border-radius: 999px; overflow: hidden; }
.art {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  display: block;
  background-color: color-mix(in srgb, var(--muted) 18%, transparent);
}
.art--round { border-radius: 999px; }
.art--empty { display: grid; place-items: center; color: var(--muted); }
</style>
