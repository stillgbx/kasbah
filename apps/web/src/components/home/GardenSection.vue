<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GARDEN_KINDS, type GardenKind } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import { GARDEN_ICON } from '../../lib/gardenIcons'
import { SPECIES, type SpeciesRecipe } from '../../three/garden/species'
import StrokeIcon from '../ui/StrokeIcon.vue'

// "Garden" section of the house panel in edit mode: one key per family. Touching a family ARMS it
// (generic shape) and shows ITS species below — the catalog grows, we no longer spread them all
// out. Each tap on the ground then plants an item, until "Done".
const house = useHouseStore()
const { locale } = useI18n()
const speciesName = (s: SpeciesRecipe) => (locale.value.startsWith('en') ? s.name.en : s.name.fr)

/** The family whose species are shown: the last one touched, and it stays so after "Done". */
const family = ref<GardenKind | null>(house.placingGarden?.kind ?? null)
const familySpecies = computed(() => SPECIES.filter((s) => s.kind === family.value))
function pickFamily(k: GardenKind) {
  family.value = k
  toggle(k)
}

/** Armed exactly: the family alone (generic shape), or this species. */
const armed = (kind: GardenKind, species?: string) => house.placingGarden?.kind === kind && house.placingGarden.species === species
function toggle(kind: GardenKind, species?: string) {
  if (armed(kind, species)) house.cancelPlacingGarden()
  else house.startPlacingGarden(kind, species)
}
</script>

<template>
  <section class="block">
    <div class="kinds">
      <button v-for="k in GARDEN_KINDS" :key="k" type="button" class="kind"
              :data-on="armed(k) ? '1' : '0'" :data-sel="family === k ? '1' : '0'" :disabled="house.savingGarden && !armed(k)"
              :aria-pressed="armed(k)" @click="pickFamily(k)">
        <StrokeIcon :name="GARDEN_ICON[k]" :size="20" />
        <span class="kind__label">{{ $t(`garden.kinds.${k}`) }}</span>
      </button>
    </div>
    <!-- button always present: only its state changes, the section does not jump when arming -->
    <button type="button" class="pill add" :class="{ 'add--armed': house.placingGarden }"
            :disabled="!house.placingGarden" @click="house.cancelPlacingGarden()">
      {{ $t('garden.done') }}
    </button>
    <p class="muted hint">{{ house.placingGarden ? $t('garden.placeHint') : $t('garden.hint') }}</p>
    <!-- under the button and the instruction: the list changes height from one family to another, it
         pushes nothing of what is touched above -->
    <template v-if="family">
      <div class="section-label">{{ $t('garden.species') }} · {{ $t(`garden.kinds.${family}`) }}</div>
      <div v-if="familySpecies.length" class="species">
        <button v-for="s in familySpecies" :key="s.id" type="button" class="pill pill--sm sp"
                :data-on="armed(s.kind, s.id) ? '1' : '0'" :aria-pressed="armed(s.kind, s.id)" @click="toggle(s.kind, s.id)">
          {{ speciesName(s) }}
        </button>
      </div>
      <p v-else class="muted empty">{{ $t('garden.noSpecies') }}</p>
    </template>
  </section>
</template>

<style scoped>
.block { display: grid; gap: 8px; }
.kinds { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
.kind {
  display: grid; justify-items: center; gap: 4px; padding: 8px 2px; min-width: 0;
  border: 1px solid transparent; border-radius: var(--radius); background: var(--surface2);
  color: inherit; font: inherit; cursor: pointer; transition: background .15s, color .15s, border-color .15s;
}
.kind:hover:not(:disabled) { color: var(--accent); }
.kind[data-sel='1'] { border-color: var(--line); }
.kind[data-on='1'] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.kind:disabled { opacity: .5; }
.kind__label { font-size: 11px; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.species { display: flex; flex-wrap: wrap; gap: 6px; }
.sp { gap: 6px; }
.sp[data-on='1'] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.add { width: 100%; justify-content: center; }
.add--armed { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.hint { font-size: 12px; margin: 0; min-height: 32px; }
.empty { font-size: 13px; margin: 0; }
</style>
