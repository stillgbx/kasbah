<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import PageHeader from '../components/layout/PageHeader.vue'
import SidePanel from '../components/layout/SidePanel.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import HomePanel from '../components/home/HomePanel.vue'
import RoomPanel from '../components/home/RoomPanel.vue'
import DevicePanel from '../components/home/DevicePanel.vue'
import { useHouseScene } from '../composables/useHouseScene'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore, type FloorTab } from '../stores/house'

defineOptions({ name: 'HomeView' })

// Vue Maison : en-tête (nom, résumé, onglets de niveau), scène 3D avec marqueurs, panneau latéral
// contextuel (maison → pièce → appareil). La sélection vit dans le store ; l'URL la reflète.
const house = useHouseStore()
const devices = useDevicesStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const wide = useMediaQuery('(min-width: 1000px)')

const canvas = ref<HTMLCanvasElement | null>(null)
const labelLayer = ref<HTMLDivElement | null>(null)
const panelOpen = ref(false)

const scene = useHouseScene({
  canvas, labelLayer,
  house: computed(() => house.effective),
  states: computed(() => devices.states),
})

// Onglets à contre-courant des listes de l'app (qui vont du haut vers le bas, cf. `levelsSorted`) :
// ici on monte, Jardin → RDC → étages → Tout. La rangée se lit comme une coupe du bâtiment, terrain
// à gauche, et l'onglet ne bouge pas quand un niveau s'ajoute au-dessus.
const floorTabs = computed(() => [
  { value: 'garden' as FloorTab, label: t('floors.garden') },
  ...[...house.levels].reverse().map((l) => ({ value: l.id as FloorTab, label: l.shortName ?? l.name })),
  { value: 'all' as FloorTab, label: t('floors.all') },
])

function onTab(tab: FloorTab) {
  house.setFloorTab(tab)
  if (tab === 'garden') scene.focusOutdoor()
  else if (tab === 'all') { scene.focusLevel(null); scene.highlightRoom(null); scene.resetView() }
  else scene.focusLevelView(tab)
}

// scène → store
scene.onDeviceTap((key) => { house.selectDevice(key); panelOpen.value = true })
scene.onRoomTap((roomId) => {
  if (house.selectedRoomId === roomId && !house.selectedKey) { house.selectRoom(null); scene.highlightRoom(null) }
  else { house.selectRoom(roomId); panelOpen.value = true }
})
scene.onZoneTap((zoneId) => { house.selectRoom(zoneId); panelOpen.value = true })
// Tap sur le toit : il porte un niveau (caméra, panneaux) mais aucune pièce. On SÉLECTIONNE ce
// niveau — onglet, panneau de ses appareils et cadrage sur la dalle — au lieu de laisser le rayon
// traverser jusqu'à la pièce cachée dessous, ce qui faisait disparaître le toit au profit de
// l'étage. Déjà dessus, le tap ressort, comme un second tap sur une pièce.
scene.onLevelTap((levelId) => {
  if (house.selectedLevelId === levelId) house.backToHome()
  else { house.selectLevel(levelId); panelOpen.value = true }
})
scene.onBackgroundTap(() => house.clearSelection())

// Le fil d'Ariane remonte d'un cran (appareil → pièce → niveau → maison) ; arrivé à « Maison », il
// fait ce que fait l'onglet « Tout » : le mot promet la maison entière, pas le niveau qu'on
// regardait encore. Sans cela, revenir à « Maison » depuis le 1er laissait la vue sur le 1er.
function backToAll() { if (!house.selectedRoomId && !house.selectedLevelId) onTab('all') }
function onDeviceBack() { house.backFromDevice(); backToAll() }
function onRoomBack() { house.backFromRoom(); backToAll() }

// store → scène. Le cadrage suit la sélection la PLUS FINE : un appareil se cadre sur lui-même, pas
// sur sa pièce — sinon un plafonnier de grand séjour restait un point dans un coin de l'écran.
function frameSelection(roomId: string | null, key: string | null) {
  const zone = !!roomId && !!house.index?.zonesById.has(roomId)
  if (key) { scene.highlightRoom(zone ? null : roomId); scene.focusDevice(key); return }
  if (!roomId) { scene.highlightRoom(null); return }
  if (zone) scene.focusZone(roomId)
  else scene.focusRoom(roomId)
}
watch(() => house.focusedLevelId, (id) => scene.focusLevel(id))
// un niveau sélectionné se cadre comme une pièce sélectionnée : c'est lui qu'on est venu voir
watch(() => house.selectedLevelId, (id) => { if (id) scene.focusLevelView(id) })
watch([() => house.selectedRoomId, () => house.selectedKey], ([roomId, key]) => {
  scene.setSelected(key)
  frameSelection(roomId, key)
})
watch(scene.ready, (ready) => {
  if (!ready) return
  scene.focusLevel(house.focusedLevelId)
  scene.setSelected(house.selectedKey)
  frameSelection(house.selectedRoomId, house.selectedKey)
}, { immediate: true })

// mode « déplacer » : glissement 3D → brouillon (store) → aperçu 3D ; dépôt → écriture house.json
scene.onDeviceDrag((_key, xy, roomId) => house.previewPosition(xy, roomId))
scene.onDeviceDrop(() => { void house.savePlacement() })
watch(() => house.placing, (p) => scene.setMovable(p ? house.selectedKey : null), { immediate: true })
watch(() => house.draft, (d) => {
  const hd = house.selectedDevice
  if (house.placing && hd) scene.moveMarker(hd.id, d?.position ?? hd.position)
})

// URL ↔ sélection
watch([() => house.floorTab, () => house.selectedRoomId, () => house.selectedKey], ([tab, room, device]) => {
  const q: Record<string, string> = {}
  if (tab !== 'all') q.level = tab
  if (room) q.room = room
  if (device) q.device = device
  void router.replace({ query: q })
})
let urlApplied = false
watch(() => house.index, (idx) => {
  if (!idx || urlApplied) return
  urlApplied = true
  const { level, room, device } = route.query as Record<string, string | undefined>
  if (level && (level === 'garden' || idx.levelsById.has(level))) house.setFloorTab(level)
  if (room && (idx.roomsById.has(room) || idx.zonesById.has(room))) house.selectRoom(room)
  if (device) house.selectDevice(device)
}, { immediate: true })

// Sonnette : à un coup de sonnette (événement `deviceEvent` du plugin Nest), on ramène sur la maison,
// on sélectionne la sonnette et on ouvre le panneau — son direct s'affiche alors dans la carte détail,
// et les watchers ci-dessus cadrent sa pièce (« Sas d'entrée »). La vue est gardée en vie, donc
// l'abonnement tient à travers les changements d'onglet ; on réagit même en venant d'une autre vue.
let offDeviceEvent: (() => void) | null = null
onMounted(() => {
  offDeviceEvent = devices.onDeviceEvent(async (deviceId, event) => {
    if (event !== 'chime') return
    const hd = house.houseDeviceFor(deviceId)
    // ramener sur la maison AVANT de sélectionner : sinon le watcher qui reflète la sélection dans
    // l'URL la réécrit sur la vue courante et annule la navigation (course constatée depuis /cameras).
    await router.push({ name: 'home' }).catch(() => { /* navigation redondante */ })
    house.selectDevice(hd?.id ?? deviceId)   // placée → cadrage de sa pièce ; sinon au moins le direct
    panelOpen.value = true
  })
})
onUnmounted(() => { offDeviceEvent?.() })

const panelMode = computed<'device' | 'room' | 'level' | 'home'>(() =>
  (house.selectedKey ? 'device' : house.selectedRoomId ? 'room' : house.selectedLevelId ? 'level' : 'home'))
</script>

<template>
  <div class="home">
    <div class="home__main">
      <PageHeader>
        <Segmented :model-value="house.floorTab" :options="floorTabs" @update:model-value="onTab" />
        <button v-if="!wide" type="button" class="pill" :data-on="panelOpen ? '1' : '0'" :aria-label="$t('home.openPanel')" @click="panelOpen = !panelOpen">
          <StrokeIcon name="list" :size="18" />
        </button>
      </PageHeader>
      <div class="home__stage">
        <canvas ref="canvas" class="scene-canvas" tabindex="0" />
        <div ref="labelLayer" class="scene-labels" />
        <div v-if="!scene.supported.value" class="home__fallback card">{{ $t('scene.webglUnavailable') }}</div>
        <div v-if="house.loading" class="home__loading muted">{{ $t('common.loading') }}</div>
        <div class="home__hint muted">{{ $t('home.hint3d') }}</div>
        <button type="button" class="home__reset pill" :title="$t('home.resetView')" @click="onTab('all')">
          <StrokeIcon name="home" :size="18" />
        </button>
      </div>
    </div>
    <SidePanel :open="panelOpen" :docked="wide" @close="panelOpen = false">
      <DevicePanel v-if="panelMode === 'device'" @back="onDeviceBack()" />
      <RoomPanel v-else-if="panelMode === 'room' || panelMode === 'level'" @back="onRoomBack()" />
      <HomePanel v-else />
    </SidePanel>
  </div>
</template>

<style scoped>
.home { position: relative; height: 100%; display: grid; grid-template-columns: 1fr auto; min-height: 0; }
.home__main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.home__stage { position: relative; flex: 1 1 0; min-height: 0; }
.home__fallback { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 16px 20px; }
.home__loading { position: absolute; left: 24px; top: 12px; font-size: 13px; }
.home__hint { position: absolute; left: 24px; bottom: calc(var(--safe-bottom) + 18px); font-size: 12px; pointer-events: none; }
.home__reset { position: absolute; right: 18px; bottom: calc(var(--safe-bottom) + 14px); width: 40px; padding: 0; justify-content: center; z-index: 2; }
</style>
