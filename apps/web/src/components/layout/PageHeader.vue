<script setup lang="ts">
import { useHouseStore } from '../../stores/house'
import { useHomeSummary } from '../../composables/useHomeSummary'

// En-tête commun : nom de la maison + résumé vivant (lumières, température, solaire), et un slot à droite.
const house = useHouseStore()
const summary = useHomeSummary()
</script>

<template>
  <header class="page-header">
    <div class="page-header__titles">
      <div class="page-header__title">{{ house.house?.name ?? 'Kasbah' }}</div>
      <div class="page-header__sub">{{ summary.headline.value }}</div>
    </div>
    <div class="page-header__spacer" />
    <slot />
  </header>
</template>

<style scoped>
.page-header { display: flex; align-items: center; gap: 20px; padding: calc(var(--safe-top) + 16px) 24px 16px; flex: 0 0 auto; }
.page-header__titles { min-width: 0; }
.page-header__title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page-header__sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
.page-header__spacer { flex: 1 1 0; }
</style>
