<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useScenesStore } from '../../stores/scenes'
import { formatPercent, formatPower } from '../../lib/format'
import RoomRows from './RoomRows.vue'
import SceneChips from '../scenes/SceneChips.vue'
import StatTile from '../ui/StatTile.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { IconName } from '../../lib/strokeIcons'

// Panneau « maison » : les tuiles de synthèse, scènes, liste des pièces (puis zones du jardin).
const house = useHouseStore()
const devices = useDevicesStore()
const pluginScenes = useScenesStore()
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

const rooms = computed(() => {
  const idx = house.index
  if (!idx) return []
  return idx.levelsSorted.flatMap((level) => (idx.roomsByLevel.get(level.id) ?? []).filter((r) => r.kind !== 'stairs').map((room) => ({
    id: room.id, name: room.name, where: level.name,
    deviceIds: (idx.devicesByRoom.get(room.id) ?? []).map((d) => d.deviceId),
  })))
})
const zones = computed(() => {
  const idx = house.index
  if (!idx) return []
  return house.zones.map((z) => ({
    id: z.id, name: z.name, where: t('home.garden'),
    deviceIds: (idx.devicesByZone.get(z.id) ?? []).map((d) => d.deviceId),
  })).filter((z) => z.deviceIds.length > 0)
})
const scenes = computed(() => house.house?.scenes ?? [])
/**
 * Ambiances du fabricant qu'aucune pièce ne réclame (zones Hue, pièces hors maison), regroupées
 * par groupe du fabricant : deux zones portent souvent une ambiance du MÊME nom, l'étiquette lève
 * l'ambiguïté.
 */
const crossRoomGroups = computed(() => {
  const scenes = pluginScenes.forHouse([
    ...(house.house?.rooms ?? []).map((r) => r.name),
    ...house.zones.map((z) => z.name),
  ])
  const acc = new Map<string, { key: string; label: string; scenes: typeof scenes }>()
  for (const e of scenes) {
    const name = e.scene.group?.name
    const key = name ?? ''
    const g = acc.get(key)
    if (g) g.scenes.push(e)
    else acc.set(key, { key, label: name ? t('scenes.group', { name }) : t('scenes.title'), scenes: [e] })
  }
  return [...acc.values()].sort((a, b) => a.label.localeCompare(b.label))
})
const sceneIcon = (icon?: string): IconName => (icon === 'leave' || icon === 'night' || icon === 'movie' ? icon : 'bolt')
</script>

<template>
  <div v-if="stats.length" class="tiles">
    <StatTile v-for="s in stats" :key="s.key" :value="s.value" :label="s.label" />
  </div>

  <section v-if="scenes.length" class="block">
    <div class="section-label">{{ $t('home.scenes') }}</div>
    <div class="chips">
      <button v-for="s in scenes" :key="s.id" type="button" class="pill" @click="devices.runScene(s.actions)">
        <StrokeIcon :name="sceneIcon(s.icon)" :size="16" />{{ s.name }}
      </button>
    </div>
  </section>

  <SceneChips v-for="g in crossRoomGroups" :key="g.key" :scenes="g.scenes" :label="g.label" :add-to="g.key || undefined" />

  <section class="block">
    <div class="section-label">{{ $t('home.rooms') }}</div>
    <RoomRows :rows="[...rooms, ...zones]" />
  </section>

  <div class="muted text-center hint">{{ $t('home.selectHint') }}</div>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.block { display: grid; gap: 8px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.hint { font-size: 12px; }
</style>
