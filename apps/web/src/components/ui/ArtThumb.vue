<script setup lang="ts">
import StrokeIcon from './StrokeIcon.vue'

// Pochette YT Music : `<img referrerpolicy="no-referrer">` — un `background-image`
// CSS envoie le Referer et Chrome bloque (net::ERR_BLOCKED_BY_ORB) sur ggpht / googleusercontent.

withDefaults(defineProps<{
  src?: string | null
  round?: boolean
}>(), {
  src: null,
  round: false,
})
</script>

<template>
  <img
    v-if="src"
    class="art"
    :class="{ 'art--round': round }"
    :src="src"
    alt=""
    referrerpolicy="no-referrer"
    loading="lazy"
    decoding="async"
  >
  <div v-else class="art art--empty" :class="{ 'art--round': round }">
    <StrokeIcon name="music" :size="18" />
  </div>
</template>

<style scoped>
.art {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  flex: 0 0 auto;
  object-fit: cover;
  background-color: color-mix(in srgb, var(--muted) 18%, transparent);
}
.art--round { border-radius: 999px; }
.art--empty { display: grid; place-items: center; color: var(--muted); }
</style>
