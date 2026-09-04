<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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

const floorTabs = computed(() => [
  { value: 'garden' as FloorTab, label: t('floors.garden') },
  ...house.levels.map((l) => ({ value: l.id as FloorTab, label: l.shortName ?? l.name })),
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
scene.onBackgroundTap(() => house.clearSelection())

// store → scène
watch(() => house.focusedLevelId, (id) => scene.focusLevel(id))
watch(() => house.selectedRoomId, (id) => {
  if (!id) { scene.highlightRoom(null); return }
  if (house.index?.zonesById.has(id)) scene.focusZone(id)
  else scene.focusRoom(id)
})
watch(() => house.selectedKey, (k) => scene.setSelected(k))
watch(scene.ready, (ready) => {
  if (!ready) return
  scene.focusLevel(house.focusedLevelId)
  if (house.selectedRoomId) { if (house.index?.zonesById.has(house.selectedRoomId)) scene.focusZone(house.selectedRoomId); else scene.focusRoom(house.selectedRoomId) }
  scene.setSelected(house.selectedKey)
}, { immediate: true })

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

const panelMode = computed<'device' | 'room' | 'home'>(() => (house.selectedKey ? 'device' : house.selectedRoomId ? 'room' : 'home'))
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
      <DevicePanel v-if="panelMode === 'device'" @back="house.clearSelection()" />
      <RoomPanel v-else-if="panelMode === 'room'" @back="house.backToHome()" />
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
