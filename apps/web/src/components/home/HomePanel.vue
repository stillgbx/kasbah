<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useScenesStore } from '../../stores/scenes'
import RoomRows from './RoomRows.vue'
import SceneChips from '../scenes/SceneChips.vue'
import StatTile from '../ui/StatTile.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { IconName } from '../../lib/strokeIcons'

// Panneau « maison » : 4 tuiles de synthèse, scènes, liste des pièces (puis zones du jardin).
const house = useHouseStore()
const devices = useDevicesStore()
const pluginScenes = useScenesStore()
const summary = useHomeSummary()
const { t } = useI18n()

const stats = computed(() => {
  const out: { value: string; label: string }[] = []
  if (summary.lights.value.length) out.push({ value: String(summary.lightsOn.value), label: t('home.lightsOn') })
  // volets et stores ont leur propre tuile : « ouverts » et « baissés » ne sont pas la même mesure
  if (summary.shutters.value.length) out.push({ value: `${summary.shuttersOpen.value}/${summary.shutters.value.length}`, label: t('home.shuttersOpen') })
  if (summary.awnings.value.length) out.push({ value: `${summary.awningsDown.value}/${summary.awnings.value.length}`, label: t('home.awningsDown') })
  // caméras et lecteurs plutôt que solaire et batterie : l'énergie a sa propre vue, et ces deux
  // compteurs manquaient d'un endroit où se voir d'un coup d'œil.
  if (summary.cameras.value.length) out.push({ value: String(summary.cameras.value.length), label: t('home.cameras') })
  if (summary.players.value.length) out.push({ value: `${summary.playing.value}/${summary.players.value.length}`, label: t('home.players') })
  return out.slice(0, 6)   // grille à 2 colonnes : les tuiles passent à la ligne
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
    <StatTile v-for="s in stats" :key="s.label" :value="s.value" :label="s.label" />
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
