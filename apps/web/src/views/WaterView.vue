<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import WaterCard from '../components/controls/WaterCard.vue'
import WaterConsumptionChart from '../components/water/WaterConsumptionChart.vue'
import MarqueeText from '../components/ui/MarqueeText.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { useConsumption } from '../composables/useConsumption'
import { headlineValue, statusLabel } from '../lib/deviceState'
import { useDevicesStore } from '../stores/devices'
import { HOUSEHOLD_SIZE_MAX, HOUSEHOLD_SIZE_MIN, useSettingsStore } from '../stores/settings'

// Vue Traitement de l'eau : un appareil unique par installation, comme la météo — pas de liste à
// parcourir pour le lire, la carte détaillée (WaterCard, déjà utilisée dans le panneau d'appareil
// de la scène 3D) reprend donc toute la place en tête de page, précédée d'une grande valeur comme
// la température de la vue Météo. RoomBands, en dessous, apporte le diagnostic de liaison et le
// bouton « Placer » (même bande que Lumières/Ouvrants/Énergie) : la station doit pouvoir être posée
// dans la maison 3D comme n'importe quel autre appareil.
const devices = useDevicesStore()
const settings = useSettingsStore()
const { t, locale } = useI18n()

/** Le premier appareil eau DISPONIBLE, sinon le premier tout court (grisé) — même règle que la météo. */
const entry = computed(() => {
  const list = devices.list.filter((e) => e.state.kind === 'water')
  return list.find((e) => e.state.available) ?? list[0]
})
const state = computed(() => entry.value?.state as StateFor<'water'> | undefined)
const brand = computed(() => [entry.value?.descriptor.meta.manufacturer, entry.value?.descriptor.meta.model].filter(Boolean).join(' · '))
const headline = computed(() => (entry.value && state.value ? headlineValue(entry.value.descriptor, state.value, t, locale.value) : '—'))
const status = computed(() => (entry.value && state.value ? statusLabel(entry.value.descriptor, state.value, t, locale.value) : t('common.unknown')))

const caps = computed(() => new Set(entry.value?.descriptor.capabilities ?? []))
const hasChart = computed(() => caps.value.has('water_usage'))
const { consumption } = useConsumption(computed(() => entry.value?.descriptor.id))
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__scroll">
      <div v-if="!entry" class="card card--soft empty muted">{{ $t('water.noDevice') }}</div>
      <!-- Carte détail + graphique : à droite l'un de l'autre dès que la largeur le permet (voir
           `.water__top` plus bas), l'un sous l'autre sinon. `--solo` (pas de capacité `water_usage`,
           donc pas de graphique) garde une seule colonne : le détail seul n'a pas à se coller à gauche. -->
      <div v-else class="water__top" :class="{ 'water__top--solo': !hasChart }">
        <section class="card hero">
          <div class="hero__head">
            <span class="icon-square" :data-on="state?.available ? '1' : '0'">
              <StrokeIcon name="droplet" :size="18" />
            </span>
            <div class="hero__main">
              <MarqueeText class="hero__name" :text="entry.descriptor.name" />
              <div class="muted hero__sub">{{ brand }}</div>
            </div>
            <div class="hero__stat">
              <div class="hero__value">{{ headline }}</div>
              <div class="muted hero__status">{{ status }}</div>
            </div>
          </div>
          <WaterCard v-if="state" :descriptor="entry.descriptor" :state="state" />
          <!-- Foyer déclaré : réglage d'AFFICHAGE (pas une commande de l'appareil), discret, au pied
               de la carte détail — nourrit le repère de moyenne française du graphique voisin. Ne
               s'affiche que si le graphique existe (`hasChart`) : sans historique, rien à comparer. -->
          <div v-if="hasChart" class="hero__household" :title="$t('water.referenceHint')">
            <span class="muted">{{ $t('water.household') }}</span>
            <div class="stepper">
              <button type="button" class="stepper__btn" :disabled="settings.householdSize <= HOUSEHOLD_SIZE_MIN"
                      :aria-label="$t('water.householdDec')" @click="settings.setHouseholdSize(settings.householdSize - 1)">
                <StrokeIcon name="minus" :size="14" />
              </button>
              <span class="stepper__val">{{ settings.householdSize }}</span>
              <button type="button" class="stepper__btn" :disabled="settings.householdSize >= HOUSEHOLD_SIZE_MAX"
                      :aria-label="$t('water.householdInc')" @click="settings.setHouseholdSize(settings.householdSize + 1)">
                <StrokeIcon name="plus" :size="14" />
              </button>
            </div>
          </div>
        </section>
        <WaterConsumptionChart v-if="hasChart" :consumption="consumption" :household-size="settings.householdSize"
          :today-l="state?.todayL" :week-l="state?.weekL" :month-l="state?.monthL" />
      </div>
      <RoomBands kind="water" />
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
/* Sous 1040px (seuil mesuré, voir rapport de tâche) : une colonne, comme avant. Au-delà : la carte
   détail et le graphique côte à côte, `stretch` (défaut de `align-items`) leur donnant la même
   hauteur — même patron que `.energy__top` (EnergyView.vue).
   1040px et pas 900 (repris tel quel d'EnergyView) : l'en-tête de la carte détail réserve une
   largeur FIXE au bloc de droite (valeur + statut, ex. « Avertissement » à 32px, `.hero__stat` en
   `flex: 0 0 auto`) ; sous ~965px de fenêtre, ce qui reste à `.hero__main` (nom + marque) tombe sous
   ~90px et la marque passe sur deux lignes (`.hero__sub` n'a pas d'ellipsis, contrairement à
   `.hero__name` qui défile via `MarqueeText`) — mesuré au `getBoundingClientRect()` : 68px de large
   à 950px de fenêtre (marque sur 2 lignes, 36px de haut) contre 98px à 980px (1 ligne, 18px). 1040px
   donne de la marge au-delà de ce seuil plutôt que de coller au pixel près. */
.water__top { display: grid; gap: 20px; min-width: 0; }
@media (min-width: 1040px) { .water__top:not(.water__top--solo) { grid-template-columns: 1fr 1fr; } }
.hero { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.hero__head { display: flex; align-items: center; gap: 12px; }
.hero__main { flex: 1 1 auto; min-width: 0; }
.hero__name { font-size: 15px; font-weight: 600; }
.hero__sub { font-size: 12px; margin-top: 2px; min-height: 1em; }
/* valeur et mot d'alerte : empreinte fixe, alignés à droite comme les tuiles de la vue Météo */
.hero__stat { flex: 0 0 auto; text-align: right; }
.hero__value { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.hero__status { font-size: 12px; margin-top: 2px; }
/* Réglage discret, distinct des données au-dessus (WaterCard) par une ligne de séparation. */
.hero__household { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; }
.stepper { display: inline-flex; align-items: center; gap: 8px; }
.stepper__btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--text); cursor: pointer; }
.stepper__btn:disabled { opacity: .35; cursor: default; }
/* largeur fixe (2ch) : "9" -> "10" ne fait pas bouger les boutons de part et d'autre. */
.stepper__val { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px; }
</style>
