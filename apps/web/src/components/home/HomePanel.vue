<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StateFor } from '@kasbah/shared'
import { useHomeSummary } from '../../composables/useHomeSummary'
import { useDevicesStore } from '../../stores/devices'
import { useHouseStore } from '../../stores/house'
import { useScenesStore } from '../../stores/scenes'
import { useSettingsStore } from '../../stores/settings'
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
const settings = useSettingsStore()
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
// --- places de stationnement, en MODE ÉDITION seulement : c'est du relevé, pas du pilotage. Elles
// vivent dans le panneau de la maison et non dans celui d'une pièce (comme les ouvertures) parce
// qu'une place n'appartient à personne — elle peut être dans un garage, dans l'allée ou sur le
// terrain, et c'est la maison entière qui les porte (`site.parkings`).
const editing = computed(() => settings.houseEditing)
const parkings = computed(() => (editing.value ? house.parkings : []))
function parkingRow(p: (typeof house.parkings)[number]) {
  const who = p.deviceId
    ? house.houseDeviceFor(p.deviceId)?.name ?? devices.descriptors[p.deviceId]?.name ?? p.deviceId
    : t('parking.shared')
  return {
    id: p.id, label: p.name ?? p.id,
    sub: `${p.accepts === 'vehicle' ? t('parking.bay') : t('parking.dock')} · ${who} · ${p.size[0].toFixed(2)} × ${p.size[1].toFixed(2)} m`,
  }
}
/** Ce qu'on peut poser : une place de voiture partagée, et la base de chaque robot connu. */
const parkingChoices = computed(() => {
  const robots = Object.values(devices.descriptors)
    .filter((d) => d.kind === 'mower' || d.kind === 'vacuum')
    .map((d) => ({
      accepts: d.kind, deviceId: d.id,
      label: t('parking.addDock', { name: house.houseDeviceFor(d.id)?.name ?? d.name }),
    }))
  return [{ accepts: 'vehicle' as const, deviceId: undefined, label: t('parking.addBay') }, ...robots]
})
const armedParking = computed(() => house.placingParking)

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

  <!-- Mode édition : les places de stationnement, posées et réglées comme les ouvertures. Hors
       édition, cette section n'existe pas — le panneau de la maison reste celui qu'on pilote. -->
  <section v-if="editing" class="block">
    <div class="section-label">{{ $t('parking.list') }}</div>
    <div v-if="parkings.length" class="rows">
      <button v-for="p in parkings.map(parkingRow)" :key="p.id" type="button" class="park-row" @click="house.selectParking(p.id)">
        <span class="icon-square"><StrokeIcon name="parking" :size="18" /></span>
        <div class="park-row__main">
          <div class="park-row__name">{{ p.label }}</div>
          <div class="muted park-row__sub">{{ p.sub }}</div>
        </div>
        <StrokeIcon name="chevron" :size="18" class="muted" />
      </button>
    </div>
    <p v-else class="muted empty">{{ $t('parking.none') }}</p>

    <!-- Ajouter : le menu donne ce qui s'y range, le tap au sol donne la place. Le bouton garde la
         même boîte une fois armé (il devient « Annuler ») : rien ne bouge sous le doigt. -->
    <v-menu v-if="!armedParking" location="bottom start">
      <template #activator="{ props: menu }">
        <button v-bind="menu" type="button" class="pill add" :disabled="house.savingParking">
          <StrokeIcon name="plus" :size="16" /> {{ $t('parking.add') }}
        </button>
      </template>
      <div class="add-list card">
        <div class="section-label add-list__title">{{ $t('parking.add') }}</div>
        <button v-for="c in parkingChoices" :key="c.deviceId ?? c.accepts" type="button" class="add-item"
                @click="house.startPlacingParking(c.accepts, c.deviceId)">
          {{ c.label }}
        </button>
      </div>
    </v-menu>
    <button v-else type="button" class="pill add add--armed" @click="house.cancelPlacingParking()">
      {{ $t('parking.cancel') }}
    </button>
    <!-- place réservée : la consigne apparaît sans pousser la liste (hauteur fixe, deux lignes) -->
    <p class="muted hint">{{ armedParking ? $t('parking.placeHint') : '' }}</p>
  </section>

  <div class="muted text-center hint">{{ $t('home.selectHint') }}</div>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.block { display: grid; gap: 8px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.hint { font-size: 12px; margin: 0; min-height: 32px; }
.rows { display: grid; gap: 8px; }
/* même ligne que celle d'une ouverture dans le panneau d'une pièce */
.park-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--radius);
  background: var(--surface2); border: 0; width: 100%; text-align: left; font: inherit; color: inherit;
  cursor: pointer; transition: filter .15s;
}
.park-row:hover { filter: brightness(1.03); }
.park-row__main { flex: 1 1 0; min-width: 0; }
.park-row__name { font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.park-row__sub { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.empty { font-size: 13px; margin: 0; }
.add { width: 100%; justify-content: center; gap: 8px; }
.add--armed { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.add-list { padding: 8px; display: grid; gap: 2px; min-width: 200px; }
.add-list__title { padding: 2px 8px 4px; }
.add-item {
  display: block; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 8px;
  background: transparent; color: var(--text); font: inherit; font-size: 14px; cursor: pointer;
}
.add-item:hover { background: var(--surface2); }
</style>
