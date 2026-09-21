<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../../stores/settings'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatFeedAmount, formatFeedGrams, formatPercent } from '../../lib/format'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Carte d'une mangeoire connectée. Deux gestes seulement — servir une ration, appeler l'animal —
// et le reste se lit. Le PLAN de repas n'est pas ici : il s'édite dans l'appli du fabricant, et
// une ration servie depuis Kasbah s'ajoute au plan sans le toucher.
//
// Les rations proposées viennent de l'APPAREIL (`meta.petFeeder`) et jamais d'une constante — pas
// même leur UNITÉ : une Fresh Element Solo compte en dixièmes de TASSE (elle déclare
// `settings.factor: 10`), une Infinity en grammes. Un curseur mentirait sur la première, et
// écrire « g » partout se tromperait d'un facteur dix.
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'pet_feeder'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t } = useI18n()
const settings = useSettingsStore()

const emitted = ref<string | null>(null)
/**
 * Quel bouton attend sa réponse. `pending` est par APPAREIL : sans ce repère local, les cinq
 * rations tourneraient ensemble et on ne saurait plus laquelle on a demandée.
 */
function run(key: string, cmd: CommandInput): void {
  emitted.value = key
  emit('command', cmd)
}
watch(() => props.pending, (p) => { if (!p) emitted.value = null })
const waiting = (key: string) => props.pending === true && emitted.value === key

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const feeder = computed(() => props.descriptor.meta.petFeeder)
const portions = computed(() => feeder.value?.portions ?? [])
const canFeed = computed(() => has('feed') && portions.value.length > 0)

/** Sous ce seuil, le sachet dessiccant se remarque — il se remplace, il ne se recharge pas. */
const DESICCANT_LOW_DAYS = 7
/** Une quantité dans l'unité de CETTE machine ; sans unité déclarée, on n'affiche pas un nombre nu. */
const amountText = (v?: number, locale = 'fr') =>
  (v !== undefined && feeder.value ? formatFeedAmount(v, feeder.value.unit, locale) : '—')
/**
 * La même quantité en grammes, ESTIMÉE d'après le poids d'une tasse réglé par l'utilisateur — la
 * machine, elle, ne pèse rien. Rendu `''` et non `'—'` quand il n'y a rien à convertir : c'est un
 * complément, son absence ne se signale pas.
 */
const gramsText = (v?: number, locale = 'fr') =>
  (v !== undefined && feeder.value ? formatFeedGrams(v, feeder.value.unit, settings.cupGrams, locale) ?? '' : '')
/**
 * Le fait le plus urgent, dans une ligne dont la place est RÉSERVÉE : une panne l'emporte sur une
 * trémie vide, qui l'emporte sur « tout va bien ».
 */
const alert = computed(() => {
  const s = props.state
  if (s.errorMessage) return { level: 'defect', icon: 'alert' as const, text: s.errorMessage }
  if (s.foodLow === undefined) return { level: 'unknown', icon: 'minusCircle' as const, text: t('common.unknown') }
  return s.foodLow
    ? { level: 'warning', icon: 'alert' as const, text: t('pets.foodLow') }
    : { level: 'ok', icon: 'checkCircle' as const, text: t('pets.foodOk') }
})

/** Heure seule : le prochain repas est toujours dans la journée. */
const mealTime = (at: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(at))
</script>

<template>
  <div class="feeder">
    <!-- UNE seule ligne d'alerte, toujours présente, qui dit le fait le plus urgent : le message
         d'erreur du fabricant s'il y en a un, sinon l'état de la trémie. Le message n'AJOUTE donc
         pas de ligne — il en remplace une —, la carte ne grandit pas, et rien ne bouge autour.
         Il est tronqué à la largeur disponible (`.line__text`) avec le texte entier en `title`,
         parce qu'un libellé de fabricant n'a pas de longueur connue. -->
    <div class="line" :data-alert="alert.level">
      <StrokeIcon :name="alert.icon" :size="16" />
      <!-- Le message du fabricant n'a pas de longueur connue : il DÉFILE avec un fondu aux bords
           (`MarqueeText`, le composant des cartes médias) plutôt que d'être coupé aux points de
           suspension. On le lit en entier, la ligne garde sa hauteur, et rien ne s'élargit. -->
      <MarqueeText class="line__text" :text="alert.text" />
    </div>

    <!-- Le prochain repas EN TÊTE : c'est le seul renseignement qui parle de l'avenir, et celui
         que l'appli du fabricant met en avant. Sa place est réservée même quand la journée est
         finie — le mot change, la ligne reste. -->
    <div class="line line--meal">
      <StrokeIcon name="clock" :size="16" />
      <span class="line__text">{{ $t('pets.nextMealLabel') }}</span>
      <span class="line__num">{{ state.nextMealAmount !== undefined ? amountText(state.nextMealAmount, $i18n.locale) : '—' }}</span>
      <span class="line__side">{{ gramsText(state.nextMealAmount, $i18n.locale) }}</span>
      <span class="line__tail">{{ state.nextMealAt !== undefined ? mealTime(state.nextMealAt, $i18n.locale) : '—' }}</span>
    </div>
    <div class="line">
      <StrokeIcon name="feeder" :size="16" />
      <span class="line__text">{{ $t('pets.servedTodayLabel') }}</span>
      <span class="line__num">{{ amountText(state.servedToday, $i18n.locale) }}</span>
      <span class="line__side">{{ gramsText(state.servedToday, $i18n.locale) }}</span>
      <span class="line__tail">{{ state.plannedToday !== undefined ? $t('pets.ofPlanned', { amount: amountText(state.plannedToday, $i18n.locale) }) : '' }}</span>
    </div>
    <!-- Le MANGÉ n'existe que sur les modèles à plateau pesant. La ligne n'apparaît donc pas du
         tout sur une Fresh Element Solo, plutôt que d'afficher un tiret qui ne changera jamais :
         c'est une propriété du matériel, pas une valeur en attente — et elle ne bouge donc pas
         d'un rafraîchissement à l'autre. -->
    <div v-if="state.eatenToday !== undefined" class="line">
      <StrokeIcon name="paw" :size="16" />
      <span class="line__text">{{ $t('pets.eatenToday') }}</span>
      <span class="line__num">{{ amountText(state.eatenToday, $i18n.locale) }}</span>
      <span class="line__side">{{ gramsText(state.eatenToday, $i18n.locale) }}</span>
      <span class="line__tail" />
    </div>
    <div v-if="has('consumables')" class="line">
      <StrokeIcon name="filtration" :size="16" />
      <span class="line__text">{{ $t('pets.desiccant') }}</span>
      <span class="line__num" :class="{ 'text-error': state.desiccantDays !== undefined && state.desiccantDays < DESICCANT_LOW_DAYS }">
        {{ state.desiccantDays !== undefined ? $t('pets.days', { n: state.desiccantDays }, state.desiccantDays) : '—' }}
      </span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <div v-if="has('battery')" class="line">
      <StrokeIcon name="battery" :size="16" />
      <span class="line__text">{{ $t('pets.backupBattery') }}</span>
      <span class="line__num">{{ state.batteryPct !== undefined ? formatPercent(state.batteryPct, $i18n.locale) : '—' }}</span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <template v-if="canFeed || has('call_pet')">
      <div class="sep" />
      <div v-if="canFeed" class="muted feeder__label">{{ $t('pets.feedNow') }}</div>
      <div class="feeder__row">
        <!-- Une ration = un bouton. Le fabricant n'accepte que ces valeurs-là ; les proposer
             toutes évite le double geste « choisir puis valider » sur une tablette murale. -->
        <!-- `loading` de Vuetify, et pas une roulette ajoutée à côté du texte : il recouvre le
             bouton sans changer sa taille. Une roulette insérée élargirait la rangée à chaque
             geste. -->
        <v-btn v-for="g in portions" :key="g" class="feeder__btn" height="48" variant="tonal" color="primary"
               :disabled="disabled || pending" :loading="waiting(`feed-${g}`)"
               @click="run(`feed-${g}`, { type: 'pet_feeder.feed', amount: g })">
          <span class="feeder__stack">
            <span>{{ amountText(g, $i18n.locale) }}</span>
            <!-- La hauteur du bouton reste 48 px : la seconde ligne vit DANS elle, elle ne
                 l'agrandit pas — et sa place est tenue même sans grammes à afficher. -->
            <span class="feeder__grams">{{ gramsText(g, $i18n.locale) }}</span>
          </span>
        </v-btn>
        <v-btn v-if="has('call_pet')" height="48" variant="tonal" icon="speaker" :disabled="disabled || pending"
               :loading="waiting('call')" :aria-label="$t('pets.callPet')" :title="$t('pets.callPet')"
               @click="run('call', { type: 'pet_feeder.call_pet' })" />
      </div>
    </template>
  </div>
</template>

<style scoped>
/* `minmax(0, 1fr)` et pas `auto` : une colonne `auto` se dimensionne sur le max-content de son
   contenu, donc un message d'erreur en `nowrap` FAISAIT DÉBORDER la carte horizontalement
   (`scrollWidth > clientWidth`, mesuré). La colonne ne peut plus dépasser son conteneur, et c'est
   le texte qui s'adapte — en défilant. */
.feeder { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; }
.sep { height: 1px; margin: 8px 0; background: var(--line); }
.line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); height: 28px; min-width: 0; }
.line__text { flex: 1 1 auto; min-width: 0; color: var(--muted); }
/*
 * TROIS colonnes de droite, de largeur fixe et dans le MÊME ordre sur toutes les lignes :
 * la quantité, sa contrepartie en grammes, puis le complément. Chacune existe même vide.
 *
 * C'est ce qui manquait : avec l'heure du prochain repas en première colonne, « 13:00 » se posait
 * au-dessus de « 0,7 tasse » et les unités ne s'alignaient plus d'une ligne à l'autre — on ne
 * lisait plus la carte d'un coup d'œil. L'heure est passée en DERNIÈRE colonne, où elle ne gêne
 * plus l'alignement des tasses et des grammes.
 */
/*
 * Largeurs en PIXELS et non en `ch` : le `ch` dépend de la taille de police, et l'heure du
 * prochain repas est en 13 px là où les compléments sont en 12 px. La colonne était alors 6 px
 * plus large sur cette ligne-là, et tout le reste glissait avec elle — mesuré. En pixels, les
 * trois colonnes tombent au même endroit sur TOUTES les lignes, quelle que soit leur graisse.
 * Valeurs choisies sur le pire cas : « 0,5 tasse » (72), « ~ 100 g » (62), « sur 0,9 tasse » (88).
 */
.line__num { flex: 0 0 auto; min-width: 72px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
/* `overflow: hidden` sur les colonnes de complément : `min-width` est un PLANCHER, pas un
   plafond — « 0 s en moyenne » dépassait ses 62 px et poussait la valeur voisine de 25 px, une
   ligne sur trois seulement (mesuré). Bornées, elles ne peuvent plus déplacer personne. */
.line__side { flex: 0 0 auto; min-width: 62px; max-width: 62px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
/* Dernière colonne : l'heure du prochain repas (en gras, c'est le repère qu'on cherche des yeux)
   ou le total prévu. Largeur réservée même vide, pour que les colonnes de gauche ne bougent pas. */
.line__tail { flex: 0 0 auto; min-width: 88px; max-width: 88px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: right; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.line[data-alert='warning'] { color: rgb(var(--v-theme-warning)); }
.line[data-alert='defect'] { color: rgb(var(--v-theme-error)); }
.line[data-alert='warning'] .line__text, .line[data-alert='defect'] .line__text, .line[data-alert='ok'] .line__text { color: inherit; }
/* L'heure du prochain repas : le seul chiffre de la carte qu'on vient chercher des yeux. */
.line--meal .line__tail { font-weight: 600; font-size: 13px; color: var(--text); }
.feeder__label { font-size: 12px; margin-bottom: 6px; }
/* Les rations se resserrent, elles ne débordent pas : le panneau d'appareil de la scène 3D ne fait
   que 294 px de large, et Vuetify pose `flex-shrink: 0` sur tout `v-btn` (leçon de VacuumControl). */
.feeder__row { display: flex; gap: 8px; }
.feeder__btn { flex: 1 1 0; min-width: 0; flex-shrink: 1; padding: 0 4px; }
.feeder__stack { display: flex; flex-direction: column; align-items: center; line-height: 1.15; }
/* Empreinte RÉSERVÉE : la ligne existe même vide, pour qu'un changement de réglage ne fasse pas
   sauter la hauteur du texte dans le bouton. */
.feeder__grams { font-size: 10px; opacity: .7; min-height: 1.15em; font-weight: 400; }
</style>

<!--
  Même raison que WaterCard : le jeton `warning` brut tombe sous le seuil AA de 4,5:1 en thème
  clair sur un panneau blanc, pour du texte de 13 px. Assombri il reste ambre et lisible ; le
  thème sombre, déjà conforme, n'est pas touché. La classe `.feeder` garde la portée locale en
  pratique — `:global()` dans un bloc scopé perdrait le descendant (piège relevé sur HomeView).
-->
<style>
html[data-theme='light'] .feeder .line[data-alert='warning'] { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
</style>
