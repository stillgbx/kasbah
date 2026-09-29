<script setup lang="ts">
import { useHouseStore } from '../../stores/house'
import { useHomeSummary } from '../../composables/useHomeSummary'
import MarqueeText from '../ui/MarqueeText.vue'

// En-tête commun : nom de la maison + résumé vivant (lumières, température, solaire), et un slot à droite
// — passé SOUS le titre, en pleine largeur, sur un téléphone en portrait. Le résumé tient sur une ligne
// et défile quand il est trop long : il ne s'empile plus mot par mot quand la place manque.
const house = useHouseStore()
const summary = useHomeSummary()
</script>

<template>
  <header class="page-header">
    <div class="page-header__titles">
      <div class="page-header__title">{{ house.house?.name ?? 'Kasbah' }}</div>
      <MarqueeText class="page-header__sub" :text="summary.headline.value" />
    </div>
    <slot />
  </header>
</template>

<style scoped>
.page-header { display: flex; align-items: center; gap: 20px; padding: calc(var(--safe-top) + 16px) var(--page-x) 16px; flex: 0 0 auto; }
.page-header__titles { flex: 1 1 0; min-width: 120px; }   /* ils prennent la place libre : le slot reste à droite */
.page-header__title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page-header__sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
@media (max-width: 599px) {
  .page-header { flex-wrap: wrap; gap: 10px 8px; padding-top: calc(var(--safe-top) + 12px); padding-bottom: 12px; }
  .page-header__titles { flex-basis: 100%; }
}
@media (min-width: 600px) and (max-height: 500px) {
  .page-header { gap: 12px; padding-top: calc(var(--safe-top) + 10px); padding-bottom: 10px; }
}
</style>
