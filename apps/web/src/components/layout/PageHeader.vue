<script setup lang="ts">
import { useHouseStore } from '../../stores/house'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { paletteRequest } from '../../composables/useSearch'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Common header: the house's name + a live summary (lights, temperature, solar), and a slot on the right
// — passed UNDER the title, at full width, on a portrait phone. The summary fits on one line
// and scrolls when too long: it no longer stacks word by word when space runs out.
// At the far right, on every page, the button of the Ctrl+K palette (search and assistant): it stays
// on the title's line on a portrait phone, where there is no keyboard to type the shortcut.
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
    <button type="button" class="pill page-header__ask" :title="$t('search.open')" :aria-label="$t('search.open')" @click="paletteRequest++">
      <StrokeIcon name="sparkle" :size="18" />
    </button>
  </header>
</template>

<style scoped>
.page-header { display: flex; align-items: center; gap: 20px; padding: calc(var(--safe-top) + 16px) var(--page-x) 16px; flex: 0 0 auto; }
.page-header__titles { flex: 1 1 0; min-width: 120px; }   /* they take the free space: the slot stays on the right */
.page-header__title { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page-header__sub { font-size: 13px; color: var(--muted); margin-top: 2px; }
.page-header__ask { flex: none; }   /* 52 px, like the House view's pills: same column on a phone */
@media (max-width: 599px) {
  .page-header { flex-wrap: wrap; gap: 10px 8px; padding-top: calc(var(--safe-top) + 12px); padding-bottom: 12px; }
  /* the titles and the button fill the first line, the slot goes under it */
  .page-header__titles { flex-basis: calc(100% - 52px - 8px); order: -2; }
  .page-header__ask { order: -1; }
}
@media (min-width: 600px) and (max-height: 500px) {
  .page-header { gap: 12px; padding-top: calc(var(--safe-top) + 10px); padding-bottom: 10px; }
}
</style>
