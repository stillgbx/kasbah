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
import SceneDebug from '../components/home/SceneDebug.vue'
import SearchBar from '../components/home/SearchBar.vue'
import WeatherWidget from '../components/home/WeatherWidget.vue'
import { useHouseScene } from '../composables/useHouseScene'
import type { SearchHit } from '../composables/useSearch'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore, type FloorTab } from '../stores/house'
import { useSettingsStore } from '../stores/settings'

defineOptions({ name: 'HomeView' })

// Vue Maison : la scène 3D prend TOUT l'espace (jusque sous le rail), et le reste flotte dessus :
// en-tête (nom, résumé, onglets de niveau) en haut, boutons de vue (rotation, zoom, vue d'ensemble)
// en bas à droite, panneau contextuel (maison → pièce → appareil) en carte à droite. La sélection
// vit dans le store ; l'URL la reflète.
const house = useHouseStore()
const devices = useDevicesStore()
const settings = useSettingsStore()
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
//
// Pendant le réglage d'un CHAMP de panneaux, la scène ne change plus de sujet : un tap sur l'un de
// ses modules, sur le toit qui le porte ou sur le fond refermait le réglage (la sélection changeait,
// et avec elle le panneau qui l'ouvrait). On est venu déplacer le champ, pas sélectionner autre chose.
const editingModule = (key: string) => {
  const hd = house.index?.devicesById.get(key)
  return !!house.editingArrayId && !!hd && panelOf(hd)?.arrayId === house.editingArrayId
}
scene.onDeviceTap((key) => {
  if (editingModule(key)) return
  // même garde-fou que le fond et les pièces : un appareil tapé pendant le réglage d'une ouverture
  // (un volet, un capteur posé juste à côté) ne doit pas fermer le panneau par surprise
  if (house.selectedOpeningId) return
  house.selectDevice(key); panelOpen.value = true
})
// mode édition : une ouverture touchée s'ouvre comme un appareil ; le glissement pose le brouillon
// (aperçu 3D immédiat, cf. `withOpeningDraft`), le dépôt l'écrit dans house.json.
scene.onOpeningTap((openingId) => { house.selectOpening(openingId); panelOpen.value = true })
scene.onOpeningDrag((_openingId, xy) => house.previewOpeningAt(xy))
scene.onOpeningDrop(() => { void house.dropOpening() })
// mode « poser » : une nature armée dans le panneau de la pièce attend le mur. Le tap rapporte le
// point touché ; c'est le store qui en déduit le mur et la place, comme pour un glissement.
scene.onPlaceTap((xy) => { void house.placeOpeningAt(xy) })
watch(() => house.placingOpening, (armed) => scene.setPlacingOpening(armed?.roomId ?? null))
scene.onRoomTap((roomId) => {
  // pendant le réglage d'une ouverture, un tap sur une pièce ne referme pas le panneau par surprise
  // (même garde-fou que le réglage d'un champ de panneaux, juste au-dessus)
  if (house.selectedOpeningId) return
  if (house.selectedRoomId === roomId && !house.selectedKey) { house.selectRoom(null); scene.highlightRoom(null) }
  else { house.selectRoom(roomId); panelOpen.value = true }
})
scene.onZoneTap((zoneId) => { house.selectRoom(zoneId); panelOpen.value = true })
// Tap sur le toit : il porte un niveau (caméra, panneaux) mais aucune pièce. On SÉLECTIONNE ce
// niveau — onglet, panneau de ses appareils et cadrage sur la dalle — au lieu de laisser le rayon
// traverser jusqu'à la pièce cachée dessous, ce qui faisait disparaître le toit au profit de
// l'étage. Déjà dessus, le tap ressort, comme un second tap sur une pièce.
scene.onLevelTap((levelId) => {
  if (house.editingArrayId) return
  if (house.selectedLevelId === levelId) house.backToHome()
  else { house.selectLevel(levelId); panelOpen.value = true }
})
scene.onBackgroundTap(() => {
  // armé pour poser une ouverture, taper à côté du bâti est un renoncement : on désarme, sans toucher
  // à la sélection — la pièce reste ouverte, prête pour un autre essai
  if (house.placingOpening) { house.cancelPlacingOpening(); return }
  if (!house.editingArrayId && !house.selectedOpeningId) house.clearSelection()
})
// une épingle du journal touchée : elle devient l'incident actif (étiquette dans la scène, ligne surlignée dans le panneau)
scene.onJournalTap((at) => house.markJournalPoint(at))

// Le fil d'Ariane remonte d'un cran (appareil → pièce → niveau → maison) ; arrivé à « Maison », il
// fait ce que fait l'onglet « Tout » : le mot promet la maison entière, pas le niveau qu'on
// regardait encore. Sans cela, revenir à « Maison » depuis le 1er laissait la vue sur le 1er.
function backToAll() { if (!house.selectedRoomId && !house.selectedLevelId) onTab('all') }
// Le retour d'un module de champ atterrit sur son INSTALLATION : il y a donc encore un appareil
// sélectionné, et « Tout » ne doit pas l'effacer — c'est ce qui renvoyait à « Maison » d'un coup.
function onDeviceBack() { house.backFromDevice(); if (!house.selectedKey) backToAll() }
function onRoomBack() { house.backFromRoom(); backToAll() }
/** Retour depuis une ouverture : sa PIÈCE, jamais la maison — c'est elle qui la porte. */
function onOpeningBack() { house.selectOpening(null) }

// store → scène. Le cadrage suit la sélection la PLUS FINE : un appareil se cadre sur lui-même, pas
// sur sa pièce — sinon un plafonnier de grand séjour restait un point dans un coin de l'écran.
function frameSelection(roomId: string | null, key: string | null) {
  const zone = !!roomId && !!house.index?.zonesById.has(roomId)
  if (key) { scene.highlightRoom(zone ? null : roomId); scene.focusDevice(key); return }
  if (!roomId) { scene.highlightRoom(null); return }
  if (zone) scene.focusZone(roomId)
  else scene.focusRoom(roomId)
  // Le réglage d'une ouverture cadre sa PIÈCE (fil d'Ariane, `house.selectOpening`) mais ne doit pas
  // mettre son sol en évidence : à côté du voile d'accent et du trait sur tout le contour, la
  // poignée de l'ouverture ne pèse rien. `focusRoom`, ci-dessus, allume la surbrillance en interne
  // (`HouseScene.focusRoom`) — on l'éteint tout de suite après, sans repasser par la caméra.
  if (house.selectedOpeningId) scene.highlightRoom(null)
}
// mode édition des ouvertures : armé depuis Réglages (jamais un bouton flottant dans la scène), suivi
// par la sélection d'ouverture — sélectionner l'ouvre dans la scène, revenir à la pièce la referme.
// PAS `immediate` ici : au premier rendu la scène n'existe pas encore (elle se construit dans le
// `onMounted` de `useHouseScene`), et l'appel serait un no-op — c'est le watcher de `scene.ready`,
// plus bas, qui rejoue l'état au bon moment (mode armé au chargement, tablette qui redémarre).
watch(() => settings.houseEditing, (on) => {
  scene.setEditingOpenings(on)
  if (!on) house.cancelPlacingOpening()
  // désarmer ferme aussi le réglage en cours : sinon le panneau reste ouvert et ACTIF (« + » écrit
  // encore dans house.json) alors que la scène, elle, n'a plus rien de sélectionné — l'interrupteur
  // ne fermerait pas la porte qu'il prétend fermer
  if (!on && house.selectedOpeningId) house.selectOpening(null)
})
watch(() => house.selectedOpeningId, (id) => {
  scene.setSelectedOpening(id)
  if (id) {
    scene.focusOpening(id)
    // pas de surbrillance de pièce pendant le réglage — voir `frameSelection`. Nécessaire même ici,
    // en plus du garde-fou de `frameSelection` : si la pièce était DÉJÀ sélectionnée (on touche une
    // ouverture de la pièce qu'on regarde déjà), `selectedRoomId` ne change pas et le watcher
    // roomId/key ne se redéclenche pas — sans cette ligne le sol resterait allumé.
    scene.highlightRoom(null)
  } else if (house.selectedRoomId && !house.selectedKey && !house.index?.zonesById.has(house.selectedRoomId)) {
    // sortie : la piège symétrique — revenir à la pièce (même id, donc même silence du watcher
    // roomId/key) doit RALLUMER la surbrillance qu'on vient d'éteindre.
    scene.highlightRoom(house.selectedRoomId)
  }
})
watch(() => house.focusedLevelId, (id) => scene.focusLevel(id))
// un niveau sélectionné se cadre comme une pièce sélectionnée : c'est lui qu'on est venu voir
watch(() => house.selectedLevelId, (id) => { if (id) scene.focusLevelView(id) })
watch([() => house.selectedRoomId, () => house.selectedKey], ([roomId, key]) => {
  scene.setSelected(key)
  frameSelection(roomId, key)
})
watch(scene.ready, (ready) => {
  if (!ready) return
  scene.setEditingOpenings(settings.houseEditing)
  scene.focusLevel(house.focusedLevelId)
  scene.setSelected(house.selectedKey)
  frameSelection(house.selectedRoomId, house.selectedKey)
}, { immediate: true })

// mode « déplacer » : glissement 3D → brouillon (store) → aperçu 3D ; dépôt → écriture house.json.
// Un champ de panneaux se règle de la même façon, sauf qu'on attrape n'importe lequel de ses modules
// et que c'est le champ entier qui suit (`previewArrayOrigin`).
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
  // un appareil non placé n'a pas de marqueur à déplacer
  const to = d?.position ?? (hd && isPlaced(hd) ? hd.position : undefined)
  if (house.placing && hd && to) scene.moveMarker(hd.id, to)
})
// régler un champ, c'est venir voir le niveau qui le porte : on le cadre comme le ferait son onglet,
// sinon la caméra restait sur la pièce qu'on regardait et le toit s'affichait hors champ
watch(() => house.editingArray?.levelId, (id) => { if (id) scene.focusLevelView(id) })
// case de la grille survolée : son module s'allume dans la scène, et rend la main à la sélection
watch(() => house.hoveredKey, (key) => scene.setSelected(key ?? house.selectedKey))
// aperçu de la teinte choisie : la carrosserie suit le sélecteur, sans rien écrire (cf. `VehicleTuning`)
watch(() => house.bodyColorPreview, (p) => { if (p) scene.previewBodyColor(p.key, p.color) })
// le journal déplié dans le panneau pose ses incidents sur le terrain ; une ligne choisie cadre la caméra dessus
watch(() => house.journalOverlay, (j) => scene.setJournalPoints(j?.key ?? null, j?.points ?? []))
watch(() => house.journalFocus, (f) => { if (f) scene.focusJournalPoint(f.at) })
watch(() => house.journalActive, (at) => scene.setActiveJournalPoint(at))
// aperçu du champ glissé : tous ses modules suivent l'origine du brouillon
watch(() => house.arrayDraft, () => {
  for (const m of house.editingArrayModules) if (isPlaced(m)) scene.moveMarker(m.id, m.position)
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

// En mode édition, une PIÈCE (pas une zone du jardin, qui n'a pas de mur) montre ce qu'on peut
// modifier d'elle à la place de ses appareils : on relève la maison, on ne l'allume pas.
const panelMode = computed<'opening' | 'device' | 'roomEdit' | 'room' | 'level' | 'home'>(() => {
  if (house.selectedOpeningId) return 'opening'
  if (house.selectedKey) return 'device'
  if (house.selectedRoomId) return settings.houseEditing && house.selectedRoom ? 'roomEdit' : 'room'
  return house.selectedLevelId ? 'level' : 'home'
})

// Le panneau ancré couvre le bord droit de la scène : le cadrage vise la partie libre (largeur du
// panneau et ses deux marges, lues dans les jetons).
const cssPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0
const asideInset = () => cssPx('--aside-w') + 2 * cssPx('--panel-gap')
watch([wide, scene.ready], ([w, ready]) => { if (ready) scene.setViewInset(w ? asideInset() : 0) }, { immediate: true })

// Un résultat de recherche a déjà déplacé la sélection ; reste à montrer le panneau qui la porte,
// que le tiroir cache tant qu'on n'est pas en fenêtre large. Une PAGE, elle, quitte la vue : lui
// ouvrir le tiroir le ferait trouver ouvert au retour, sans qu'on l'ait demandé.
function onSearchPicked(hit: SearchHit) { if (hit.family !== 'page') panelOpen.value = true }

/** Un cran de rotation des boutons de vue : un huitième de tour. */
const ORBIT_STEP = Math.PI / 4
/** Un cran de zoom des boutons de vue. */
const DOLLY_STEP = 1.35
</script>

<template>
  <div class="home" :data-wide="wide ? '1' : '0'">
    <div class="home__stage">
      <canvas ref="canvas" class="scene-canvas" tabindex="0" />
      <div ref="labelLayer" class="scene-labels" />
      <div class="home__vignette" />
      <SceneDebug v-if="settings.sceneDebug" :scene="scene.controller" />
    </div>
    <div class="home__header">
      <PageHeader>
        <Segmented :model-value="house.floorTab" :options="floorTabs" @update:model-value="onTab" />
        <button v-if="!wide" type="button" class="pill" :data-on="panelOpen ? '1' : '0'" :aria-label="$t('home.openPanel')" @click="panelOpen = !panelOpen">
          <StrokeIcon name="list" :size="18" />
        </button>
      </PageHeader>
    </div>
    <div v-if="!scene.supported.value" class="home__fallback card">{{ $t('scene.webglUnavailable') }}</div>
    <div v-if="house.loading" class="home__loading muted">{{ $t('common.loading') }}</div>
    <WeatherWidget class="home__weather" />
    <div class="home__controls">
      <div class="home__cluster">
        <button type="button" class="home__ctl" :title="$t('home.rotateLeft')" :aria-label="$t('home.rotateLeft')" @click="scene.orbitBy(-ORBIT_STEP)"><StrokeIcon name="rotateLeft" :size="18" /></button>
        <button type="button" class="home__ctl" :title="$t('home.rotateRight')" :aria-label="$t('home.rotateRight')" @click="scene.orbitBy(ORBIT_STEP)"><StrokeIcon name="rotateRight" :size="18" /></button>
      </div>
      <div class="home__cluster">
        <button type="button" class="home__ctl" :title="$t('home.zoomIn')" :aria-label="$t('home.zoomIn')" @click="scene.dollyBy(1 / DOLLY_STEP)"><StrokeIcon name="plus" :size="18" /></button>
        <button type="button" class="home__ctl" :title="$t('home.zoomOut')" :aria-label="$t('home.zoomOut')" @click="scene.dollyBy(DOLLY_STEP)"><StrokeIcon name="minus" :size="18" /></button>
      </div>
      <button type="button" class="home__ctl home__ctl--solo" :title="$t('home.resetView')" :aria-label="$t('home.resetView')" @click="onTab('all')"><StrokeIcon name="home" :size="18" /></button>
    </div>
    <div class="home__search">
      <SearchBar @picked="onSearchPicked" />
    </div>
    <SidePanel :open="panelOpen" :docked="wide" @close="panelOpen = false">
      <OpeningPanel v-if="panelMode === 'opening'" @back="onOpeningBack()" />
      <DevicePanel v-else-if="panelMode === 'device'" @back="onDeviceBack()" />
      <RoomEditPanel v-else-if="panelMode === 'roomEdit'" @back="onRoomBack()" />
      <RoomPanel v-else-if="panelMode === 'room' || panelMode === 'level'" @back="onRoomBack()" />
      <HomePanel v-else />
    </SidePanel>
  </div>
</template>

<style scoped>
/* La vue déborde sous le rail (marge négative de sa largeur, que `.app-main` réserve en padding) :
   la scène couvre toute la fenêtre, et ce qui flotte dessus se décale du rail à gauche. */
.home { position: relative; height: 100%; margin-left: calc(-1 * var(--rail-w)); min-height: 0; }
.home__stage { position: absolute; inset: 0; }
/* assombrit les bords la nuit, comme une vignette : le regard va au centre, où la maison est */
.home__vignette { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
:global(html[data-theme='dark']) .home__vignette { background: radial-gradient(ellipse 70% 65% at 50% 45%, transparent 55%, rgba(0, 0, 0, .45) 100%); }
.home__header { position: absolute; top: 0; left: var(--rail-w); right: 0; z-index: 2; pointer-events: none; }
.home__header > * { pointer-events: auto; }
.home[data-wide='1'] .home__header { right: calc(var(--safe-right) + var(--aside-w) + 2 * var(--panel-gap)); }
.home__fallback { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 16px 20px; z-index: 2; }
/* au-dessus du widget météo, qui tient le coin bas gauche */
.home__loading { position: absolute; left: calc(var(--rail-w) + 24px); bottom: calc(var(--safe-bottom) + var(--panel-gap) + 144px); font-size: 13px; z-index: 2; }
.home__weather { position: absolute; left: calc(var(--rail-w) + var(--panel-gap)); bottom: calc(var(--safe-bottom) + var(--panel-gap)); z-index: 2; }
/* Recherche : en bas, dans la bande laissée libre ENTRE la carte météo et les boutons de vue, et
   centrée dedans. Ses résultats s'ouvrent vers le haut (voir SearchBar), donc rien ici ne bouge. */
.home__search {
  position: absolute; z-index: 3; bottom: calc(var(--safe-bottom) + var(--panel-gap));
  left: calc(var(--rail-w) + var(--panel-gap) + var(--wx-w) + var(--panel-gap));
  right: calc(var(--safe-right) + var(--panel-gap) + var(--ctl-w) + var(--panel-gap));
  display: flex; justify-content: center; pointer-events: none;
}
.home__search > * { pointer-events: auto; }
.home[data-wide='1'] .home__search { right: calc(var(--safe-right) + var(--aside-w) + 2 * var(--panel-gap) + 26px + var(--ctl-w) + var(--panel-gap)); }
/* boutons de vue : rotation, zoom, vue d'ensemble — en bas à droite, avant le panneau quand il est ancré */
.home__controls { position: absolute; right: calc(var(--safe-right) + var(--panel-gap)); bottom: calc(var(--safe-bottom) + var(--panel-gap)); z-index: 2; display: flex; flex-direction: column; align-items: stretch; gap: 10px; }
.home[data-wide='1'] .home__controls { right: calc(var(--safe-right) + var(--aside-w) + 2 * var(--panel-gap) + 26px); }
.home__cluster { display: flex; flex-direction: column; border-radius: 999px; border: 1px solid var(--line); overflow: hidden; background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow); }
.home__ctl { width: var(--ctl-w); height: var(--ctl-w); border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; transition: background .15s, color .15s; }
.home__ctl:hover { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.home__cluster .home__ctl + .home__ctl { border-top: 1px solid var(--line); }
.home__ctl--solo { border-radius: 999px; border: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow); color: var(--text); }
</style>
