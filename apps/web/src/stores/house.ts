import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { autoPlaceDevices, indexHouse, type DevicePlacement, type House, type HouseDevice, type HouseIndex, type Level, type PlaceableDevice, type Room, type Vec3, type Zone } from '@kasbah/shared'
import { getTransport } from '../api'
import { t } from '../i18n'
import { useDevicesStore } from './devices'
import { useNotificationsStore } from './notifications'

// Maison (immuable : `shallowRef`, ré-indexée quand l'objet change) + sélection courante :
// niveau focalisé (ou jardin, ou tout), pièce/zone, appareil. Partagée par la scène, les panneaux et l'URL.
// `effective` = maison du JSON + appareils de plugin auto-placés (voir `autoPlaceDevices`) : c'est
// elle qu'on indexe et qu'on donne à la scène 3D, jamais `house` seule.

export type FloorTab = 'garden' | 'all' | string
type Mount = NonNullable<HouseDevice['mount']>
/** Placement en cours d'édition (aperçu 3D), pas encore écrit dans house.json. */
export interface PlacementDraft { position: Vec3; roomId: string | undefined }

/** Arrondi au 5 cm : garde un JSON lisible. */
const snap = (v: number) => Math.round(v * 20) / 20

export const useHouseStore = defineStore('house', () => {
  const devices = useDevicesStore()
  const house = shallowRef<House | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Appareils remontés par les plugins, dans la forme attendue par l'auto-placement. */
  const placeable = computed<PlaceableDevice[]>(() =>
    Object.values(devices.descriptors).map((d) => ({ id: d.id, kind: d.kind, room: d.meta.room })),
  )
  const placement = computed(() => {
    if (!house.value) return null
    return autoPlaceDevices(house.value, placeable.value, indexHouse(house.value))
  })
  const effective = computed<House | null>(() => {
    const h = house.value
    const placed = placement.value?.placed ?? []
    if (!h || placed.length === 0) return h
    return { ...h, devices: [...h.devices, ...placed] }
  })

  const index = computed<HouseIndex | null>(() => (effective.value ? indexHouse(effective.value) : null))
  const levels = computed<Level[]>(() => index.value?.levelsSorted ?? [])
  const zones = computed<Zone[]>(() => house.value?.site.zones ?? [])

  /** null = toute la maison (ou le jardin si `gardenFocus`). */
  const focusedLevelId = ref<string | null>(null)
  const gardenFocus = ref(false)
  /** Pièce ou zone sélectionnée. */
  const selectedRoomId = ref<string | null>(null)
  /** Id d'appareil de la MAISON (HouseDevice.id), ou id de plugin pour un appareil non placé. */
  const selectedKey = ref<string | null>(null)

  const floorTab = computed<FloorTab>(() => (focusedLevelId.value ?? (gardenFocus.value ? 'garden' : 'all')))
  const selectedRoom = computed<Room | null>(() => (selectedRoomId.value ? index.value?.roomsById.get(selectedRoomId.value) ?? null : null))
  const selectedZone = computed<Zone | null>(() => (selectedRoomId.value ? index.value?.zonesById.get(selectedRoomId.value) ?? null : null))
  const selectedDevice = computed<HouseDevice | null>(() => (selectedKey.value ? index.value?.devicesById.get(selectedKey.value) ?? null : null))

  async function load() {
    loading.value = true
    error.value = null
    try { house.value = await getTransport().getHouse() }
    catch (err) { error.value = (err as Error).message }
    finally { loading.value = false }
  }
  // une autre tablette a déplacé un appareil : le serveur pousse la maison réécrite
  watch(() => devices.serverHouse, (h) => { if (h) house.value = h })

  function setFloorTab(tab: FloorTab) {
    gardenFocus.value = tab === 'garden'
    focusedLevelId.value = tab === 'garden' || tab === 'all' ? null : tab
    if (selectedRoomId.value) {
      const room = index.value?.roomsById.get(selectedRoomId.value)
      const zone = index.value?.zonesById.get(selectedRoomId.value)
      if ((room && room.levelId !== focusedLevelId.value) || (zone && tab !== 'garden')) selectedRoomId.value = null
    }
    if (tab === 'garden' || tab === 'all') selectedKey.value = null
  }

  function focusLevel(levelId: string | null) { setFloorTab(levelId ?? 'all') }

  function selectRoom(roomId: string | null) {
    selectedKey.value = null
    if (!roomId) { selectedRoomId.value = null; return }
    const room = index.value?.roomsById.get(roomId)
    if (room) { gardenFocus.value = false; focusedLevelId.value = room.levelId }
    else if (index.value?.zonesById.has(roomId)) { gardenFocus.value = true; focusedLevelId.value = null }
    selectedRoomId.value = roomId
  }

  function selectDevice(key: string | null) {
    selectedKey.value = key
    if (!key) return
    const hd = index.value?.devicesById.get(key)
    if (!hd) return
    if (hd.roomId) {
      selectedRoomId.value = hd.roomId
      const room = index.value?.roomsById.get(hd.roomId)
      if (room) { focusedLevelId.value = room.levelId; gardenFocus.value = false }
    } else if (hd.levelId) { focusedLevelId.value = hd.levelId; gardenFocus.value = false }
    else if (hd.zoneId) { selectedRoomId.value = hd.zoneId; gardenFocus.value = true; focusedLevelId.value = null }
  }

  function clearSelection() { selectedKey.value = null }
  function backToHome() { selectedKey.value = null; selectedRoomId.value = null }

  /** Appareil maison lié à un id de plugin. */
  function houseDeviceFor(pluginDeviceId: string): HouseDevice | undefined {
    return index.value?.devicesByBinding.get(pluginDeviceId)
  }

  // ---- mode « déplacer » : l'appareil sélectionné se glisse dans la 3D (x;y) et se règle en
  // hauteur depuis le panneau ; chaque dépôt est écrit dans house.json par le serveur. -------------
  const placing = ref(false)
  const saving = ref(false)
  const draft = shallowRef<PlacementDraft | null>(null)
  /** Placement à l'entrée dans le mode, pour « Rétablir ». */
  const placingOrigin = shallowRef<{ position: Vec3; roomId: string | undefined; mount: Mount | undefined } | null>(null)

  function startPlacing() {
    const hd = selectedDevice.value
    if (!hd) return
    placingOrigin.value = { position: hd.position, roomId: hd.roomId, mount: hd.mount }
    draft.value = null
    placing.value = true
  }
  function stopPlacing() { placing.value = false; draft.value = null; placingOrigin.value = null }
  watch(selectedKey, stopPlacing)

  /** Aperçu d'une position au sol (glissement 3D) ; `roomId` null = hors de toute pièce → on garde l'ancienne. */
  function previewPosition(xy: [number, number], roomId: string | null) {
    const hd = selectedDevice.value
    if (!hd || !placing.value) return
    const z = draft.value?.position[2] ?? hd.position[2]
    draft.value = { position: [snap(xy[0]), snap(xy[1]), z], roomId: roomId ?? draft.value?.roomId ?? hd.roomId }
  }
  function previewHeight(z: number) {
    const hd = selectedDevice.value
    if (!hd || !placing.value) return
    const base = draft.value ?? { position: hd.position, roomId: hd.roomId }
    draft.value = { position: [base.position[0], base.position[1], snap(z)], roomId: base.roomId }
  }

  /** Écrit le brouillon (complété par `override`) dans house.json ; un appareil auto-placé y gagne son entrée. */
  async function savePlacement(override?: { position?: Vec3; mount?: Mount }): Promise<boolean> {
    const hd = selectedDevice.value
    if (!hd) return false
    const base = draft.value ?? { position: hd.position, roomId: hd.roomId }
    const p: DevicePlacement = { position: override?.position ?? base.position }
    if (base.roomId && base.roomId !== hd.roomId) p.roomId = base.roomId
    if (override?.mount) p.mount = override.mount
    if (hd.meta?.autoPlaced && hd.deviceId) {
      p.deviceId = hd.deviceId
      if (base.roomId) p.roomId = base.roomId
      if (!p.mount && hd.mount) p.mount = hd.mount
    }
    saving.value = true
    try {
      house.value = await getTransport().placeDevice(hd.id, p)
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    } finally {
      draft.value = null
      saving.value = false
    }
  }

  const canRevert = computed(() => {
    const o = placingOrigin.value, hd = selectedDevice.value
    return !!o && !!hd && (o.position.join() !== hd.position.join() || o.mount !== hd.mount || o.roomId !== hd.roomId)
  })
  async function revertPlacement() {
    const o = placingOrigin.value
    if (!o) return
    draft.value = { position: o.position, roomId: o.roomId }
    await savePlacement(o.mount ? { mount: o.mount } : undefined)
  }

  return {
    house, effective, loading, error, index, levels, zones,
    focusedLevelId, gardenFocus, selectedRoomId, selectedKey, floorTab, selectedRoom, selectedZone, selectedDevice,
    load, setFloorTab, focusLevel, selectRoom, selectDevice, clearSelection, backToHome, houseDeviceFor,
    placing, saving, draft, canRevert, startPlacing, stopPlacing, previewPosition, previewHeight, savePlacement, revertPlacement,
  }
})
