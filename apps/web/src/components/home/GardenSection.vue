<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GARDEN_KINDS, type GardenKind } from '@kasbah/shared'
import { useHouseStore } from '../../stores/house'
import { GARDEN_ICON } from '../../lib/gardenIcons'
import { SPECIES, type SpeciesRecipe } from '../../three/garden/species'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Section « Jardin » du panneau de la maison en mode édition : une touche par famille. Toucher une
// famille l'ARME (forme générique) et montre SES espèces dessous — le catalogue grossit, on ne les
// étale plus toutes. Chaque tap sur le terrain plante alors un élément, jusqu'à « Terminé ».
const house = useHouseStore()
const { locale } = useI18n()
const speciesName = (s: SpeciesRecipe) => (locale.value.startsWith('en') ? s.name.en : s.name.fr)

/** La famille dont on montre les espèces : la dernière touchée, et elle le reste après « Terminé ». */
const family = ref<GardenKind | null>(house.placingGarden?.kind ?? null)
const familySpecies = computed(() => SPECIES.filter((s) => s.kind === family.value))
function pickFamily(k: GardenKind) {
  family.value = k
  toggle(k)
}

/** Armée exactement : la famille seule (forme générique), ou cette espèce. */
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
    <!-- bouton toujours présent : seul son état change, la section ne saute pas quand on arme -->
    <button type="button" class="pill add" :class="{ 'add--armed': house.placingGarden }"
            :disabled="!house.placingGarden" @click="house.cancelPlacingGarden()">
      {{ $t('garden.done') }}
    </button>
    <p class="muted hint">{{ house.placingGarden ? $t('garden.placeHint') : $t('garden.hint') }}</p>
    <!-- sous le bouton et la consigne : la liste change de hauteur d'une famille à l'autre, elle ne
         pousse rien de ce qu'on touche au-dessus -->
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
