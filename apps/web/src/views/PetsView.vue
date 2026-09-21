<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceEntry, StateFor } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import RoomBands from '../components/devices/RoomBands.vue'
import PetFeederCard from '../components/controls/PetFeederCard.vue'
import PetFountainCard from '../components/controls/PetFountainCard.vue'
import MarqueeText from '../components/ui/MarqueeText.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import { headlineValue, statusLabel } from '../lib/deviceState'
import { formatFeedGrams } from '../lib/format'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { CUP_GRAMS_MAX, CUP_GRAMS_MIN, CUP_GRAMS_STEP, useSettingsStore } from '../stores/settings'

// Vue Animaux : les mangeoires et les fontaines de la maison, une carte chacune.
//
// Deux kinds dans la même vue, comme la vue Robots réunit tondeuse et aspirateur : ce qui les
// rassemble n'est pas leur contrat mais l'usage — on vient voir si le chat a mangé et bu, pas
// piloter un appareil. Les mangeoires d'abord : ce sont elles qui portent le seul geste quotidien
// (servir une ration) ; les fontaines se consultent plus qu'elles ne se pilotent.
//
// Chaque carte réutilise le contrôle du panneau d'appareil de la scène 3D (`PetFeederCard` /
// `PetFountainCard`) plutôt que de redessiner les mêmes lignes : une seule mise en page à tenir,
// et les capacités y décident déjà des sections.
const devices = useDevicesStore()
const house = useHouseStore()
const settings = useSettingsStore()
const { t, locale } = useI18n()

type FeederEntry = DeviceEntry & { state: StateFor<'pet_feeder'> }
type FountainEntry = DeviceEntry & { state: StateFor<'pet_fountain'> }
const feeders = computed(() => devices.list.filter((e): e is FeederEntry => e.state.kind === 'pet_feeder'))
const fountains = computed(() => devices.list.filter((e): e is FountainEntry => e.state.kind === 'pet_fountain'))
const isEmpty = computed(() => feeders.value.length === 0 && fountains.value.length === 0)

/** Le nom choisi dans la maison l'emporte sur celui du fabricant (même règle que la vue Robots). */
const displayName = (e: DeviceEntry) => house.houseDeviceFor(e.descriptor.id)?.name ?? e.descriptor.name
const brand = (e: DeviceEntry) => [e.descriptor.meta.manufacturer, e.descriptor.meta.model].filter(Boolean).join(' · ')
const headline = (e: DeviceEntry) => headlineValue(e.descriptor, e.state, t, locale.value)
const status = (e: DeviceEntry) => statusLabel(e.descriptor, e.state, t, locale.value)
/**
 * La contrepartie en grammes de la grande valeur, pour une mangeoire qui compte en tasses. En
 * petit À CÔTÉ du chiffre et non en dessous : une troisième ligne ferait grandir l'en-tête des
 * seules mangeoires, et les deux cartes de la rangée n'auraient plus la même hauteur de tête.
 */
function headlineGrams(e: FeederEntry): string {
  const u = e.descriptor.meta.petFeeder?.unit
  if (!u || e.state.servedToday === undefined) return ''
  return formatFeedGrams(e.state.servedToday, u, settings.cupGrams, locale.value) ?? ''
}

async function send(id: string, cmd: CommandInput): Promise<void> {
  await devices.sendCommand(id, cmd)
}
</script>

<template>
  <div class="page">
    <PageHeader />
    <div class="page__scroll">
      <div v-if="isEmpty" class="card card--soft empty muted">{{ $t('pets.noDevice') }}</div>

      <div v-else class="pets__grid">
        <section v-for="e in feeders" :key="e.descriptor.id" class="card hero">
          <div class="hero__head">
            <span class="icon-square" :data-on="e.state.available ? '1' : '0'">
              <StrokeIcon name="feeder" :size="18" />
            </span>
            <div class="hero__main">
              <MarqueeText class="hero__name" :text="displayName(e)" />
              <div class="muted hero__sub">{{ brand(e) }}</div>
            </div>
            <div class="hero__stat">
              <div class="hero__value">
                {{ headline(e) }}<span class="hero__grams">{{ headlineGrams(e) }}</span>
              </div>
              <div class="muted hero__status">{{ status(e) }}</div>
            </div>
          </div>
          <PetFeederCard :descriptor="e.descriptor" :state="e.state" :disabled="!e.state.available"
                         :pending="devices.isPending(e.descriptor.id)"
                         @command="(c: CommandInput) => send(e.descriptor.id, c)" />
          <!-- Réglage d'AFFICHAGE, pas une commande : la mangeoire compte en volume et ne pèse
               rien. Ce chiffre-là n'est connu que de l'utilisateur, qui pèse une ration une fois.
               Discret, au pied de la carte, comme la taille du foyer sur la vue Eau. -->
          <div v-if="e.descriptor.meta.petFeeder?.unit === 'cup'" class="hero__cup" :title="$t('pets.cupGramsHint')">
            <span class="muted">{{ $t('pets.cupGrams') }}</span>
            <div class="stepper">
              <button type="button" class="stepper__btn" :disabled="settings.cupGrams <= CUP_GRAMS_MIN"
                      :aria-label="$t('pets.cupGramsDec')" @click="settings.setCupGrams(settings.cupGrams - CUP_GRAMS_STEP)">
                <StrokeIcon name="minus" :size="14" />
              </button>
              <span class="stepper__val">{{ settings.cupGrams }} g</span>
              <button type="button" class="stepper__btn" :disabled="settings.cupGrams >= CUP_GRAMS_MAX"
                      :aria-label="$t('pets.cupGramsInc')" @click="settings.setCupGrams(settings.cupGrams + CUP_GRAMS_STEP)">
                <StrokeIcon name="plus" :size="14" />
              </button>
            </div>
          </div>
        </section>

        <section v-for="e in fountains" :key="e.descriptor.id" class="card hero">
          <div class="hero__head">
            <span class="icon-square" :data-on="e.state.available ? '1' : '0'">
              <StrokeIcon name="fountain" :size="18" />
            </span>
            <div class="hero__main">
              <MarqueeText class="hero__name" :text="displayName(e)" />
              <div class="muted hero__sub">{{ brand(e) }}</div>
            </div>
            <div class="hero__stat">
              <div class="hero__value">{{ headline(e) }}</div>
              <div class="muted hero__status">{{ status(e) }}</div>
            </div>
          </div>
          <PetFountainCard :descriptor="e.descriptor" :state="e.state" :disabled="!e.state.available"
                           :pending="devices.isPending(e.descriptor.id)"
                           @command="(c: CommandInput) => send(e.descriptor.id, c)" />
        </section>
      </div>

      <RoomBands :kind="['pet_feeder', 'pet_fountain']" />
    </div>
  </div>
</template>

<style scoped>
.page { height: 100%; display: flex; flex-direction: column; }
.page__scroll { flex: 1 1 auto; overflow-y: auto; padding: 0 24px calc(var(--safe-bottom) + 24px); display: grid; gap: 20px; align-content: start; }
.empty { padding: 24px; text-align: center; }
/* Même seuil que la vue Traitement de l'eau (1040px, mesuré là-bas) : l'en-tête de carte réserve
   une largeur fixe à droite (valeur + statut), et en dessous la marque passerait sur deux lignes. */
.pets__grid { display: grid; gap: 20px; min-width: 0; }
@media (min-width: 1040px) { .pets__grid { grid-template-columns: 1fr 1fr; } }
.hero { padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.hero__head { display: flex; align-items: center; gap: 12px; }
.hero__main { flex: 1 1 auto; min-width: 0; }
.hero__name { font-size: 15px; font-weight: 600; }
.hero__sub { font-size: 12px; margin-top: 2px; min-height: 1em; }
/* Largeur RÉSERVÉE, pas ajustée au contenu : sans elle, « Trémie garnie » (76 px mesurés) devenant
   « Croquettes à remettre » (128 px) fait maigrir `.hero__main` de 484 à 432 px et le nom de
   l'appareil se met à défiler — la maison bouge sous une valeur qui change toute seule.
   208 px couvre le pire cas des DEUX langues, mesuré au `getBoundingClientRect()` : 128 px pour le
   plus long statut (FR « Croquettes à remettre »), et surtout la grande valeur suivie de son
   équivalent en poids — « 1,0 tasse ~ 100 g » tient tout juste en 196, et « 12,0 tasse ~ 1 200 g »
   en demande 201. La marge est là pour la maison à plusieurs chats, pas pour faire joli. */
/* `min-width: 0` n'est PAS décoratif : la taille minimale automatique d'un élément flex vaut sa
   largeur min-content, et le statut est en `nowrap` — sans lui, un message d'erreur du fabricant
   fait passer la réserve de 144 à 295 px (mesuré), soit exactement le décalage qu'elle évite. */
.hero__stat { flex: 0 0 208px; min-width: 0; max-width: 208px; text-align: right; }
.hero__value { font-size: 32px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* L'équivalent en poids, petit et discret, sur la MÊME ligne que la grande valeur : il la précise
   sans lui voler la vedette ni ajouter de ligne à l'en-tête. */
.hero__grams { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 6px; white-space: nowrap; }
/* Le statut peut porter le message d'erreur BRUT du fabricant, de longueur inconnue : il se coupe
   plutôt que d'emporter la réserve avec lui. */
.hero__status { font-size: 12px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Réglage d'affichage, séparé des données du dessus par un filet — le même patron que la taille
   du foyer sur la vue Traitement de l'eau. */
.hero__cup { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--line); font-size: 12px; }
.stepper { display: inline-flex; align-items: center; gap: 8px; }
.stepper__btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 1px solid var(--line); background: transparent; color: var(--text); cursor: pointer; }
.stepper__btn:disabled { opacity: .35; cursor: default; }
/* largeur fixe : « 95 g » -> « 100 g » ne fait pas bouger les boutons de part et d'autre. */
.stepper__val { min-width: 5ch; text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13px; }
</style>
