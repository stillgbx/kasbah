<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { useHouseStore } from '../../stores/house'
import { formatPercent, formatPower } from '../../lib/format'
import StatTile from '../ui/StatTile.vue'

// Panneau « maison » : tuiles de synthèse seulement pour l'instant (scènes / pièces plus tard).
const house = useHouseStore()
const summary = useHomeSummary()
const { t, locale } = useI18n()

/**
 * Jamais lu : un véhicule découvert ENDORMI porte les défauts du contrat (0 %, 0 km), qui se
 * liraient ici comme une batterie vide. Même arbitrage que la vue Véhicules : « — » dit vrai.
 */
const unreadVehicle = (s: StateFor<'vehicle'>) =>
  s.soc === 0 && s.rangeKm === 0 && s.odometerKm === undefined && s.location === undefined

const stats = computed(() => {
  const out: { key: string; value: string; label: string }[] = []
  if (summary.lights.value.length) out.push({ key: 'lights', value: String(summary.lightsOn.value), label: t('home.lightsOn') })
  // volets et stores ont leur propre tuile : « ouverts » et « baissés » ne sont pas la même mesure
  if (summary.shutters.value.length) out.push({ key: 'shutters', value: `${summary.shuttersOpen.value}/${summary.shutters.value.length}`, label: t('home.shuttersOpen') })
  if (summary.awnings.value.length) out.push({ key: 'awnings', value: `${summary.awningsDown.value}/${summary.awnings.value.length}`, label: t('home.awningsDown') })
  // caméras et lecteurs : ces deux compteurs manquaient d'un endroit où se voir d'un coup d'œil.
  if (summary.cameras.value.length) out.push({ key: 'cameras', value: String(summary.cameras.value.length), label: t('home.cameras') })
  if (summary.players.value.length) out.push({ key: 'players', value: `${summary.playing.value}/${summary.players.value.length}`, label: t('home.players') })
  // énergie : la production de l'instant, et la charge de la batterie du site quand il y en a une —
  // deux mesures distinctes, donc deux tuiles. Le détail reste dans la vue Énergie.
  const site = summary.energy.value
  if (site) out.push({ key: 'solar', value: formatPower(site.productionW, locale.value), label: t('home.solarNow') })
  if (site?.batterySoc !== undefined) out.push({ key: 'battery', value: formatPercent(site.batterySoc, locale.value), label: t('home.battery') })
  // une tuile PAR voiture : deux voitures ne se résument pas en un chiffre, et c'est leur charge
  // qu'on vient regarder. Le nom sert d'étiquette ; `devices.list` est trié par nom, l'ordre tient.
  for (const v of summary.vehicles.value) {
    const s = v.state as StateFor<'vehicle'>
    out.push({
      key: v.descriptor.id,
      value: unreadVehicle(s) ? '—' : formatPercent(s.soc, locale.value),
      label: house.houseDeviceFor(v.descriptor.id)?.name ?? v.descriptor.name,
    })
  }
  // grille à 2 colonnes : les tuiles passent à la ligne. Le plafond laisse la place aux 5 compteurs
  // de la maison, aux 2 tuiles d'énergie et à trois voitures — aucune n'est jamais tronquée ici.
  return out.slice(0, 10)
})
</script>

<template>
  <div v-if="stats.length" class="tiles">
    <StatTile v-for="s in stats" :key="s.key" :value="s.value" :label="s.label" />
  </div>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
</style>
