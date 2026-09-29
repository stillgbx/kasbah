<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GARDEN_KINDS, type GardenKind } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import { GARDEN_ICON } from '../../lib/gardenIcons'
import { SPECIES, type SpeciesRecipe } from '../../three/garden/species'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Section « Jardin » du panneau de la maison en mode édition : une touche par famille. Toucher une
// famille l'ARME ; chaque tap sur le terrain plante alors un élément, jusqu'à « Terminé ».
const house = useHouseStore()
const { locale } = useI18n()
const count = computed(() => house.gardenItems.length)
const speciesName = (s: SpeciesRecipe) => (locale.value.startsWith('en') ? s.name.en : s.name.fr)

/** Armée exactement : la famille seule (forme générique), ou cette espèce. */
const armed = (kind: GardenKind, species?: string) => house.placingGarden?.kind === kind && house.placingGarden.species === species
function toggle(kind: GardenKind, species?: string) {
  if (armed(kind, species)) house.cancelPlacingGarden()
  else house.startPlacingGarden(kind, species)
}
</script>

<template>
  <section class="block">
    <div class="section-label">{{ $t('garden.list') }} · {{ $t('garden.count', { n: count }, count) }}</div>
    <div class="kinds">
      <button v-for="k in GARDEN_KINDS" :key="k" type="button" class="kind"
              :data-on="armed(k) ? '1' : '0'" :disabled="house.savingGarden && !armed(k)"
              :aria-pressed="armed(k)" @click="toggle(k)">
        <StrokeIcon :name="GARDEN_ICON[k]" :size="20" />
        <span class="kind__label">{{ $t(`garden.kinds.${k}`) }}</span>
      </button>
    </div>
    <div v-if="SPECIES.length" class="species">
      <button v-for="s in SPECIES" :key="s.id" type="button" class="pill pill--sm sp"
              :data-on="armed(s.kind, s.id) ? '1' : '0'" :aria-pressed="armed(s.kind, s.id)" @click="toggle(s.kind, s.id)">
        <StrokeIcon :name="GARDEN_ICON[s.kind]" :size="14" /> {{ speciesName(s) }}
      </button>
    </div>
    <!-- bouton toujours présent : seul son état change, la section ne saute pas quand on arme -->
    <button type="button" class="pill add" :class="{ 'add--armed': house.placingGarden }"
            :disabled="!house.placingGarden" @click="house.cancelPlacingGarden()">
      {{ $t('garden.done') }}
    </button>
    <p class="muted hint">{{ house.placingGarden ? $t('garden.placeHint') : $t('garden.hint') }}</p>
  </section>
</template>

<style scoped>
.block { display: grid; gap: 8px; margin-bottom: 16px; }
.kinds { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.kind {
  display: grid; justify-items: center; gap: 4px; padding: 8px 2px; min-width: 0;
  border: 1px solid transparent; border-radius: var(--radius); background: var(--surface2);
  color: inherit; font: inherit; cursor: pointer; transition: background .15s, color .15s, border-color .15s;
}
.kind:hover:not(:disabled) { color: var(--accent); }
.kind[data-on='1'] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.kind:disabled { opacity: .5; }
.kind__label { font-size: 11px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.species { display: flex; flex-wrap: wrap; gap: 6px; }
.sp { gap: 6px; }
.sp[data-on='1'] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.add { width: 100%; justify-content: center; }
.add--armed { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.hint { font-size: 12px; margin: 0; min-height: 32px; }
</style>
