<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { formatFlow, formatPercent, formatVolume, waterAlertState } from '../../lib/format'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Carte d'une station de traitement d'eau (COMAP Proteo) : lecture seule, comme la météo — aucune
// commande n'est proposée (voir `waterStateSchema`). Chaque ligne garde sa place que sa capacité
// soit déclarée ou non : les sections suivent les capacités, mais dans une section affichée, une
// valeur pas encore lue montre un tiret plutôt que de disparaître (« rien ne bouge »).
const props = defineProps<{ descriptor: DeviceDescriptor; state: StateFor<'water'>; pending?: boolean; disabled?: boolean }>()
const { t, locale } = useI18n()

const has = (c: string) => props.descriptor.capabilities.includes(c as never)
const showConsumables = computed(() => has('consumables'))
const showUvLamp = computed(() => has('uv_lamp'))
const showUsage = computed(() => has('water_flow') || has('water_usage'))

/** 100 = neuf ; en dessous de ce seuil, le consommable se remarque (même repère que `battery < 20`). */
const LOW_PCT = 20
const pctText = (v?: number) => (v !== undefined ? formatPercent(v, locale.value) : '—')
const isLow = (v?: number) => v !== undefined && v < LOW_PCT

const alert = computed(() => waterAlertState(props.state))
const alertIcon = computed(() => (alert.value === 'ok' ? 'checkCircle' : alert.value === 'unknown' ? 'minusCircle' : 'alert'))
const alertText = computed(() => {
  switch (alert.value) {
    case 'ok': return t('water.noAlert')
    case 'warning': return t('water.warning')
    case 'defect': return t('water.defect')
    default: return t('common.unknown')
  }
})
</script>

<template>
  <div class="water">
    <template v-if="showConsumables">
      <div class="line">
        <StrokeIcon name="filtration" :size="16" />
        <span class="line__text">{{ $t('water.prefilter') }}</span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.prefilterPct) }">{{ pctText(state.prefilterPct) }}</span>
      </div>
      <div class="line">
        <StrokeIcon name="filtration" :size="16" />
        <span class="line__text">{{ $t('water.carbon1') }}</span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.carbon1Pct) }">{{ pctText(state.carbon1Pct) }}</span>
      </div>
      <div class="line">
        <StrokeIcon name="filtration" :size="16" />
        <span class="line__text">{{ $t('water.carbon2') }}</span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.carbon2Pct) }">{{ pctText(state.carbon2Pct) }}</span>
      </div>
      <div v-if="showUvLamp" class="line">
        <StrokeIcon name="sun" :size="16" />
        <span class="line__text">{{ $t('water.uvLamp') }}</span>
        <span class="line__pct" :class="{ 'text-error': isLow(state.uvLampPct) }">{{ pctText(state.uvLampPct) }}</span>
        <span class="uv" :data-on="state.uvOn === undefined ? 'unknown' : state.uvOn ? '1' : '0'">
          <span class="uv__dot" />{{ state.uvOn === undefined ? '—' : state.uvOn ? $t('water.uvOn') : $t('water.uvOff') }}
        </span>
      </div>
    </template>

    <div v-if="showConsumables && showUsage" class="sep" />

    <template v-if="showUsage">
      <div v-if="has('water_flow')" class="line">
        <StrokeIcon name="waves" :size="16" />
        <span class="line__text">{{ $t('water.flow') }}</span>
        <span class="line__num">{{ state.flowLph !== undefined ? formatFlow(state.flowLph, locale) : '—' }}</span>
      </div>
      <template v-if="has('water_usage')">
        <div class="line">
          <StrokeIcon name="droplet" :size="16" />
          <span class="line__text">{{ $t('water.today') }}</span>
          <span class="line__num">{{ state.todayL !== undefined ? formatVolume(state.todayL, locale) : '—' }}</span>
        </div>
        <div class="line">
          <StrokeIcon name="droplet" :size="16" />
          <span class="line__text">{{ $t('water.month') }}</span>
          <span class="line__num">{{ state.monthL !== undefined ? formatVolume(state.monthL, locale) : '—' }}</span>
        </div>
      </template>
    </template>

    <div class="sep" />

    <div class="line" :data-alert="alert">
      <StrokeIcon :name="alertIcon" :size="16" />
      <span class="line__text">{{ alertText }}</span>
    </div>
  </div>
</template>

<style scoped>
.water { display: grid; gap: 2px; }
.sep { height: 1px; margin: 8px 0; background: var(--line); }
.line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text); height: 28px; }
.line__text { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); }
/* largeur fixe : le pourcentage ou le nombre ne fait pas trembler la colonne quand il change.
   9ch couvre le pire cas réel (volume mensuel à 7 chiffres, « 1 234 567 L » / « 2 556 L/h »),
   pas seulement le pourcentage (qui tiendrait dans moins). */
.line__pct, .line__num { flex: 0 0 auto; min-width: 9ch; text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
.line[data-alert='warning'] { color: rgb(var(--v-theme-warning)); }
.line[data-alert='warning'] .line__text { color: inherit; }
.line[data-alert='defect'] { color: rgb(var(--v-theme-error)); }
.line[data-alert='defect'] .line__text { color: inherit; }
.line[data-alert='ok'] .line__text { color: inherit; }
/* la lampe : point (empreinte fixe, ne pulse pas — c'est un état, pas une action en cours) et mot,
   largeur réservée pour le plus long des deux (« allumée »/« éteinte », « on »/« off ») */
.uv { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; min-width: 9ch; font-size: 12px; color: var(--muted); }
/* empreinte fixe (7x7, bordure comprise) : allumée = pastille pleine verte, éteinte = pastille
   pleine sourdine (visible, un fonctionnement normal), inconnue = anneau creux — visuellement
   distincte de l'éteinte, jamais confondue avec elle. `--line` (séparateurs, ~1,1:1) ne servait
   plus qu'à disparaître. */
.uv__dot { width: 7px; height: 7px; border-radius: 50%; box-sizing: border-box; background: var(--muted); flex: 0 0 auto; }
.uv[data-on='1'] .uv__dot { background: rgb(var(--v-theme-success)); }
.uv[data-on='1'] { color: rgb(var(--v-theme-success)); }
.uv[data-on='unknown'] .uv__dot { background: transparent; border: 1px dashed var(--muted); }
</style>

<!--
  Bloc non scopé : `:global(html[data-theme='light']) .line[...]` (le motif déjà utilisé dans
  HomeView.vue/VehicleMap.vue) compile en réalité vers `html[data-theme='light'] { … }` tout seul —
  le descendant scopé disparaît dans la transformation. Vérifié en lisant le CSS compilé servi par
  Vite (`?vue&type=style&lang.css`). `.water` est un nom de classe propre à cette carte : la portée
  reste locale en pratique, ici en clair : le jeton `warning` brut tombe à 2,81:1 sur un panneau
  blanc — texte de 13 px, sous le seuil AA de 4,5:1 (c'est le seul endroit de l'app qui pose ce
  jeton en texte, ailleurs c'est un fond ou une bordure). Assombri, il reste amber mais lisible
  (~5,3:1 mesuré) ; le thème sombre, déjà conforme, n'est pas touché.
-->
<style>
html[data-theme='light'] .water .line[data-alert='warning'] { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
</style>
