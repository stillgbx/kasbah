<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { isPlaced, panelOf } from '@kasbah/shared'
import PageHeader from '../components/layout/PageHeader.vue'
import SidePanel from '../components/layout/SidePanel.vue'
import Segmented from '../components/ui/Segmented.vue'
import StrokeIcon from '../components/ui/StrokeIcon.vue'
import HomePanel from '../components/home/HomePanel.vue'
import RoomPanel from '../components/home/RoomPanel.vue'
import RoomEditPanel from '../components/home/RoomEditPanel.vue'
import DevicePanel from '../components/home/DevicePanel.vue'
import OpeningPanel from '../components/home/OpeningPanel.vue'
import ParkingPanel from '../components/home/ParkingPanel.vue'
import GardenPanel from '../components/home/GardenPanel.vue'
import HouseEditPanel from '../components/home/HouseEditPanel.vue'
import SceneDebug from '../components/home/SceneDebug.vue'
import SceneTuningPanel from '../components/home/SceneTuningPanel.vue'
import ReliefPanel from '../components/home/ReliefPanel.vue'
import SearchBar from '../components/home/SearchBar.vue'
import WeatherWidget from '../components/home/WeatherWidget.vue'
import { useHouseScene } from '../composables/useHouseScene'
import { useSceneGroundOverlay } from '../composables/useSceneGroundOverlay'
import { homePanelRequest, type SearchHit } from '../composables/useSearch'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore, type FloorTab } from '../stores/house'
import { useSettingsStore } from '../stores/settings'
import type { IconName } from '../lib/strokeIcons'
import SceneLoader from '../components/home/SceneLoader.vue'
import OnboardingCoach from '../components/property/OnboardingCoach.vue'
import type { ScenePrepareStage } from '../three/HouseScene'

defineOptions({ name: 'HomeView' })

// House view: the 3D scene takes ALL the space (even under the rail), and the rest floats over it:
// header (name, summary, level tabs) at the top, view buttons (rotation, zoom, overview)
// at the bottom right, contextual panel (house → room → device) as a card on the right. The
// selection lives in the store; the URL reflects it.
const house = useHouseStore()
const devices = useDevicesStore()
const settings = useSettingsStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const wide = useMediaQuery('(min-width: 1000px)')
/** Phone in portrait: the level tabs go on their own row and share its width. */
const phone = useMediaQuery('(max-width: 599px)')

const canvas = ref<HTMLCanvasElement | null>(null)
const labelLayer = ref<HTMLDivElement | null>(null)
const panelOpen = ref(false)

const scene = useHouseScene({
  canvas, labelLayer,
  house: computed(() => house.effective),
  states: computed(() => devices.states),
})

// The loading veil: the house arrives from the server, then the scene prepares it (materials,
// shaders, first frame — `HouseScene.prepare`). On the FIRST load, the 3D and what only serves
// it (levels, search, camera) start HIDDEN and the veil is there from the start: nothing
// shows up only to fade right away. Afterwards (a house reloaded in edit mode), the veil
// only comes back past a short delay, so that a quick rebuild does not make the view flicker.
const LOADER_DELAY_MS = 250
const houseLoading = computed(() => house.loading || scene.preparing.value !== null)
const loaderShown = ref(false)
/** The first load is not finished (and not failed: an error must not leave the veil up). */
const firstLoad = computed(() => !scene.shown.value && !house.error)
const loaderNeeded = computed(() => firstLoad.value || loaderShown.value)
// Once shown, the veil stays for a cycle and a half of drawing (`settled`): otherwise, a quick
// load removed it before anyone had seen the house draw itself. The 3D, ready, waits underneath.
const loaderDrawn = ref(false)
const sceneHidden = ref(loaderNeeded.value)
watch([loaderNeeded, loaderDrawn], ([needed, drawn]) => {
  if (needed && !sceneHidden.value) { sceneHidden.value = true; loaderDrawn.value = false }
  else if (!needed && drawn) sceneHidden.value = false
})
// the last known step: during the fade-out, the subtitle does not fall back to the first one
const loaderStage = ref<'house' | ScenePrepareStage>('house')
const loaderProgress = ref<{ done: number; total: number } | null>(null)
let loaderTimer: ReturnType<typeof setTimeout> | undefined
watch(houseLoading, (on) => {
  clearTimeout(loaderTimer)
  if (on) loaderTimer = setTimeout(() => { loaderShown.value = true }, LOADER_DELAY_MS)
  else loaderShown.value = false
}, { immediate: true })
watch([() => house.loading, scene.preparing], ([fetching, prep]) => {
  if (fetching) { loaderStage.value = 'house'; loaderProgress.value = null }
  else if (prep) { loaderStage.value = prep.stage; loaderProgress.value = prep.progress }
}, { immediate: true })
onUnmounted(() => clearTimeout(loaderTimer))
// Tabs against the grain of the app's lists (which go top to bottom, see `levelsSorted`): here we
// go up, Garden → ground floor → upper floors → All. The row reads like a cross-section of the
// building, terrain on the left, and the tab does not move when a level is added above.
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

// scene → store
//
// While a panel ARRAY is being adjusted, the scene no longer changes subject: a tap on one of
// its modules, on the roof that carries it or on the background used to close the adjustment
// (the selection changed, and with it the panel that opened it). We came to move the array, not
// to select something else.
const editingModule = (key: string) => {
  const hd = house.index?.devicesById.get(key)
  return !!house.editingArrayId && !!hd && panelOf(hd)?.arrayId === house.editingArrayId
}
scene.onDeviceTap((key) => {
  if (editingModule(key)) return
  // same safeguard as the background and the rooms: a device tapped while an opening is being
  // adjusted (a shutter, a sensor placed right next to it) must not close the panel by surprise
  if (house.selectedOpeningId) return
  house.selectDevice(key); panelOpen.value = true
})
// edit mode: a touched opening opens like a device; the drag sets the draft
// (immediate 3D preview, see `withOpeningDraft`), the drop writes it to house.json.
scene.onOpeningTap((openingId) => { house.selectOpening(openingId); panelOpen.value = true })
scene.onOpeningDrag((_openingId, xy) => house.previewOpeningAt(xy))
scene.onOpeningDrop(() => { void house.dropOpening() })
// edit mode: a parking spot is touched, dragged and written exactly like an
// opening — the gesture is the same, on the ground.
scene.onParkingTap((parkingId) => { house.selectParking(parkingId); panelOpen.value = true })
scene.onParkingDrag((_parkingId, xy) => house.previewParkingAt(xy))
scene.onParkingDrop(() => { void house.dropParking() })
// edit mode: a tree, a bush, a stone are touched and dragged like a spot; an
// armed family plants one element at each tap on the terrain
scene.onGardenTap((id) => { house.selectGardenItem(id); panelOpen.value = true })
scene.onGardenDrag((_id, xy) => house.previewGardenAt(xy))
scene.onGardenDrop(() => { void house.dropGardenItem() })
scene.onGardenPlaceTap((xy) => { void house.placeGardenAt(xy) })
watch(() => house.placingGarden, (armed) => scene.setPlacingGarden(!!armed))
watch(() => house.selectedGardenId, (id) => {
  scene.setSelectedGarden(id)
  if (id) scene.focusGarden(id)
})
// "place" mode: a kind armed in the room panel waits for the wall. The tap reports the
// touched point; it is the store that deduces the wall and the position, as for a drag.
scene.onPlaceTap((xy) => { void house.placeOpeningAt(xy) })
watch(() => house.placingOpening, (armed) => scene.setPlacingOpening(armed))
// "place a spot" mode: the tap on the ground gives the center; the rest (catalog dimensions,
// direction of the garage) is decided by the store, as for an opening placed on a wall.
scene.onGroundTap((xy, levelId) => { void house.placeParkingAt(xy, levelId) })
watch(() => house.placingParking, (armed) => scene.setPlacingParking(!!armed))
// "place a room" mode: the tap on the ground gives the center of a 4 m square, on the armed level
scene.onRoomPlaceTap((xy) => house.placeRoomAt(xy))
watch(() => house.placingRoom, (armed) => scene.setPlacingRoom(!!armed))
scene.onRoomTap((roomId) => {
  // while an opening, a spot or a tree is being adjusted, a tap on a room's floor
  // OPENS that room: we leave the adjustment (each gesture is already written there) without
  // going back through the breadcrumb. The earlier safeguard ignored the tap, and you stayed
  // stuck on the opening.
  if (house.selectedOpeningId || house.selectedParkingId || house.selectedGardenId) {
    if (house.selectedOpeningId) house.selectOpening(null)
    if (house.selectedParkingId) house.selectParking(null)
    if (house.selectedGardenId) house.selectGardenItem(null)
    house.selectRoom(roomId)
    panelOpen.value = true
    return
  }
  if (house.selectedRoomId === roomId && !house.selectedKey) { house.selectRoom(null); scene.highlightRoom(null) }
  else { house.selectRoom(roomId); panelOpen.value = true }
})
scene.onZoneTap((zoneId) => { house.selectRoom(zoneId); panelOpen.value = true })
// Tap on the roof: it carries a level (camera, panels) but no room. We SELECT that
// level — tab, panel of its devices and framing on the slab — instead of letting the ray
// pass through to the room hidden underneath, which made the roof disappear in favor of the
// floor. Already on it, the tap steps back out, like a second tap on a room.
scene.onLevelTap((levelId) => {
  if (house.editingArrayId) return
  if (house.selectedLevelId === levelId) house.backToHome()
  else { house.selectLevel(levelId); panelOpen.value = true }
})
scene.onBackgroundTap(() => {
  // armed to place an opening, tapping beside the frame is a renunciation: we disarm, without
  // touching the selection — the room stays open, ready for another try
  if (house.placingOpening) { house.cancelPlacingOpening(); return }
  if (house.placingParking) { house.cancelPlacingParking(); return }
  if (house.placingGarden) { house.cancelPlacingGarden(); return }
  if (house.placingRoom) { house.cancelPlacingRoom(); return }
  // an adjusted garden element is left with a tap beside it: nothing else to close behind it
  if (house.selectedGardenId) { house.selectGardenItem(null); return }
  if (!house.editingArrayId && !house.selectedOpeningId && !house.selectedParkingId) house.clearSelection()
})
// a touched log pin: it becomes the active incident (label in the scene, highlighted row in the panel)
scene.onJournalTap((at) => house.markJournalPoint(at))

// The breadcrumb goes up one notch (device → room → level → house); on reaching "House", it
// does what the "All" tab does: the word promises the whole house, not the level you
// were still looking at. Without this, going back to "House" from the first floor left the view
// on the first floor.
function backToAll() { if (!house.selectedRoomId && !house.selectedLevelId) onTab('all') }
// The return from an array module lands on its INSTALLATION: there is therefore still a device
// selected, and "All" must not clear it — that is what sent you back to "House" all at once.
function onDeviceBack() { house.backFromDevice(); if (!house.selectedKey) backToAll() }
function onRoomBack() { house.backFromRoom(); backToAll() }
/** Return from an opening: its ROOM, never the house — it is the room that carries it. */
function onOpeningBack() { house.selectOpening(null) }

// store → scene. Framing follows the FINEST selection: a device frames itself, not its room —
// otherwise a ceiling light in a large living room stayed a dot in a corner of the screen.
// A selected device does NOT light up its room: the outline and the veil covered precisely what
// we have come to adjust (a lamp's pool of light, at night). The room only lights up when it is
// the one chosen — tap on its floor, search, return from the device.
function frameSelection(roomId: string | null, key: string | null) {
  const zone = !!roomId && !!house.index?.zonesById.has(roomId)
  if (key) { scene.highlightRoom(null); scene.focusDevice(key); return }
  if (!roomId) { scene.highlightRoom(null); return }
  if (zone) scene.focusZone(roomId)
  else scene.focusRoom(roomId)
  // Adjusting an opening frames its ROOM (breadcrumb, `house.selectOpening`) but must not
  // highlight its floor: next to the accent veil and the outline around the whole contour, the
  // opening's handle weighs nothing. `focusRoom`, above, turns the highlight on internally
  // (`HouseScene.focusRoom`) — we turn it off right after, without going through the camera again.
  if (house.selectedOpeningId) scene.highlightRoom(null)
}
// opening edit mode: armed from Settings (never a floating button in the scene), followed
// by the opening selection — selecting opens it in the scene, going back to the room closes it.
// NOT `immediate` here: at first render the scene does not exist yet (it is built in the
// `onMounted` of `useHouseScene`), and the call would be a no-op — it is the `scene.ready`
// watcher, further down, that replays the state at the right moment (mode armed at load, page
// that reloads).
watch(() => settings.houseEditing, (on) => {
  scene.setEditingOpenings(on)
  scene.setEditingParkings(on)
  scene.setEditingGarden(on)
  if (!on) { house.cancelPlacingOpening(); house.cancelPlacingParking(); house.cancelPlacingGarden() }
  if (!on && house.selectedParkingId) house.selectParking(null)
  if (!on && house.selectedGardenId) house.selectGardenItem(null)
  // disarming also closes the adjustment in progress: otherwise the panel stays open and ACTIVE
  // ("+" still writes to house.json) while the scene has nothing selected anymore — the switch
  // would not close the door it claims to close
  if (!on && house.selectedOpeningId) house.selectOpening(null)
  // leaving edit mode abandons the unvalidated finishes: the scene goes back to the file
  if (!on) house.discardEdit()
})
// shaping the terrain: armed from Settings, like the light bench — same rule as above,
// it is the `scene.ready` watcher that replays the state at load
watch(() => settings.reliefEditing, (on) => scene.setEditingRelief(on))
watch(() => settings.terrainTab, (tab) => scene.setTerrainTab(tab))
// room shape: the Dimensions tab of the panel turns on its handles in the 3D. The gestures come
// back as intentions (wall pushed, vertex moved) that the store translates into measurements —
// neighbor included — and the recomputed shape goes back to the scene. A drag is only one history
// step.
const shapeRoom = computed(() => (settings.houseEditing && house.shapeEditing && house.selectedRoom ? house.selectedRoom.id : null))
watch([shapeRoom, scene.ready], ([id, ready]) => { if (ready) scene.setShapeEditing(id) }, { immediate: true })
watch([() => (shapeRoom.value ? house.shapeOf(shapeRoom.value) : null), scene.ready], ([pts, ready]) => {
  if (ready && pts) scene.setShapeOutline(pts as [number, number][])
}, { immediate: true })
watch(() => house.shapeSelection, (sel) => scene.setShapeSelection(sel))
scene.onShapeSelect((sel) => { house.shapeSelection = sel })
let shaping = false
function shapeGesture(final: boolean, preview: (roomId: string) => void) {
  const id = shapeRoom.value
  if (!id) return
  if (!shaping) { house.beginShapeDrag(); shaping = true }
  preview(id)
  if (final) { house.endShapeDrag(true); shaping = false }
}
scene.onShapeWall((edge, delta, final) => shapeGesture(final, (id) => house.previewRoomWall(id, edge, delta)))
scene.onShapeCorner((index, xy, final) => shapeGesture(final, (id) => house.previewCorner(id, index, xy)))
watch(() => house.selectedOpeningId, (id) => {
  scene.setSelectedOpening(id)
  if (id) {
    scene.focusOpening(id)
    // no room highlight while adjusting — see `frameSelection`. Necessary even here,
    // on top of the `frameSelection` safeguard: if the room was ALREADY selected (we touch an
    // opening of the room we are already looking at), `selectedRoomId` does not change and the
    // roomId/key watcher does not fire again — without this line the floor would stay lit.
    scene.highlightRoom(null)
  } else if (house.selectedRoomId && !house.selectedKey && !house.index?.zonesById.has(house.selectedRoomId)) {
    // exit: the symmetric trap — going back to the room (same id, hence the same silence from the
    // roomId/key watcher) must RELIGHT the highlight we just turned off.
    scene.highlightRoom(house.selectedRoomId)
  }
})
watch(() => house.selectedParkingId, (id) => {
  scene.setSelectedParking(id)
  if (id) scene.focusParking(id)
})
watch(() => house.focusedLevelId, (id) => scene.focusLevel(id))
// a selected level is framed like a selected room: it is what we came to see
watch(() => house.selectedLevelId, (id) => { if (id) scene.focusLevelView(id) })
watch([() => house.selectedRoomId, () => house.selectedKey], ([roomId, key]) => {
  scene.setSelected(key)
  frameSelection(roomId, key)
})
watch(scene.ready, (ready) => {
  if (!ready) return
  scene.setEditingOpenings(settings.houseEditing)
  scene.setEditingParkings(settings.houseEditing)
  scene.setEditingGarden(settings.houseEditing)
  scene.setTerrainTab(settings.terrainTab)
  scene.setEditingRelief(settings.reliefEditing)
  scene.focusLevel(house.focusedLevelId)
  scene.setSelected(house.selectedKey)
  frameSelection(house.selectedRoomId, house.selectedKey)
}, { immediate: true })

// "move" mode: 3D drag → draft (store) → 3D preview; drop → write to house.json.
// A panel array is adjusted the same way, except that you grab any one of its modules
// and the whole array follows (`previewArrayOrigin`).
scene.onDeviceDrag((key, xy, roomId) => {
  if (house.editingArrayId) house.previewArrayOrigin(key, xy)
  else house.previewPosition(xy, roomId)
})
scene.onDeviceDrop(() => { void (house.editingArrayId ? house.dropArray() : house.savePlacement()) })
watch([() => house.placing, () => house.selectedKey, () => house.editingArrayId, () => house.editingArrayModules.length], () => {
  if (house.editingArrayId) scene.setMovable(house.editingArrayModules.map((m) => m.id))
  else scene.setMovable(house.placing ? house.selectedKey : null)
}, { immediate: true })
watch(() => house.draft, (d) => {
  const hd = house.selectedDevice
  // an unplaced device has no marker to move
  const to = d?.position ?? (hd && isPlaced(hd) ? hd.position : undefined)
  if (house.placing && hd && to) scene.moveMarker(hd.id, to)
})
// adjusting an array means coming to see the level that carries it: we frame it as its tab would,
// otherwise the camera stayed on the room being looked at and the roof showed up out of frame
watch(() => house.editingArray?.levelId, (id) => { if (id) scene.focusLevelView(id) })
// grid cell hovered: its module lights up in the scene, and hands control back to the selection
watch(() => house.hoveredKey, (key) => scene.setSelected(key ?? house.selectedKey))
// preview of the chosen tint: the bodywork follows the selector, without writing anything (see `VehicleTuning`)
watch(() => house.bodyColorPreview, (p) => { if (p) scene.previewBodyColor(p.key, p.color) })
// the log expanded in the panel places its incidents on the terrain; a chosen row frames the camera on it
watch(() => house.journalOverlay, (j) => scene.setJournalPoints(j?.key ?? null, j?.points ?? []))
watch(() => house.journalFocus, (f) => { if (f) scene.focusJournalPoint(f.at) })
watch(() => house.journalActive, (at) => scene.setActiveJournalPoint(at))
// the mowers' terrain map, painted on the terrain when requested (mower panel)
useSceneGroundOverlay(scene)
// preview of the dragged array: all its modules follow the draft's origin
watch(() => house.arrayDraft, () => {
  for (const m of house.editingArrayModules) if (isPlaced(m)) scene.moveMarker(m.id, m.position)
})

// URL ↔ selection
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

// Doorbell: on a doorbell ring (`deviceEvent` event from the Nest plugin), we go back to the
// house, select the doorbell and open the panel — its live view then shows in the detail card,
// and the watchers above frame its room ("Entrance lobby"). The view is kept alive, so the
// subscription holds across tab changes; we react even when coming from another view.
let offDeviceEvent: (() => void) | null = null
onMounted(() => {
  offDeviceEvent = devices.onDeviceEvent(async (deviceId, event) => {
    if (event !== 'chime') return
    const hd = house.houseDeviceFor(deviceId)
    // go back to the house BEFORE selecting: otherwise the watcher that mirrors the selection in
    // the URL rewrites it onto the current view and cancels the navigation (race seen from /cameras).
    await router.push({ name: 'home' }).catch(() => { /* redundant navigation */ })
    house.selectDevice(hd?.id ?? deviceId)   // placed → framing of its room; otherwise at least the live view
    panelOpen.value = true
  })
})
onUnmounted(() => { offDeviceEvent?.() })

// In edit mode, a ROOM (not a garden zone, which has no wall) shows what can be
// modified about it in place of its devices: we survey the house, we do not light it.
const panelMode = computed<'opening' | 'parking' | 'garden' | 'device' | 'roomEdit' | 'room' | 'level' | 'houseEdit' | 'home'>(() => {
  if (house.selectedOpeningId) return 'opening'
  // a spot is adjusted from the house: it belongs to neither a room nor a device
  if (house.selectedParkingId) return 'parking'
  if (house.selectedGardenId) return 'garden'
  if (house.selectedKey) return 'device'
  if (house.selectedRoomId) return settings.houseEditing && house.selectedRoom ? 'roomEdit' : 'room'
  if (house.selectedLevelId) return 'level'
  // the house in edit mode shows what is ADJUSTED there (the spots), not what is driven there: the
  // section was no longer reachable under the tiles, the scenes and the room list
  return settings.houseEditing ? 'houseEdit' : 'home'
})

// The anchored panel covers the right edge of the scene: the framing aims at the free part (panel
// width and its two margins, read from the tokens).
const cssPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0
const asideInset = () => cssPx('--aside-w') + 2 * cssPx('--panel-gap')
watch([wide, scene.ready], ([w, ready]) => { if (ready) scene.setViewInset(w ? asideInset() : 0) }, { immediate: true })

// A search result has already moved the selection; what remains is to show the panel that
// carries it, which the drawer hides until we are in a wide window. A PAGE, for its part, leaves
// the view: opening the drawer for it would make it found open on return, without anyone having
// asked for it.
function onSearchPicked(hit: SearchHit) { if (hit.family !== 'page') panelOpen.value = true }
watch(homePanelRequest, () => { panelOpen.value = true })

/** One notch of rotation of the view buttons: an eighth of a turn. */
const ORBIT_STEP = Math.PI / 4
/** One notch of zoom of the view buttons. */
const DOLLY_STEP = 1.35

// Appearance: moved out of the rail, it is set here, in the header row, right after the
// level tabs — an app setting stays with the top chrome, the column at the bottom right
// keeps only the camera controls. The button has a fixed size: only the icon changes.
const APPEARANCE_ICON: Record<string, IconName> = { light: 'sun', dark: 'moon', system: 'auto', auto: 'sunHorizon' }
const themeIcon = computed<IconName>(() => APPEARANCE_ICON[settings.appearance] ?? 'auto')
</script>

<template>
  <div class="home" :data-wide="wide ? '1' : '0'" :data-loading="sceneHidden ? '1' : '0'">
    <div class="home__stage">
      <canvas ref="canvas" class="scene-canvas" tabindex="0" />
      <div ref="labelLayer" class="scene-labels" />
      <div class="home__vignette" />
      <SceneDebug v-if="settings.sceneDebug" :scene="scene.controller" />
      <SceneTuningPanel v-if="settings.sceneTuningOpen" :scene="scene.controller" />
      <ReliefPanel v-if="settings.reliefEditing" :scene="scene.controller" :state="scene.relief.value" />
      <!-- the guide that follows the creation of a property (terrain, then first room) -->
      <OnboardingCoach :wide="wide" @room="panelOpen = true" />
    </div>
    <div class="home__header">
      <PageHeader>
        <Segmented class="home__floors" :model-value="house.floorTab" :options="floorTabs" :fill="phone" :dense="phone" @update:model-value="onTab" />
        <button type="button" class="pill" :title="$t('settings.appearance')" :aria-label="$t('settings.appearance')" @click="settings.cycleAppearance()">
          <StrokeIcon :name="themeIcon" :size="18" />
        </button>
        <button v-if="!wide" type="button" class="pill" :data-on="panelOpen ? '1' : '0'" :aria-label="$t('home.openPanel')" @click="panelOpen = !panelOpen">
          <StrokeIcon name="list" :size="18" />
        </button>
      </PageHeader>
      <!-- phone in portrait: weather and overview under the levels, the bottom stays for the search -->
      <div v-if="phone" class="home__toprow">
        <WeatherWidget />
        <button type="button" class="home__ctl home__ctl--solo" :title="$t('home.resetView')" :aria-label="$t('home.resetView')" @click="onTab('all')"><StrokeIcon name="home" :size="18" /></button>
      </div>
    </div>
    <div v-if="!scene.supported.value" class="home__fallback card">{{ $t('scene.webglUnavailable') }}</div>
    <Transition name="home-loader">
      <div v-if="sceneHidden" class="home__loader">
        <SceneLoader :house="house.effective" :stage="loaderStage" :progress="loaderProgress" @settled="(v) => (loaderDrawn = v)" />
      </div>
    </Transition>
    <WeatherWidget v-if="!phone" class="home__weather" />
    <div class="home__controls">
      <div class="home__cluster">
        <button type="button" class="home__ctl" :title="$t('home.rotateLeft')" :aria-label="$t('home.rotateLeft')" @click="scene.orbitBy(-ORBIT_STEP)"><StrokeIcon name="rotateLeft" :size="18" /></button>
        <button type="button" class="home__ctl" :title="$t('home.rotateRight')" :aria-label="$t('home.rotateRight')" @click="scene.orbitBy(ORBIT_STEP)"><StrokeIcon name="rotateRight" :size="18" /></button>
      </div>
      <div class="home__cluster">
        <button type="button" class="home__ctl" :title="$t('home.zoomIn')" :aria-label="$t('home.zoomIn')" @click="scene.dollyBy(1 / DOLLY_STEP)"><StrokeIcon name="plus" :size="18" /></button>
        <button type="button" class="home__ctl" :title="$t('home.zoomOut')" :aria-label="$t('home.zoomOut')" @click="scene.dollyBy(DOLLY_STEP)"><StrokeIcon name="minus" :size="18" /></button>
      </div>
      <button v-if="!phone" type="button" class="home__ctl home__ctl--solo" :title="$t('home.resetView')" :aria-label="$t('home.resetView')" @click="onTab('all')"><StrokeIcon name="home" :size="18" /></button>
    </div>
    <div class="home__search">
      <SearchBar @picked="onSearchPicked" />
    </div>
    <SidePanel :open="panelOpen" :docked="wide" @close="panelOpen = false">
      <OpeningPanel v-if="panelMode === 'opening'" @back="onOpeningBack()" />
      <ParkingPanel v-else-if="panelMode === 'parking'" @back="house.selectParking(null)" />
      <GardenPanel v-else-if="panelMode === 'garden'" @back="house.selectGardenItem(null)" />
      <DevicePanel v-else-if="panelMode === 'device'" @back="onDeviceBack()" />
      <RoomEditPanel v-else-if="panelMode === 'roomEdit'" @back="onRoomBack()" />
      <RoomPanel v-else-if="panelMode === 'room' || panelMode === 'level'" @back="onRoomBack()" />
      <HouseEditPanel v-else-if="panelMode === 'houseEdit'" />
      <HomePanel v-else />
    </SidePanel>
  </div>
</template>

<style scoped>
/* The view overflows under the rail (negative margin of its width, which `.app-main` reserves as
   padding): the scene covers the whole window, and what floats over it is offset from the rail on
   the left. */
/* …and under the bottom bar of a phone in portrait (which `.app-main` also reserves): what floats
   at the bottom moves away from it by `--dock-h`, zero elsewhere. */
.home {
  position: relative; flex: none; height: calc(100% + var(--dock-h)); margin-left: calc(-1 * var(--rail-w)); min-height: 0;
  --float-bottom: calc(var(--safe-bottom) + var(--dock-h) + var(--panel-gap));
}
.home__stage { position: absolute; inset: 0; }
/* darkens the edges at night, like a vignette: the eye goes to the center, where the house is */
.home__vignette { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
:global(html[data-theme='dark']) .home__vignette { background: radial-gradient(ellipse 70% 65% at 50% 45%, transparent 55%, rgba(0, 0, 0, .45) 100%); }
.home__header { position: absolute; top: 0; left: var(--rail-w); right: 0; z-index: 2; pointer-events: none; }
.home__header > * { pointer-events: auto; }
.home[data-wide='1'] .home__header { right: calc(var(--safe-right) + var(--aside-w) + 2 * var(--panel-gap)); }
.home__fallback { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 16px 20px; z-index: 2; }
/* above the weather widget, which holds the bottom-left corner */
/* The loading veil, centered in the FREE part of the scene (outside the rail, outside the wide panel). */
/* it covers the whole scene: transparent to clicks, otherwise the header (appearance) is no longer touchable */
.home__loader { position: absolute; top: 0; bottom: 0; left: var(--rail-w); right: var(--safe-right); z-index: 2; display: flex; align-items: center; justify-content: center; pointer-events: none; }
.home[data-wide='1'] .home__loader { right: calc(var(--safe-right) + var(--aside-w) + 2 * var(--panel-gap)); }
.home-loader-enter-active, .home-loader-leave-active { transition: opacity .45s ease; }
.home-loader-enter-from, .home-loader-leave-to { opacity: 0; }
/* under the veil, the 3D prepares without showing; it fades in when the veil leaves */
.home__stage > .scene-canvas, .home__stage > .scene-labels { transition: opacity .6s ease; }
.home[data-loading='1'] .home__stage > .scene-canvas, .home[data-loading='1'] .home__stage > .scene-labels { opacity: 0; }
/* what only serves the 3D fades out with it, in its PLACE (nothing moves) and out of reach */
.home__floors, .home__search, .home__controls, .home__toprow > .home__ctl { transition: opacity .45s ease, visibility .45s; }
.home[data-loading='1'] .home__floors, .home[data-loading='1'] .home__search, .home[data-loading='1'] .home__controls,
.home[data-loading='1'] .home__toprow > .home__ctl { opacity: 0; visibility: hidden; }
@media (prefers-reduced-motion: reduce) {
  .home-loader-enter-active, .home-loader-leave-active, .home__stage > .scene-canvas, .home__stage > .scene-labels,
  .home__floors, .home__search, .home__controls, .home__toprow > .home__ctl { transition: none; }
}
.home__weather { position: absolute; left: calc(var(--rail-w) + var(--panel-gap)); bottom: var(--float-bottom); z-index: 2; }
/* Search: at the bottom, in the strip left free BETWEEN the weather card and the view buttons, and
   centered within it. Its results open upward (see SearchBar), so nothing here moves. */
.home__search {
  position: absolute; z-index: 3; bottom: var(--float-bottom);
  left: calc(var(--rail-w) + var(--panel-gap) + var(--wx-w) + var(--panel-gap));
  right: calc(var(--safe-right) + var(--panel-gap) + var(--ctl-span) + var(--panel-gap));
  display: flex; justify-content: center; pointer-events: none;
}
.home__search > * { pointer-events: auto; }
.home[data-wide='1'] .home__search { right: calc(var(--safe-right) + var(--aside-w) + 2 * var(--panel-gap) + 26px + var(--ctl-span) + var(--panel-gap)); }
/* view buttons: rotation, zoom, overview — bottom right, before the panel when it is anchored */
.home__controls { position: absolute; right: calc(var(--safe-right) + var(--panel-gap)); bottom: var(--float-bottom); z-index: 2; display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.home[data-wide='1'] .home__controls { right: calc(var(--safe-right) + var(--aside-w) + 2 * var(--panel-gap) + 26px); }
.home__cluster { display: flex; flex-direction: column; border-radius: 999px; border: 1px solid var(--line); overflow: hidden; background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow); }
.home__ctl { width: var(--ctl-w); height: var(--ctl-w); border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; transition: background .15s, color .15s; }
.home__ctl:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.home__cluster .home__ctl + .home__ctl { border-top: 1px solid var(--line); }
/* Phone: with a finger, dragging rotates and pinching zooms — only the "overview" remains. With a
   mouse in a short window, the two clusters go into a row, otherwise their column rises
   up to the header. `--ctl-span`: the width they occupy, which the search leaves free. */
.home { --ctl-span: var(--ctl-w); }
@media (max-height: 500px) {
  .home { --ctl-span: calc(5 * var(--ctl-w) + 2 * 10px + 6px); }
  .home__controls, .home__cluster { flex-direction: row; }
  .home__cluster .home__ctl + .home__ctl { border-top: 0; border-left: 1px solid var(--line); }
}
@media (pointer: coarse) and (max-width: 599px), (pointer: coarse) and (max-height: 500px) {
  .home { --ctl-span: var(--ctl-w); }
  .home__cluster { display: none; }
}
/* portrait: the level tabs take the row, next to the two pills */
@media (max-width: 599px) {
  .home__floors { flex: 1 1 0; min-width: 0; }
}
/* Phone in portrait: between the weather and the overview, the search only had 160 px. It
   takes the full width flush with the bottom bar, and its list as well as the answer open just
   above it; the weather (as a pill) and the overview go up under the levels
   (`.home__toprow`). With a mouse, the rotation/zoom clusters stay at the bottom, above the
   field. */
@media (max-width: 599px) {
  .home__search { left: calc(var(--rail-w) + var(--panel-gap)); right: calc(var(--safe-right) + var(--panel-gap)); }
  .home__search > * { width: 100%; }
  .home__controls { bottom: calc(var(--float-bottom) + var(--ctl-w) + 10px); }
}
/* the row lets gestures through to the scene between its two elements */
.home__header > .home__toprow { display: flex; justify-content: space-between; align-items: center; padding: 0 var(--page-x); pointer-events: none; }
.home__toprow > * { pointer-events: auto; }
.home__ctl--solo { border-radius: 999px; border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow); color: var(--text); }
</style>
