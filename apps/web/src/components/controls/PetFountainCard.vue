<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CommandInput, DeviceDescriptor, StateFor } from '@kasbah/shared'
import { PET_PUMP_MODES } from '@kasbah/shared'
import { formatAgo, formatMilliliters, formatPercent } from '../../lib/format'
import MarqueeText from '../ui/MarqueeText.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Carte d'une fontaine à eau. Particularité qui explique tout le reste : une Eversweet n'a pas de
// Wi-Fi. Elle est lue et pilotée PAR RELAIS Bluetooth au travers d'un appareil voisin (la
// mangeoire), donc ses valeurs datent du dernier relais réussi — parfois de plusieurs heures si le
// relais était hors de portée. D'où la ligne « relevé … » en pied de carte : montrer l'âge vaut
// mieux que laisser croire au direct (même arbitrage que `readAt` sur un véhicule endormi).
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'pet_fountain'>; pending?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ command: [cmd: CommandInput] }>()
const { t, locale } = useI18n()

const emitted = ref<string | null>(null)
/**
 * Quel bouton attend sa réponse. `pending` est par APPAREIL : sans ce repère local, les trois
 * boutons tourneraient ensemble et on ne saurait pas lequel on a poussé.
 */
function run(key: string, cmd: CommandInput): void {
  emitted.value = key
  emit('command', cmd)
}
watch(() => props.pending, (p) => { if (!p) emitted.value = null })
const waiting = (key: string) => props.pending === true && emitted.value === key

/**
 * Le fait le plus urgent, dans une ligne dont la place est RÉSERVÉE : une panne l'emporte sur un
 * bac vide, qui l'emporte sur « tout va bien ». Le message du fabricant REMPLACE la ligne au lieu
 * d'en ajouter une — la carte ne grandit pas et rien ne bouge autour.
 */
const alert = computed(() => {
  const st = props.state
  if (st.errorMessage) return { level: 'defect', icon: 'alert' as const, text: st.errorMessage }
  if (st.waterLow === undefined) return { level: 'unknown', icon: 'minusCircle' as const, text: t('common.unknown') }
  return st.waterLow
    ? { level: 'warning', icon: 'alert' as const, text: t('pets.waterLow') }
    : { level: 'ok', icon: 'checkCircle' as const, text: t('pets.waterOk') }
})

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
/** Sous ce seuil, le filtre se remarque — même repère que les consommables de la station d'eau. */
const LOW_PCT = 20

// Horloge locale : l'âge du relevé doit vieillir tout seul, sinon « il y a 2 min » reste affiché
// une heure. 30 s, la même cadence que la vue Robots.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 30_000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

const syncedAgo = computed(() => (props.state.syncedAt !== undefined
  ? t('pets.syncedAgo', { ago: formatAgo(props.state.syncedAt, now.value, locale.value) })
  : t('pets.syncedUnknown')))
</script>

<template>
  <div class="fountain">
    <div class="line" :data-alert="alert.level">
      <StrokeIcon :name="alert.icon" :size="16" />
      <!-- Même traitement que la mangeoire : un message de fabricant défile avec un fondu plutôt
           que d'être coupé, et ne peut pas élargir la carte. -->
      <MarqueeText class="line__text" :text="alert.text" />
    </div>

    <!-- Des PASSAGES, pas un volume : une Eversweet Max ne mesure aucun millilitre, elle compte
         les venues de l'animal et leur durée. Le volume reste affiché pour les modèles qui le
         mesurent, et ces deux lignes-là ne coexistent jamais sur une même machine. -->
    <div v-if="has('water_usage')" class="line">
      <StrokeIcon name="paw" :size="16" />
      <span class="line__text">{{ $t('pets.drinksToday') }}</span>
      <span class="line__num">{{ state.drinksToday !== undefined ? state.drinksToday : '—' }}</span>
      <span class="line__side" />
      <span class="line__tail">{{ state.drinkAvgS !== undefined ? $t('pets.avgStay', { s: Math.round(state.drinkAvgS) }) : '' }}</span>
    </div>
    <div v-if="state.todayMl !== undefined" class="line">
      <StrokeIcon name="droplet" :size="16" />
      <span class="line__text">{{ $t('pets.drunkVolume') }}</span>
      <span class="line__num">{{ formatMilliliters(state.todayMl, $i18n.locale) }}</span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <div v-if="has('consumables')" class="line">
      <StrokeIcon name="filtration" :size="16" />
      <span class="line__text">{{ $t('pets.filter') }}</span>
      <!-- La VALEUR dans la première colonne et son complément dans la seconde, comme sur toutes
           les autres lignes des deux cartes : c'est cet ordre constant qui laisse lire une carte
           d'un coup d'œil, les unités tombant les unes sous les autres. -->
      <span class="line__num" :class="{ 'text-error': state.filterPct !== undefined && state.filterPct < LOW_PCT }">
        {{ state.filterPct !== undefined ? formatPercent(state.filterPct, $i18n.locale) : '—' }}
      </span>
      <span class="line__side">{{ state.filterDays !== undefined ? $t('pets.days', { n: state.filterDays }, state.filterDays) : '' }}</span>
      <span class="line__tail" />
    </div>
    <div v-if="has('battery')" class="line">
      <StrokeIcon name="battery" :size="16" />
      <span class="line__text">{{ $t('pets.battery') }}</span>
      <span class="line__num" :class="{ 'text-error': state.batteryPct !== undefined && state.batteryPct < LOW_PCT }">
        {{ state.batteryPct !== undefined ? formatPercent(state.batteryPct, $i18n.locale) : '—' }}
      </span>
      <span class="line__side" />
      <span class="line__tail" />
    </div>
    <div class="sep" />

    <div class="fountain__row">
      <!-- Un VERBE, pas un état : « Éteint » se lisait comme le statut de la pompe, à côté des deux
           régimes. Et pas de teinte « primary » ici — elle est réservée au régime SÉLECTIONNÉ, sinon
           deux boutons colorés côte à côte ne disent plus lequel est un choix et lequel est un geste. -->
      <!-- `loading` de Vuetify plutôt qu'une roulette ajoutée à côté du texte : il recouvre le
           bouton sans changer sa taille, donc la rangée ne bouge pas pendant l'attente. -->
      <v-btn v-if="has('on_off')" class="fountain__btn" height="48" variant="tonal"
             :disabled="disabled || pending" :loading="waiting('power')"
             @click="run('power', { type: 'pet_fountain.set_power', on: !state.on })">
        {{ state.on ? $t('pets.stopPump') : $t('pets.startPump') }}
      </v-btn>
      <!-- Les deux régimes de pompe, côte à côte : deux boutons valent mieux qu'un menu pour deux
           choix, et l'actif se voit sans l'ouvrir. Grisés pompe arrêtée — régler le régime d'une
           pompe à l'arrêt n'a pas de sens, et le fabricant refuserait. -->
      <v-btn v-for="m in (has('pump_mode') ? PET_PUMP_MODES : [])" :key="m" class="fountain__btn" height="48" variant="tonal"
             :color="state.mode === m ? 'primary' : undefined" :disabled="disabled || pending || !state.on"
             :loading="waiting(`mode-${m}`)" @click="run(`mode-${m}`, { type: 'pet_fountain.set_mode', mode: m })">
        {{ $t(`pets.mode.${m}`) }}
      </v-btn>
    </div>

    <div class="muted fountain__synced">{{ syncedAgo }}</div>
  </div>
</template>

<style scoped>
/* `minmax(0, 1fr)` : une colonne `auto` se dimensionnerait sur le max-content, et un message
   d'erreur en une seule ligne ferait déborder la carte (mesuré sur la mangeoire). */
.fountain { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-width: 0; }
.sep { height: 1px; margin: 8px 0; background: var(--line); }
.line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); height: 28px; min-width: 0; }
.line__text { flex: 1 1 auto; min-width: 0; color: var(--muted); }
/*
 * Mêmes colonnes que la carte mangeoire, et en PIXELS pour la même raison : un `ch` suit la taille
 * de police, et une colonne qui change de largeur d'une ligne à l'autre casse l'alignement
 * vertical des unités — on ne lit plus la carte d'un coup d'œil.
 */
/*
 * EXACTEMENT les mêmes trois colonnes que la carte mangeoire, aux mêmes largeurs en pixels : la
 * valeur, son complément, puis une réserve. Deux cartes côte à côte dans la vue Animaux — si leurs
 * colonnes ne tombaient pas au même endroit, l'œil ne saurait plus où chercher.
 */
.line__num, .line__side, .line__tail { flex: 0 0 auto; text-align: right; font-variant-numeric: tabular-nums; }
.line__num { min-width: 72px; font-weight: 500; }
/* `overflow: hidden` sur les colonnes de complément : `min-width` est un PLANCHER, pas un
   plafond — « 0 s en moyenne » dépassait ses 62 px et poussait la valeur voisine de 25 px, une
   ligne sur trois seulement (mesuré). Bornées, elles ne peuvent plus déplacer personne. */
.line__side { min-width: 62px; max-width: 62px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; color: var(--muted); }
.line__tail { min-width: 88px; max-width: 88px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; color: var(--muted); }
.line[data-alert='warning'] { color: rgb(var(--v-theme-warning)); }
.line[data-alert='defect'] { color: rgb(var(--v-theme-error)); }
.line[data-alert='warning'] .line__text, .line[data-alert='defect'] .line__text, .line[data-alert='ok'] .line__text { color: inherit; }
/* Même leçon que VacuumControl : Vuetify pose `flex-shrink: 0` sur tout `v-btn`, et le panneau
   d'appareil de la scène 3D ne fait que 294 px — trois boutons doivent pouvoir se resserrer. */
.fountain__row { display: flex; gap: 8px; }
.fountain__btn { flex: 1 1 0; min-width: 0; flex-shrink: 1; padding: 0 4px; }
/* Hauteur réservée : la ligne existe même quand la date est inconnue, elle ne fait pas sauter la carte. */
.fountain__synced { font-size: 11px; margin-top: 8px; min-height: 1.2em; text-align: right; }
</style>

<!--
  Même correction de contraste que WaterCard et PetFeederCard : le jeton `warning` brut passe sous
  le seuil AA en thème clair pour du texte de 13 px.
-->
<style>
html[data-theme='light'] .fountain .line[data-alert='warning'] { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
</style>
