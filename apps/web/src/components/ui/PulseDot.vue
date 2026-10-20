<script setup lang="ts">
// Pulsing dot "something is in progress". Its SPACE IS ALWAYS RESERVED: off, it stays a
// transparent square of the same size. An indicator that appears and disappears while taking up
// room shifts its neighbors — a slider that changes width, a row that pushes the one below. User
// rule, applied here once for the three places that display it.
//
// The parent handles the spacing (a `flex` row has its `gap`, a text needs a margin).
defineProps<{ on: boolean; size?: number }>()
</script>

<template>
  <span class="pulse" :data-on="on ? '1' : '0'" :style="{ '--dot': `${size ?? 6}px` }" aria-hidden="true" />
</template>

<style scoped>
.pulse {
  display: inline-block; flex: 0 0 auto; vertical-align: middle;
  width: var(--dot); height: var(--dot); border-radius: 50%; background: transparent;
}
.pulse[data-on='1'] { background: currentColor; animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
</style>
