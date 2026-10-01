<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import { formatKm, formatPercent } from '../../lib/format'

/**
 * L'AUTONOMIE d'un véhicule, partagée par la carte de la vue Véhicules et le panneau d'un véhicule
 * dans la vue Maison (comme `ChargeLimitCard`) : la batterie en grand, les kilomètres, la jauge et
 * ses repères — la cible de charge, et le plancher voulu quand le fabricant a cette notion (la R5 ;
 * Tesla ne l'a pas, et un seul repère se dessine alors).
 *
 * `limit` : la cible MONTRÉE, que le parent fait suivre au curseur pendant qu'on le glisse ; à
 * défaut, celle du véhicule. Le repère n'existe que si le véhicule a une cible.
 */
const props = defineProps<{ state: StateFor<'vehicle'>; limit?: number }>()
const { t, locale } = useI18n()
const EMPTY = '—'
/** Sous ce niveau, la jauge passe au rouge (hors charge : une batterie qui remonte n'alarme pas). */
const LOW_SOC = 20

/**
 * Jamais lu : un véhicule découvert ENDORMI n'a encore livré que sa veille, et son état porte les
 * défauts du contrat (0 %, 0 km). Les afficher se lirait comme une batterie vide ; « — » dit vrai.
 * Un vrai véhicule à 0 % aurait au moins un kilométrage ou une position.
 */
const unread = computed(() => {
  const s = props.state
  return s.soc === 0 && s.rangeKm === 0 && s.odometerKm === undefined && s.location === undefined
})
const target = computed(() => props.limit ?? props.state.chargeLimit)
</script>

<template>
  <div class="battery">
    <div class="battery__head">
      <div class="battery__soc">{{ unread ? EMPTY : formatPercent(state.soc, locale) }}</div>
      <div class="battery__range">
        <div class="battery__km">{{ unread ? EMPTY : formatKm(state.rangeKm, locale) }}</div>
        <div class="muted battery__k">{{ t('vehicle.range') }}</div>
      </div>
    </div>
    <div class="battery__bar">
      <!-- en charge, un reflet parcourt le remplissage : on voit la charge active d'un coup d'œil -->
      <div class="battery__fill" :data-charging="state.charging ? '1' : '0'"
           :data-low="!state.charging && state.soc < LOW_SOC ? '1' : '0'" :style="{ width: `${state.soc}%` }" />
      <span v-if="state.socMin !== undefined" class="soc__tick" :style="{ left: `${state.socMin}%` }"
            :title="t('vehicle.floorMark', { percent: formatPercent(state.socMin, locale) })" />
      <span v-if="state.chargeLimit !== undefined && target !== undefined" class="soc__tick" :style="{ left: `${target}%` }"
            :title="t('vehicle.targetMark', { percent: formatPercent(target, locale) })" />
    </div>
  </div>
</template>

<style scoped>
.battery { display: grid; gap: 10px; }
.battery__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.battery__soc { font-size: 40px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
.battery__range { text-align: right; }
.battery__km { font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }
.battery__k { font-size: 11px; }
/* pas d'`overflow: hidden` : les repères DÉBORDENT de la jauge, c'est ce qui les rend lisibles.
   Le remplissage a son propre arrondi, il n'a jamais eu besoin d'être rogné. */
.battery__bar { position: relative; height: 8px; border-radius: 999px; background: var(--line); }
.battery__fill { position: relative; height: 100%; background: var(--accent); border-radius: 999px; transition: width .4s, background .2s; }
.battery__fill[data-low='1'] { background: rgb(var(--v-theme-error)); }
/* le reflet est rogné au remplissage, pas à la jauge : les repères débordent toujours */
.battery__fill[data-charging='1'] { overflow: hidden; }
.battery__fill[data-charging='1']::after {
  content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / .65), transparent);
  animation: battery-flow 1.8s ease-in-out infinite;
}
@keyframes battery-flow { to { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .battery__fill[data-charging='1']::after { animation: none; } }
/* Repères de limites : le trait de la POSITION FAVORITE d'un ouvrant (cf. `.cover-slider` dans
   app.css), en plus court — mais posé PAR-DESSUS la jauge, qui n'a pas de pouce pour le cacher. */
.soc__tick {
  position: absolute; top: 50%; width: 3px; height: 16px; border-radius: 2px;
  transform: translate(-50%, -50%); background: rgb(var(--v-theme-warning));
}
</style>
