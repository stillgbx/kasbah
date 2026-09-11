<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HouseDevice } from '@kasbah/shared'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { formatPercent, formatPower } from '../../lib/format'
import { isDeviceOn } from '../../lib/deviceState'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useScenesStore } from '../../stores/scenes'
import RoomLightsToggle from '../devices/RoomLightsToggle.vue'
import SceneChips from '../scenes/SceneChips.vue'
import StatTile from '../ui/StatTile.vue'
import StrokeIcon from '../ui/StrokeIcon.vue'
import type { IconName } from '../../lib/strokeIcons'

// Panneau « maison » : 4 tuiles de synthèse, scènes, liste des pièces (puis zones du jardin).
const house = useHouseStore()
const devices = useDevicesStore()
const pluginScenes = useScenesStore()
const summary = useHomeSummary()
const { t, locale } = useI18n()

const stats = computed(() => {
  const out: { value: string; label: string }[] = []
  if (summary.lights.value.length) out.push({ value: String(summary.lightsOn.value), label: t('home.lightsOn') })
  // volets et stores ont leur propre tuile : « ouverts » et « baissés » ne sont pas la même mesure
  if (summary.shutters.value.length) out.push({ value: `${summary.shuttersOpen.value}/${summary.shutters.value.length}`, label: t('home.shuttersOpen') })
  if (summary.awnings.value.length) out.push({ value: `${summary.awningsDown.value}/${summary.awnings.value.length}`, label: t('home.awningsDown') })
  const e = summary.energy.value
  if (e) out.push({ value: formatPower(e.productionW, locale.value), label: t('home.solar') })
  if (e?.batterySoc !== undefined) out.push({ value: formatPercent(e.batterySoc, locale.value), label: t('home.battery') })
  return out.slice(0, 6)   // grille à 2 colonnes : les tuiles passent à la ligne
})

function counts(list: HouseDevice[]) {
  const bound = list.filter((d) => d.deviceId && devices.states[d.deviceId])
  // actif par lui-même, ou parce qu'il joue le son d'un autre (barre de son d'une TV, `lib/audioRouting.ts`)
  const on = bound.filter((d) => isDeviceOn(devices.states[d.deviceId!]!) || house.soundRoutes.relays.has(d.deviceId!)).length
  return `${t('home.devicesCount', { n: list.length }, list.length)} · ${t('home.active', { n: on }, on)}`
}

const rooms = computed(() => {
  const idx = house.index
  if (!idx) return []
  return idx.levelsSorted.flatMap((level) => (idx.roomsByLevel.get(level.id) ?? []).filter((r) => r.kind !== 'stairs').map((room) => ({
    id: room.id, name: room.name, sub: counts(idx.devicesByRoom.get(room.id) ?? []), where: level.name,
    deviceIds: (idx.devicesByRoom.get(room.id) ?? []).map((d) => d.deviceId),
  })))
})
const zones = computed(() => {
  const idx = house.index
  if (!idx) return []
  return house.zones.map((z) => ({
    id: z.id, name: z.name, sub: counts(idx.devicesByZone.get(z.id) ?? []), where: t('home.garden'),
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
    <!-- `div` et non `button` : la ligne porte maintenant un interrupteur, et un bouton dans un
         bouton n'est pas du HTML valide (l'imbrication casse le clic sur Safari iOS) -->
    <div v-for="r in [...rooms, ...zones]" :key="r.id" class="room-row" role="button" tabindex="0"
         :data-on="house.selectedRoomId === r.id ? '1' : '0'" @click="house.selectRoom(r.id)" @keydown.enter="house.selectRoom(r.id)">
      <div class="room-row__main">
        <div class="room-row__name">{{ r.name }}</div>
        <div class="room-row__sub">{{ r.sub }}</div>
      </div>
      <div class="room-row__where">{{ r.where }}</div>
      <!-- éteindre une pièce sans y entrer : le geste le plus court depuis le panneau maison -->
      <RoomLightsToggle :device-ids="r.deviceIds" />
    </div>
  </section>

  <div class="muted text-center hint">{{ $t('home.selectHint') }}</div>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.block { display: grid; gap: 8px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.room-row {
  display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: var(--radius); border: 0;
  background: var(--surface2); color: var(--text); text-align: left; width: 100%; transition: background .15s;
  cursor: pointer;
}
.room-row:hover { filter: brightness(1.03); }
.room-row[data-on='1'] { outline: 2px solid var(--accent); outline-offset: -2px; }
.room-row__main { flex: 1 1 0; min-width: 0; }
/* une ligne chacun, coupés aux points de suspension comme partout ailleurs : l'interrupteur maître
   a pris 52 px, et sans cela « Salle de Jeux · Rez-de-chaussée » passait sur deux lignes — la
   liste n'aurait plus eu des lignes de même hauteur */
.room-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-row__sub { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-row__where { font-size: 12px; color: var(--muted); white-space: nowrap; }
.hint { font-size: 12px; }
</style>
