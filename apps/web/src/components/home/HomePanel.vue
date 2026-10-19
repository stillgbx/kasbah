<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { DeviceAlert, StateFor } from '@kasbah/shared'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { useAlertsStore, type RailAlert } from '../../stores/alerts'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { deviceIcon } from '../../lib/deviceIcons'
import { formatPercent, formatPower } from '../../lib/format'
import MarqueeText from '../ui/MarqueeText.vue'
import StatTile from '../ui/StatTile.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'

// Panneau « maison » : tuiles de synthèse, et au fond la liste des alertes en cours.
// Chaque tuile mène à la vue qui en donne le détail (`to` : nom de route du rail).
const house = useHouseStore()
const devices = useDevicesStore()
const alerts = useAlertsStore()
const router = useRouter()
const summary = useHomeSummary()
const { t, locale } = useI18n()

/**
 * Jamais lu : un véhicule découvert ENDORMI porte les défauts du contrat (0 %, 0 km), qui se
 * liraient ici comme une batterie vide. Même arbitrage que la vue Véhicules : « — » dit vrai.
 */
const unreadVehicle = (s: StateFor<'vehicle'>) =>
  s.soc === 0 && s.rangeKm === 0 && s.odometerKm === undefined && s.location === undefined

const stats = computed(() => {
  const out: { key: string; value: string; label: string; to: string }[] = []
  if (summary.lights.value.length) out.push({ key: 'lights', value: String(summary.lightsOn.value), label: t('home.lightsOn'), to: 'lights' })
  // volets et stores ont leur propre tuile : « ouverts » et « baissés » ne sont pas la même mesure
  if (summary.shutters.value.length) out.push({ key: 'shutters', value: `${summary.shuttersOpen.value}/${summary.shutters.value.length}`, label: t('home.shuttersOpen'), to: 'covers' })
  if (summary.awnings.value.length) out.push({ key: 'awnings', value: `${summary.awningsDown.value}/${summary.awnings.value.length}`, label: t('home.awningsDown'), to: 'covers' })
  // caméras et lecteurs : ces deux compteurs manquaient d'un endroit où se voir d'un coup d'œil.
  if (summary.cameras.value.length) out.push({ key: 'cameras', value: String(summary.cameras.value.length), label: t('home.cameras'), to: 'cameras' })
  if (summary.players.value.length) out.push({ key: 'players', value: `${summary.playing.value}/${summary.players.value.length}`, label: t('home.players'), to: 'media' })
  // énergie : la production de l'instant, et la charge de la batterie du site quand il y en a une —
  // deux mesures distinctes, donc deux tuiles. Le détail reste dans la vue Énergie.
  const site = summary.energy.value
  if (site) out.push({ key: 'solar', value: formatPower(site.productionW, locale.value), label: t('home.solarNow'), to: 'energy' })
  if (site?.batterySoc !== undefined) out.push({ key: 'battery', value: formatPercent(site.batterySoc, locale.value), label: t('home.battery'), to: 'energy' })
  // une tuile PAR voiture : deux voitures ne se résument pas en un chiffre, et c'est leur charge
  // qu'on vient regarder. Le nom sert d'étiquette ; `devices.list` est trié par nom, l'ordre tient.
  for (const v of summary.vehicles.value) {
    const s = v.state as StateFor<'vehicle'>
    out.push({
      key: v.descriptor.id,
      value: unreadVehicle(s) ? '—' : formatPercent(s.soc, locale.value),
      label: house.houseDeviceFor(v.descriptor.id)?.name ?? v.descriptor.name,
      to: 'vehicles',
    })
  }
  // grille à 2 colonnes : les tuiles passent à la ligne. Le plafond laisse la place aux 5 compteurs
  // de la maison, aux 2 tuiles d'énergie et à trois voitures — aucune n'est jamais tronquée ici.
  return out.slice(0, 10)
})

/** Le texte d'une alerte : ce qu'il y a à faire, dans les mots de la carte de l'appareil. */
function alertText(a: DeviceAlert): string {
  switch (a.type) {
    case 'software_update': return a.detail ? t('alerts.updateVersion', { version: a.detail }) : t('alerts.update')
    case 'device_error': return a.detail ?? t('alerts.deviceError')
    case 'vigilance': return t('weather.alerts.label', {
      level: t(`weather.alerts.levels.${a.severity === 'critical' ? 'red' : 'orange'}`), type: t(`weather.alerts.types.${a.detail}`),
    })
    case 'supply_low': return t(a.kind === 'pet_fountain' ? 'pets.waterLow' : 'pets.foodLow')
    case 'consumable': return t(a.detail === 'filter' ? 'alerts.filter' : 'alerts.desiccant')
    case 'battery_low': return t('alerts.batteryLow')
  }
}

/**
 * Une ligne par APPAREIL, ses alertes à la suite : c'est l'appareil qu'on va voir, et un
 * distributeur à la fois vide et sans dessiccant n'a pas à occuper deux lignes. `active` est trié
 * du plus grave au moins grave : la première alerte d'un appareil donne la couleur de sa ligne, et
 * l'appareil le plus grave passe en tête. Les `info` déjà vues restent : la liste dit ce qui est
 * en cours, la pastille du rail ce qui est nouveau ou à régler.
 */
const alertRows = computed(() => {
  const byDevice = new Map<string, RailAlert[]>()
  for (const a of alerts.active) byDevice.set(a.deviceId, [...(byDevice.get(a.deviceId) ?? []), a])
  return [...byDevice.values()].map((list) => {
    const first = list[0]!
    const descriptor = devices.descriptors[first.deviceId]
    return {
      deviceId: first.deviceId,
      view: first.view,
      severity: first.severity,
      name: house.houseDeviceFor(first.deviceId)?.name ?? descriptor?.name ?? first.deviceId,
      icon: deviceIcon(descriptor, devices.states[first.deviceId]),
      text: list.map(alertText).join(' · '),
    }
  })
})

/** Un appareil de la maison : on le sélectionne dans la scène (sa pièce se cadre, son panneau s'ouvre). Sinon, sa vue. */
function openAlert(deviceId: string, view: string) {
  const hd = house.houseDeviceFor(deviceId)
  if (hd) house.selectDevice(hd.id)
  else void router.push({ name: view })
}
</script>

<template>
  <div v-if="stats.length" class="tiles">
    <router-link v-for="s in stats" :key="s.key" :to="{ name: s.to }" class="tile-link">
      <StatTile :value="s.value" :label="s.label" />
    </router-link>
  </div>
  <!-- calée au FOND du panneau (margin-top: auto) : elle paraît et part sans rien déplacer au-dessus -->
  <section v-if="alertRows.length" class="alerts" :aria-label="$t('alerts.title')">
    <div class="section-label">{{ $t('alerts.title') }}</div>
    <button v-for="r in alertRows" :key="r.deviceId" type="button" class="alert-row" :data-severity="r.severity"
            :title="`${r.name} · ${r.text}`" @click="openAlert(r.deviceId, r.view)">
      <span class="icon-square"><StrokeIcon :name="r.icon" :size="18" /></span>
      <span class="alert-row__main">
        <span class="alert-row__name">{{ r.name }}</span>
        <MarqueeText class="alert-row__text" :text="r.text" />
      </span>
      <StrokeIcon class="alert-row__go" name="chevron" :size="16" />
    </button>
  </section>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
/* la tuile reste une tuile : ni soulignement ni couleur de lien, seul le fond répond au survol */
.tile-link { display: block; min-width: 0; color: inherit; text-decoration: none; border-radius: var(--radius); }
.tile-link:hover .stat-tile { background: var(--accent-soft); }
.tile-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.alerts { margin-top: auto; display: flex; flex-direction: column; gap: 8px; }
/* même ligne que celles des pièces (`RoomRows`) : deux lignes de texte de hauteur fixe */
.alert-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius); border: 0;
  background: var(--surface2); color: var(--text); text-align: left; width: 100%; font: inherit; cursor: pointer;
}
.alert-row:hover { filter: brightness(1.03); }
.alert-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.alert-row__main { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.alert-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alert-row__text { font-size: 12px; color: var(--muted); }
.alert-row[data-severity='problem'] .alert-row__text { color: rgb(var(--v-theme-warning)); }
.alert-row[data-severity='critical'] .alert-row__text { color: rgb(var(--v-theme-error)); }
/* même correction de contraste que les cartes des animaux : le jeton `warning` brut passe sous AA en clair */
html[data-theme='light'] .alert-row[data-severity='problem'] .alert-row__text { color: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, black); }
.alert-row__go { flex: none; color: var(--muted); }
</style>
