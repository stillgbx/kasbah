import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { autoPlaceDevices, indexHouse, type DeviceEntry, type DevicePlacement, type House, type HouseDevice, type HouseIndex, type Level, type PlaceableDevice, type Room, type Vec2, type Vec3, type Zone } from '@kasbah/shared'
import { getTransport } from '../api'
import { t } from '../i18n'
import { soundRouting } from '../lib/audioRouting'
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
  /**
   * Appareil PROVISOIRE : un appareil de plugin sans aucune entrée (ni JSON, ni auto-placement) que
   * l'utilisateur est en train de poser depuis une liste. Il vit ici le temps du geste, dessiné dans
   * la scène comme les autres ; son premier dépôt crée l'entrée dans house.json (`savePlacement`),
   * « Terminé » sans dépôt l'abandonne. Même id qu'aurait donné l'auto-placement : à l'écriture, la
   * maison relue le remplace sans que la sélection change.
   */
  const provisional = shallowRef<HouseDevice | null>(null)
  const effective = computed<House | null>(() => {
    const h = house.value
    const placed = placement.value?.placed ?? []
    const extra = provisional.value && !h?.devices.some((d) => d.id === provisional.value!.id) ? [provisional.value] : []
    if (!h || (placed.length === 0 && extra.length === 0)) return h
    return { ...h, devices: [...h.devices, ...placed, ...extra] }
  })

  const index = computed<HouseIndex | null>(() => (effective.value ? indexHouse(effective.value) : null))
  /** Qui joue le son de qui en ce moment (liens `meta.audioOutput` du JSON × états) — voir `lib/audioRouting.ts`. */
  const soundRoutes = computed(() => soundRouting(effective.value?.devices ?? [], devices.states))
  /** Lecteur dont cet appareil RELAIE le son (barre de son d'une TV qui joue), avec son nom d'affichage ; sinon `undefined`. */
  function relaySource(pluginDeviceId: string): (DeviceEntry & { name: string }) | undefined {
    const src = soundRoutes.value.relays.get(pluginDeviceId)
    const descriptor = src ? devices.descriptors[src] : undefined
    const state = src ? devices.states[src] : undefined
    if (!descriptor || !state) return undefined
    return { descriptor, state, name: index.value?.devicesByBinding.get(descriptor.id)?.name ?? descriptor.name }
  }
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

  /**
   * Ordre d'affichage des pièces d'un niveau (glisser-déposer de la vue Lumières). Appliqué tout de
   * suite (le geste vient de se terminer), confirmé par la maison que le serveur réécrit et diffuse.
   */
  async function setRoomOrder(levelId: string, roomIds: string[]): Promise<void> {
    const prev = house.value
    if (!prev) return
    house.value = { ...prev, levels: prev.levels.map((l) => (l.id === levelId ? { ...l, roomOrder: roomIds } : l)) }
    try { house.value = await getTransport().setRoomOrder(levelId, roomIds) }
    catch (err) {
      house.value = prev
      useNotificationsStore().error(t('rooms.orderError', { message: (err as Error).message }))
    }
  }

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
  const placingOrigin = shallowRef<{ position: Vec3; roomId: string | undefined; mount: Mount | undefined; yaw: number | undefined } | null>(null)

  function startPlacing() {
    const hd = selectedDevice.value
    if (!hd) return
    placingOrigin.value = { position: hd.position, roomId: hd.roomId, mount: hd.mount, yaw: hd.yaw }
    draft.value = null
    placing.value = true
  }
  function stopPlacing() {
    placing.value = false
    draft.value = null
    placingOrigin.value = null
    // un provisoire jamais déposé disparaît avec le mode
    if (provisional.value && !house.value?.devices.some((d) => d.id === provisional.value!.id)) {
      // le panneau reste sur l'appareil de plugin (non placé), qui propose « Placer » à nouveau
      if (selectedKey.value === provisional.value.id) selectedKey.value = provisional.value.deviceId ?? null
      provisional.value = null
    }
  }
  watch(selectedKey, (key) => { if (key !== provisional.value?.id) stopPlacing() })

  /** Centre approximatif d'un niveau : milieu de la boîte englobante de ses pièces (ou de son contour). */
  function levelCentre(levelId: string): [number, number] {
    const idx = index.value
    const pts: Vec2[] = (idx?.roomsByLevel.get(levelId) ?? []).flatMap((r) => r.polygon)
    const outline = idx?.levelsById.get(levelId)?.outline
    const all = pts.length ? pts : outline ?? []
    if (!all.length) return [0, 0]
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
    return [snap((Math.min(...xs) + Math.max(...xs)) / 2), snap((Math.min(...ys) + Math.max(...ys)) / 2)]
  }

  /**
   * Pose un appareil de plugin qui n'a encore aucune entrée : provisoire au centre du niveau affiché
   * (ou du premier), à hauteur de table, sélectionné, mode « déplacer » ouvert. Le niveau se change
   * ensuite par les onglets, tant que rien n'est déposé.
   */
  /** Placement demandé avant que la maison ou l'inventaire soient là : rejoué dès qu'ils arrivent. */
  const pendingNew = ref<string | null>(null)
  watch([house, () => devices.descriptors], () => {
    if (pendingNew.value && startPlacingNew(pendingNew.value)) pendingNew.value = null
  })

  function startPlacingNew(pluginDeviceId: string): boolean {
    const d = devices.descriptors[pluginDeviceId]
    const levelId = focusedLevelId.value ?? levels.value[0]?.id
    if (!d || !house.value || !levelId) { pendingNew.value = pluginDeviceId; return false }
    const id = `auto.${pluginDeviceId.replace(/[^a-z0-9_.-]+/gi, '-')}`
    const [x, y] = levelCentre(levelId)
    provisional.value = { id, deviceId: pluginDeviceId, kind: d.kind, position: [x, y, 0.75], levelId, mount: 'free', meta: { autoPlaced: true, provisional: true } }
    focusedLevelId.value = levelId
    gardenFocus.value = false
    selectedRoomId.value = null
    selectedKey.value = id
    placingOrigin.value = null
    draft.value = null
    placing.value = true
    return true
  }
  // tant que le provisoire n'est pas déposé, l'onglet de niveau le déplace au centre du niveau choisi
  watch(focusedLevelId, (levelId) => {
    const p = provisional.value
    if (!p || !placing.value || !levelId || levelId === p.levelId) return
    const [x, y] = levelCentre(levelId)
    provisional.value = { ...p, levelId, position: [x, y, p.position[2]] }
    draft.value = null
  })

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
  async function savePlacement(override?: { position?: Vec3; mount?: Mount; yaw?: number }): Promise<boolean> {
    const hd = selectedDevice.value
    if (!hd) return false
    const base = draft.value ?? { position: hd.position, roomId: hd.roomId }
    const p: DevicePlacement = { position: override?.position ?? base.position }
    if (base.roomId && base.roomId !== hd.roomId) p.roomId = base.roomId
    if (override?.mount) p.mount = override.mount
    if (override?.yaw !== undefined) p.yaw = override.yaw
    if (hd.meta?.autoPlaced && hd.deviceId) {
      p.deviceId = hd.deviceId
      if (base.roomId) p.roomId = base.roomId
      else if (hd.meta.provisional && hd.levelId) p.levelId = hd.levelId   // déposé hors de toute pièce : le niveau ancre
      if (!p.mount && hd.mount) p.mount = hd.mount
    }
    saving.value = true
    try {
      house.value = await getTransport().placeDevice(hd.id, p)
      if (provisional.value?.id === hd.id) provisional.value = null       // l'entrée existe désormais dans la maison relue
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    } finally {
      draft.value = null
      saving.value = false
    }
  }

  /** Appareil sélectionné encore provisoire (jamais déposé) : « Annuler » plutôt que « Terminé », rien à retirer. */
  const isProvisional = computed(() => !!selectedDevice.value && selectedDevice.value.id === provisional.value?.id)

  /**
   * Sort l'appareil sélectionné de la maison : son entrée est retirée du JSON, il redevient auto-placé
   * ou « non placé » et la sélection suit l'appareil de plugin (le panneau reste ouvert sur lui).
   * Un provisoire jamais déposé est simplement abandonné.
   */
  async function removePlacement(): Promise<boolean> {
    const hd = selectedDevice.value
    if (!hd) return false
    if (isProvisional.value) { stopPlacing(); return true }
    saving.value = true
    try {
      house.value = await getTransport().removeDevice(hd.id)
      placing.value = false
      draft.value = null
      placingOrigin.value = null
      selectedKey.value = hd.deviceId ?? null
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    } finally {
      saving.value = false
    }
  }

  const canRevert = computed(() => {
    const o = placingOrigin.value, hd = selectedDevice.value
    return !!o && !!hd && (o.position.join() !== hd.position.join() || o.mount !== hd.mount || o.roomId !== hd.roomId || o.yaw !== hd.yaw)
  })
  async function revertPlacement() {
    const o = placingOrigin.value, hd = selectedDevice.value
    if (!o || !hd) return
    draft.value = { position: o.position, roomId: o.roomId }
    // une orientation absente à l'entrée ne peut pas être effacée du JSON : on la ramène à 0, qui vaut pareil
    await savePlacement({ ...(o.mount ? { mount: o.mount } : {}), ...(o.yaw !== hd.yaw ? { yaw: o.yaw ?? 0 } : {}) })
  }

  return {
    house, effective, loading, error, index, levels, zones, soundRoutes, relaySource,
    focusedLevelId, gardenFocus, selectedRoomId, selectedKey, floorTab, selectedRoom, selectedZone, selectedDevice,
    load, setFloorTab, focusLevel, selectRoom, selectDevice, clearSelection, backToHome, houseDeviceFor, setRoomOrder,
    placing, saving, draft, canRevert, isProvisional, startPlacing, startPlacingNew, stopPlacing, previewPosition, previewHeight, savePlacement, revertPlacement, removePlacement,
  }
})
