import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import { autoPlaceDevices, computeRoof, fitHeight, houseIdForDevice, indexHouse, isPlaced, newOpeningDims, openingLimits, openingSill, panelArrayDevices, panelOf, pointInPolygon, resolveDefaults, resolveDeviceLevelId, roomHeight, slotFromPoint, withPanelArrays, type DeviceDescriptor, type DeviceEntry, type DevicePlacement, type House, type HouseDevice, type HouseIndex, type Level, type Opening, type OpeningPatch, type OpeningType, type PanelArray, type PanelArrayPatch, type PlaceableDevice, type PlacedHouseDevice, type Room, type Vec2, type Vec3, type Zone } from '@kasbah/shared'
import { getTransport } from '../api'
import type { JournalPoint } from '../lib/journal'
import { i18n, t } from '../i18n'
import { soundRouting } from '../lib/audioRouting'
import { findEnergySite } from '../lib/energy'
import { coverLeaves, defaultCoverSize } from '../lib/orientation'
import { expectsOpening } from '../lib/cover'
import { useDevicesStore } from './devices'
import { useNotificationsStore } from './notifications'

// Maison (immuable : `shallowRef`, ré-indexée quand l'objet change) + sélection courante :
// niveau focalisé (ou jardin, ou tout), pièce/zone, appareil. Partagée par la scène, les panneaux et l'URL.
// `effective` = maison du JSON + appareils de plugin auto-placés (voir `autoPlaceDevices`) : c'est
// elle qu'on indexe et qu'on donne à la scène 3D, jamais `house` seule.

export type FloorTab = 'garden' | 'all' | string
type Mount = NonNullable<HouseDevice['mount']>
type Size = NonNullable<HouseDevice['size']>
type Leaves = NonNullable<HouseDevice['leaves']>
/** Placement en cours d'édition (aperçu 3D), pas encore écrit dans house.json. */
export interface PlacementDraft { position: Vec3; roomId: string | undefined }

/** Deux encombrements identiques (absents des deux côtés compris) : sert au bouton « Rétablir ». */
const sameSize = (a: Size | undefined, b: Size | undefined) => a?.width === b?.width && a?.height === b?.height

/** Arrondi au 5 cm : garde un JSON lisible. */
const snap = (v: number) => Math.round(v * 20) / 20
/** Arrondi au centimètre : la cote d'une ouverture se relève au mètre ruban, pas au pas de 5 cm. */
const snapCm = (v: number) => Math.round(v * 100) / 100

/** L'ouverture `id` et la pièce qui la porte, dans une maison donnée. */
function findOpening(h: House | null, id: string | null): { room: Room; opening: Opening } | null {
  if (!h || !id) return null
  for (const room of h.rooms) {
    const opening = room.openings.find((o) => o.id === id)
    if (opening) return { room, opening }
  }
  return null
}

/**
 * Maison recouverte du brouillon d'ouverture en cours de réglage. Le brouillon n'est pas un calque
 * posé sur la scène : il entre dans la maison que la scène reçoit, donc l'allège, le linteau et le
 * vitrage se refont comme si le JSON était déjà écrit. Ce qu'on voit pendant le geste est
 * exactement ce qu'on gardera.
 */
function withOpeningDraft(h: House | null, id: string | null, patch: OpeningPatch | null): House | null {
  if (!h || !id || !patch) return h
  if (!h.rooms.some((r) => r.openings.some((o) => o.id === id))) return h
  return { ...h, rooms: h.rooms.map((r) => (r.openings.some((o) => o.id === id)
    ? { ...r, openings: r.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }
    : r)) }
}

export const useHouseStore = defineStore('house', () => {
  const devices = useDevicesStore()
  const house = shallowRef<House | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Appareils remontés par les plugins, dans la forme attendue par l'auto-placement. */
  const placeable = computed<PlaceableDevice[]>(() =>
    Object.values(devices.descriptors).map((d) => ({ id: d.id, kind: d.kind, room: d.meta.room })),
  )
  /**
   * Ouverture en cours de réglage (mode édition) et son brouillon non encore écrit. Déclarés ICI,
   * au-dessus de `expanded`, parce que c'est lui qui les recouvre sur la maison — le reste de leur
   * mécanique vit plus bas, avec le mode édition.
   */
  const selectedOpeningId = ref<string | null>(null)
  const openingDraft = shallowRef<OpeningPatch | null>(null)

  /**
   * Maison du JSON complétée des modules dérivés de ses champs de panneaux (`arrays`) : c'est sur
   * elle que se fait l'auto-placement (un onduleur lié à un champ n'est pas à placer) et la scène.
   *
   * Un emplacement sans onduleur porte sa PLACE dans la grille (« Emplacement 1-2 ») : c'est le repère
   * qu'on lit sur un plan de calepinage, là où le nom du champ donnait dix pilules identiques. Le mot
   * dit qu'il est VIDE — nommé « Onduleur 1-2 », il ne se distinguait plus d'un onduleur affecté,
   * dont le module porte, lui, la référence du fabricant (« Onduleur 035730 »).
   */
  const expanded = computed<House | null>(() => {
    void i18n.global.locale.value                    // le nom des emplacements suit la langue choisie
    const base = withOpeningDraft(house.value, selectedOpeningId.value, openingDraft.value)
    return base ? withPanelArrays(base, (row, col) => t('arrays.slot', { r: row + 1, c: col + 1 })) : null
  })
  const placement = computed(() => {
    if (!expanded.value) return null
    return autoPlaceDevices(expanded.value, placeable.value, indexHouse(expanded.value))
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
    const h = expanded.value
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
  /** Niveau sélectionné : le parent d'un appareil posé HORS pièce (le toit et les siens). */
  const selectedLevelId = ref<string | null>(null)
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
    if (selectedLevelId.value !== focusedLevelId.value) selectedLevelId.value = null
  }

  function focusLevel(levelId: string | null) { setFloorTab(levelId ?? 'all') }

  function selectRoom(roomId: string | null) {
    selectedOpeningId.value = null
    selectedKey.value = null
    selectedLevelId.value = null
    if (!roomId) { selectedRoomId.value = null; return }
    const room = index.value?.roomsById.get(roomId)
    if (room) { gardenFocus.value = false; focusedLevelId.value = room.levelId }
    else if (index.value?.zonesById.has(roomId)) { gardenFocus.value = true; focusedLevelId.value = null }
    selectedRoomId.value = roomId
  }

  /**
   * Sélectionne un NIVEAU : son panneau liste les appareils posés dessus hors de toute pièce (le toit
   * et sa caméra, ses panneaux). C'est le parent d'un tel appareil dans le fil d'Ariane.
   */
  function selectLevel(levelId: string) {
    selectedOpeningId.value = null
    selectedKey.value = null
    selectedRoomId.value = null
    gardenFocus.value = false
    focusedLevelId.value = levelId
    selectedLevelId.value = levelId
  }

  function selectDevice(key: string | null) {
    selectedOpeningId.value = null
    selectedLevelId.value = null
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

  function clearSelection() { selectedOpeningId.value = null; selectedKey.value = null }
  function backToHome() { selectedOpeningId.value = null; selectedKey.value = null; selectedRoomId.value = null; selectedLevelId.value = null }
  /** Retour depuis une pièce : le NIVEAU qui la porte ; une zone ou un niveau ramènent à la maison. */
  function backFromRoom() {
    const room = selectedRoom.value
    selectedKey.value = null
    selectedRoomId.value = null
    selectedLevelId.value = room ? room.levelId : null
  }
  /**
   * Retour depuis un appareil : sa pièce ou sa zone si elle l'ancre, sinon le NIVEAU qui le porte.
   * Sauf pour un MODULE de champ de panneaux : son parent est l'installation solaire qui porte son
   * champ, pas le toit — c'est par elle qu'on est descendu, et c'est elle qui sait le régler.
   */
  function backFromDevice() {
    const hd = selectedDevice.value
    const site = hd ? siteOfDevice(hd) : null
    if (site) { selectDevice(site); return }
    selectedKey.value = null
    if (hd && !hd.roomId && !hd.zoneId && hd.levelId) selectedLevelId.value = hd.levelId
  }

  /**
   * L'installation à laquelle un champ se rattache : celle qu'il NOMME, ou, s'il ne nomme personne
   * (JSON écrit à la main), la seule installation de la maison. Même règle que la liste de la carte
   * (`arraysOf`) — un champ anonyme appartient à l'installation qu'on regarde.
   */
  function siteOf(array: PanelArray): string | undefined {
    return array.siteId ?? findEnergySite(devices.list)?.descriptor.id
  }
  /** Clé de sélection de l'installation qui porte le champ d'un module (`null` si ce n'en est pas un). */
  function siteOfDevice(device: HouseDevice): string | null {
    const p = panelOf(device)
    const array = p ? house.value?.arrays.find((a) => a.id === p.arrayId) : undefined
    const siteId = array ? siteOf(array) : undefined
    if (!siteId) return null
    return index.value?.devicesByBinding.get(siteId)?.id ?? siteId
  }

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
  const placingOrigin = shallowRef<{ position: Vec3; roomId: string | undefined; levelId: string | null; mount: Mount | undefined; yaw: number | undefined; size: Size | undefined; leaves: Leaves | undefined } | null>(null)
  /**
   * L'appareil sélectionné, à condition qu'il soit PLACÉ. Tous les gestes de placement partent d'un
   * marqueur de la scène, et un appareil sans position n'en a pas : ils ne peuvent donc pas le viser.
   * Ce garde-fou remplace une douzaine de `!` disséminés.
   */
  const placedSelection = (): PlacedHouseDevice | null => {
    const hd = selectedDevice.value
    return hd && isPlaced(hd) ? hd : null
  }

  /** Niveau qui ancre l'appareil, que ce soit par sa pièce ou directement. */
  const anchorLevel = (hd: HouseDevice) => (index.value ? resolveDeviceLevelId(hd, index.value.roomsById) : null)

  function startPlacing() {
    const hd = placedSelection()
    if (!hd) return
    placingOrigin.value = { position: hd.position, roomId: hd.roomId, levelId: anchorLevel(hd), mount: hd.mount, yaw: hd.yaw, size: hd.size, leaves: hd.leaves }
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

  /**
   * Centre approximatif d'un niveau : milieu de la boîte englobante de ses pièces (ou de son contour).
   * Un niveau SANS pièce ni contour — c'est ainsi qu'un toit se déclare — retombe sur l'emprise du
   * bâti entier : sans ça, tout ce qu'on y pose atterrissait à l'origine de la maison, dans un coin.
   */
  function levelCentre(levelId: string): [number, number] {
    const idx = index.value
    const pts: Vec2[] = (idx?.roomsByLevel.get(levelId) ?? []).flatMap((r) => r.polygon)
    const outline = idx?.levelsById.get(levelId)?.outline
    const footprint: Vec2[] = house.value?.rooms.flatMap((r) => r.polygon) ?? []
    const all = pts.length ? pts : outline ?? (footprint.length ? footprint : [])
    if (!all.length) return [0, 0]
    const xs = all.map((p) => p[0]), ys = all.map((p) => p[1])
    return [snap((Math.min(...xs) + Math.max(...xs)) / 2), snap((Math.min(...ys) + Math.max(...ys)) / 2)]
  }

  /**
   * Pose un appareil de plugin qui n'a encore aucune entrée : provisoire au centre du niveau affiché
   * (ou du premier), à hauteur de table, sélectionné, mode « déplacer » ouvert. Le niveau se change
   * ensuite par le sélecteur de la section « Emplacement » (`setPlacementLevel`).
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
    selectedLevelId.value = null
    selectedKey.value = id
    placingOrigin.value = null
    draft.value = null
    placing.value = true
    return true
  }
  /** Niveau qui ancre l'appareil en cours de placement (pièce ou niveau seul), pour le sélecteur du panneau. */
  const placementLevelId = computed<string | null>(() => {
    const p = provisional.value
    if (p) return p.levelId ?? null
    const hd = placedSelection()
    return hd ? anchorLevel(hd) : null
  })

  /**
   * Emmène l'appareil en cours de placement sur un autre niveau — depuis le SÉLECTEUR de la section
   * « Emplacement », et seulement lui. Jusqu'au 2026-09-15 c'était l'onglet de niveau qui le faisait :
   * un clic pour aller regarder ailleurs ré-ancrait l'appareil sans le dire (une lampe du salon s'est
   * retrouvée ancrée au toit). L'onglet ne fait plus que naviguer.
   *
   * Un provisoire jamais déposé va au centre du niveau choisi ; un appareil déjà placé garde son x;y et
   * sa hauteur DANS L'ESPACE (voir `moveToLevel`). La vue suit : c'est là que l'appareil est maintenant.
   */
  async function setPlacementLevel(levelId: string): Promise<void> {
    if (!placing.value) return
    const p = provisional.value
    if (p) {
      if (levelId !== p.levelId) {
        const [x, y] = levelCentre(levelId)
        provisional.value = { ...p, levelId, position: [x, y, p.position?.[2] ?? 0] }
        draft.value = null
      }
    } else await moveToLevel(levelId)
    focusedLevelId.value = levelId
    gardenFocus.value = false
  }

  /**
   * Ré-ancre l'appareil sélectionné sur un autre niveau : x;y gardés, pièce reprise sous le point
   * (sinon le niveau seul ancre — cas d'un niveau sans pièce comme le toit), et z repris par rapport
   * au sol du nouveau niveau pour que l'appareil ne bouge pas dans l'espace.
   */
  async function moveToLevel(levelId: string): Promise<void> {
    const hd = placedSelection()
    const idx = index.value
    if (!hd || !idx) return
    const from = resolveDeviceLevelId(hd, idx.roomsById)
    if (!from || from === levelId) return
    const base = draft.value ?? { position: hd.position, roomId: hd.roomId }
    const xy: [number, number] = [base.position[0], base.position[1]]
    const dz = (idx.levelsById.get(from)?.elevation ?? 0) - (idx.levelsById.get(levelId)?.elevation ?? 0)
    const room = (idx.roomsByLevel.get(levelId) ?? []).find((r) => pointInPolygon(xy, r.polygon))
    draft.value = { position: [xy[0], xy[1], snap(base.position[2] + dz)], roomId: room?.id }
    await savePlacement({ levelId })
  }

  /** Aperçu d'une position au sol (glissement 3D) ; `roomId` null = hors de toute pièce → on garde l'ancienne. */
  function previewPosition(xy: [number, number], roomId: string | null) {
    const hd = placedSelection()
    if (!hd || !placing.value) return
    const z = draft.value?.position[2] ?? hd.position[2]
    draft.value = { position: [snap(xy[0]), snap(xy[1]), z], roomId: roomId ?? draft.value?.roomId ?? hd.roomId }
  }
  function previewHeight(z: number) {
    const hd = placedSelection()
    if (!hd || !placing.value) return
    const base = draft.value ?? { position: hd.position, roomId: hd.roomId }
    draft.value = { position: [base.position[0], base.position[1], snap(z)], roomId: base.roomId }
  }

  /**
   * Réglages d'un appareil que seul l'utilisateur peut connaître : le décalage de sa place calculée
   * par GPS, la correction de son orientation, la capacité de sa batterie (aucun fabricant ne la
   * donne). Même chemin que le renommage : l'entrée de maison est créée au besoin, SANS position —
   * un véhicule n'a pas de place écrite. `[0, 0]` et `0` effacent, comme la chaîne vide efface un nom.
   */
  async function setDeviceTuning(pluginDeviceId: string, tuning: Pick<DevicePlacement, 'gpsOffset' | 'yawOffset' | 'batteryKwh' | 'model3d' | 'bodyColor' | 'bodyFinish'>): Promise<boolean> {
    const hd = houseDeviceFor(pluginDeviceId)
    const placement: DevicePlacement = { ...tuning }
    if (!hd) placement.deviceId = pluginDeviceId
    try {
      house.value = await getTransport().placeDevice(hd?.id ?? houseIdForDevice(pluginDeviceId), placement)
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    }
  }

  /**
   * La teinte de carrosserie MONTRÉE le temps qu'on la choisit, sans rien écrire : la scène la peint
   * à chaque mouvement du sélecteur, et `setDeviceTuning` ne part qu'au choix validé — autrement
   * chaque nuance survolée réécrirait le fichier de la maison. `null` rend la teinte d'avant, pour
   * un choix abandonné.
   */
  const bodyColorPreview = shallowRef<{ key: string; color: string | null } | null>(null)
  function previewBodyColor(pluginDeviceId: string, color: string | null): void {
    bodyColorPreview.value = { key: houseDeviceFor(pluginDeviceId)?.id ?? pluginDeviceId, color }
  }

  /**
   * Le JOURNAL d'un appareil montré DANS la scène : ses incidents positionnés, posés sur le terrain
   * le temps que le panneau le déplie — c'est ainsi qu'on localise une panne. `null` retire tout.
   * `journalFocus` : la ligne que l'utilisateur vient de choisir, sur laquelle la caméra se cadre.
   * Même couture que l'aperçu de teinte : le store dit, `HomeView` transmet à la scène.
   */
  const journalOverlay = shallowRef<{ key: string; points: JournalPoint[] } | null>(null)
  const journalFocus = shallowRef<{ key: string; at: number } | null>(null)
  /** L'incident ACTIF (date) : ligne choisie dans le panneau, ou épingle touchée dans la scène — les deux le partagent. */
  const journalActive = shallowRef<number | null>(null)
  function showJournal(pluginDeviceId: string, points: JournalPoint[]): void {
    journalOverlay.value = { key: houseDeviceFor(pluginDeviceId)?.id ?? pluginDeviceId, points }
  }
  function hideJournal(): void { journalOverlay.value = null; journalFocus.value = null; journalActive.value = null }
  /** Une ligne choisie : la caméra s'y cadre, et elle devient l'incident actif. */
  function focusJournalPoint(pluginDeviceId: string, at: number): void {
    journalFocus.value = { key: houseDeviceFor(pluginDeviceId)?.id ?? pluginDeviceId, at }
    journalActive.value = at
  }
  /** Une épingle touchée dans la scène : l'incident actif change, la caméra reste où elle est. */
  function markJournalPoint(at: number | null): void { journalActive.value = at }

  /**
   * Renomme un appareil dans la maison — SANS le placer. C'est le seul chemin possible pour un
   * appareil qui n'a pas de place dans la scène (un véhicule) : son entrée est créée au besoin, et
   * elle n'a pas de position. Un nom vide EFFACE le nom choisi, et celui du fabricant reprend la main.
   */
  async function renameDevice(pluginDeviceId: string, name: string): Promise<boolean> {
    const hd = houseDeviceFor(pluginDeviceId)
    const placement: DevicePlacement = { name }
    // absent du JSON : son `deviceId` est ce qui lui donne une entrée
    if (!hd) placement.deviceId = pluginDeviceId
    try {
      house.value = await getTransport().placeDevice(hd?.id ?? houseIdForDevice(pluginDeviceId), placement)
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    }
  }

  /** Écrit le brouillon (complété par `override`) dans house.json ; un appareil auto-placé y gagne son entrée. */
  async function savePlacement(override?: { position?: Vec3; mount?: Mount; yaw?: number; size?: Size; leaves?: Leaves; levelId?: string }): Promise<boolean> {
    const hd = placedSelection()
    if (!hd) return false
    const base = draft.value ?? { position: hd.position, roomId: hd.roomId }
    const p: DevicePlacement = { position: override?.position ?? base.position }
    if (base.roomId && base.roomId !== hd.roomId) p.roomId = base.roomId
    if (override?.mount) p.mount = override.mount
    if (override?.yaw !== undefined) p.yaw = override.yaw
    if (override?.size) p.size = override.size
    if (override?.leaves) p.leaves = override.leaves
    if (hd.meta?.autoPlaced && hd.deviceId) {
      p.deviceId = hd.deviceId
      if (base.roomId) p.roomId = base.roomId
      else if (hd.meta.provisional && hd.levelId) p.levelId = hd.levelId   // déposé hors de toute pièce : le niveau ancre
      if (!p.mount && hd.mount) p.mount = hd.mount
    }
    // changement de niveau : le niveau n'ancre que hors de toute pièce (le serveur ignore `levelId`
    // quand `roomId` est donné, et efface la pièce quand le niveau ancre seul)
    if (override?.levelId && !p.roomId) p.levelId = override.levelId
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

  // ---- champs de panneaux : un champ se crée, se règle et se glisse depuis le panneau de
  // l'installation solaire. Les modules, eux, sont dérivés du champ (`panelArrayDevices`) : il n'y a
  // qu'un objet à écrire, quel que soit le nombre de panneaux. -------------------------------------
  const editingArrayId = ref<string | null>(null)
  /** Origine en cours de GLISSEMENT (aperçu 3D), pas encore écrite dans house.json. */
  const arrayDraft = shallowRef<Vec3 | null>(null)
  /**
   * Emplacement mis en avant depuis la grille des onduleurs (survol d'une case) : la scène allume le
   * module correspondant. C'est le fil qui relie les deux — sans lui, on garnit une grille sans
   * savoir quel panneau du toit on est en train de nommer.
   */
  const hoveredKey = ref<string | null>(null)
  const hoverSlot = (key: string | null) => { hoveredKey.value = key }
  const arrays = computed<PanelArray[]>(() => house.value?.arrays ?? [])
  /**
   * Les champs d'une installation : ceux qui la nomment (`siteId`), plus ceux qui ne nomment personne
   * — un fichier écrit à la main n'a pas de raison de le dire, et une maison n'a qu'une installation
   * solaire. C'est ce lien que le retrait de l'installation suit pour emporter ses champs.
   */
  const arraysOf = (siteDeviceId: string) => arrays.value.filter((a) => !a.siteId || a.siteId === siteDeviceId)
  const editingArray = computed<PanelArray | null>(() => arrays.value.find((a) => a.id === editingArrayId.value) ?? null)
  /** Modules du champ en cours d'édition, origine du brouillon comprise : ce que la scène doit montrer. */
  const editingArrayModules = computed<HouseDevice[]>(() => {
    const a = editingArray.value
    if (!a) return []
    return panelArrayDevices(arrayDraft.value ? { ...a, origin: arrayDraft.value } : a)
  })

  /**
   * Le niveau qui porte les panneaux : celui affiché s'il n'a AUCUNE pièce (c'est ainsi qu'un toit se
   * déclare, cf. le wiki), sinon le dernier niveau sans pièce, sinon le plus haut. Un champ posé par
   * défaut sur le séjour se verrait tout de suite ; un champ sans niveau ne s'écrirait pas du tout.
   */
  function panelLevelId(): string | null {
    const idx = index.value
    if (!idx) return null
    const bare = levels.value.filter((l) => (idx.roomsByLevel.get(l.id) ?? []).length === 0)
    const focused = focusedLevelId.value
    if (focused && bare.some((l) => l.id === focused)) return focused
    return bare[0]?.id ?? levels.value[0]?.id ?? null
  }

  /**
   * Onduleurs de cette installation qu'aucun champ ne porte et qu'aucune entrée de la maison ne pose :
   * ce sont eux qu'on peut affecter à un emplacement. Un onduleur est un capteur de PUISSANCE du même
   * plugin que le site (Enphase en publie un par module, la simulation aussi).
   *
   * TRIÉS par nom, chiffres compris (`numeric`) : la passerelle les annonce dans son ordre à elle, et
   * retrouver un numéro de série dans vingt lignes en désordre, plan d'installation à la main, est
   * un jeu de piste. C'est aussi l'ordre dans lequel un champ neuf se garnit.
   */
  function freeInverters(siteDeviceId: string): DeviceDescriptor[] {
    const prefix = `${siteDeviceId.split(':')[0]}:`
    const taken = new Set<string>()
    for (const a of arrays.value) for (const p of a.panels) if (p) taken.add(p)
    for (const d of house.value?.devices ?? []) if (d.deviceId) taken.add(d.deviceId)
    return Object.values(devices.descriptors)
      .filter((d) => d.kind === 'sensor' && d.meta.sensor?.deviceClass === 'power' && d.id.startsWith(prefix) && !taken.has(d.id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id))
  }

  /**
   * Installation depuis laquelle on règle le champ : un champ qui ne disait pas d'où il venait (écrit
   * à la main, ou avant que `siteId` existe) l'ADOPTE au premier réglage. Sans quoi il resterait
   * anonyme pour toujours, et ne partirait pas avec son installation.
   */
  const editingArraySite = ref<string | null>(null)

  /**
   * Hauteur à laquelle un champ se pose, mesurée depuis le sol du niveau des panneaux : le DESSUS du
   * toit. Un toit plat est une dalle de 20 cm posée sur les murs, et le niveau-toit est déclaré à sa
   * base : un champ à 0 était noyé dedans, invisible et impossible à attraper à l'œil. Un toit à deux
   * pans part, lui, du plan des égouts (0) et monte avec son inclinaison.
   */
  function panelBaseZ(levelId: string): number {
    const h = house.value
    if (!h) return 0
    const roof = computeRoof(h, resolveDefaults(h.defaults))
    if (!roof) return 0
    const elevation = index.value?.levelsById.get(levelId)?.elevation ?? 0
    const top = roof.type === 'flat' ? roof.zRidge : roof.zBase
    return Math.max(0, Math.round((top - elevation) * 100) / 100)
  }

  function startEditingArray(id: string, siteDeviceId?: string) {
    const a = arrays.value.find((x) => x.id === id)
    if (!a) return
    stopPlacing()
    arrayDraft.value = null
    editingArraySite.value = siteDeviceId ?? null
    editingArrayId.value = id
    // le champ vit sur le toit : on l'affiche, sinon on réglerait un champ qu'on ne voit pas
    gardenFocus.value = false
    focusedLevelId.value = a.levelId
  }
  function stopEditingArray() { editingArrayId.value = null; editingArraySite.value = null; arrayDraft.value = null; hoveredKey.value = null }

  /**
   * Règle un champ depuis AILLEURS que la carte de l'installation (le panneau d'un module) : on saute
   * sur l'installation qui le porte — son panneau porte la carte — puis on ouvre le réglage.
   *
   * Cet ordre est le bon : `selectDevice` cadre le niveau de l'INSTALLATION (elle peut être au
   * rez-de-chaussée), et c'est `startEditingArray`, ensuite, qui ramène sur le niveau du CHAMP. Le
   * garde-fou de sélection, lui, ne s'exécute qu'après les deux et voit un réglage cohérent.
   */
  function editArray(arrayId: string) {
    const a = arrays.value.find((x) => x.id === arrayId)
    if (!a) return
    const siteId = siteOf(a)
    if (siteId) selectDevice(index.value?.devicesByBinding.get(siteId)?.id ?? siteId)
    startEditingArray(arrayId, siteId)
  }
  // Quitter l'installation solaire referme le réglage : la carte qui le portait n'est plus là. Y
  // ARRIVER, en revanche, ne le referme pas — c'est ce qui permet d'ouvrir un champ depuis le panneau
  // d'un de ses modules (on saute sur l'installation, le réglage suit).
  watch(selectedKey, (key) => {
    const site = editingArraySite.value
    const hd = key ? index.value?.devicesById.get(key) : undefined
    if (!site || (key !== site && hd?.deviceId !== site)) stopEditingArray()
  })

  /**
   * Nouveau champ : deux rangées de cinq, posé au centre du niveau des panneaux, incliné comme le
   * toit, et VIDE. Vide, parce que l'ordre des numéros de série n'a aucune raison de suivre le
   * calepinage du toit : un garnissage automatique se trompait presque à coup sûr, et il fallait
   * tout défaire à la main avant de pouvoir placer chaque onduleur à sa vraie place.
   *
   * Il naît NOMMÉ et rattaché à son installation : le nom sert de repère à l'écran (jusque sur les
   * modules sans onduleur), et `siteId` le fait partir avec elle si on la retire de la maison.
   */
  async function addArray(siteDeviceId: string): Promise<boolean> {
    const levelId = panelLevelId()
    if (!levelId) return false
    const used = new Set(arrays.value.map((a) => a.id))
    let id = 'pv'
    for (let n = 1; used.has(id); n++) id = `pv-${n}`
    const [x, y] = levelCentre(levelId)
    // Le champ regarde là où regarde son INSTALLATION : on oriente la passerelle vers le sud comme on
    // oriente ses panneaux, et le champ n'a plus de raison de partir dans une autre direction.
    const yaw = index.value?.devicesByBinding.get(siteDeviceId)?.yaw ?? 0
    const ok = await writeArray(id, {
      name: t('arrays.field', { n: arraysOf(siteDeviceId).length + 1 }),
      siteId: siteDeviceId,
      levelId, origin: [x, y, panelBaseZ(levelId)], rows: 2, cols: 5, yaw,
      // Le champ ÉPOUSE le toit : la pente du support vient de la toiture — 0 sur un toit plat (le
      // schéma donne quand même une pente par défaut à `roof`, qui n'y veut rien dire). L'inclinaison
      // des MODULES, elle, ne s'invente pas : c'est le châssis, et on ne sait pas ce qui est monté.
      slope: house.value?.roof?.type === 'gable' ? house.value.roof.pitch : 0,
    })
    if (ok) startEditingArray(id, siteDeviceId)
    return ok
  }

  /** Écrit un champ (création ou réglage) ; la maison réécrite revient du serveur. */
  async function writeArray(id: string, patch: PanelArrayPatch): Promise<boolean> {
    saving.value = true
    try {
      house.value = await getTransport().saveArray(id, patch)
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    } finally { saving.value = false }
  }

  /** Règle le champ en cours d'édition (et le rattache à son installation s'il ne l'était pas). */
  async function saveArray(patch: PanelArrayPatch): Promise<boolean> {
    const id = editingArrayId.value
    if (!id) return false
    const site = editingArraySite.value
    const ok = await writeArray(id, site && !editingArray.value?.siteId ? { ...patch, siteId: site } : patch)
    if (ok && patch.origin) arrayDraft.value = null
    return ok
  }

  async function removeArray(id: string): Promise<boolean> {
    saving.value = true
    try {
      house.value = await getTransport().removeArray(id)
      if (editingArrayId.value === id) stopEditingArray()
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    } finally { saving.value = false }
  }

  /**
   * Aperçu du glissement : on attrape N'IMPORTE QUEL module et c'est le champ entier qui suit, donc
   * l'origine se déplace du même écart que le module attrapé. L'écart se mesure toujours depuis la
   * position ÉCRITE du module (la maison ne bouge qu'au dépôt) : rien ne s'accumule.
   */
  function previewArrayOrigin(key: string, xy: [number, number]) {
    const a = editingArray.value
    const hd = index.value?.devicesById.get(key)
    if (!a || !hd || !isPlaced(hd)) return
    arrayDraft.value = [snap(a.origin[0] + xy[0] - hd.position[0]), snap(a.origin[1] + xy[1] - hd.position[1]), a.origin[2]]
  }
  /** Dépôt : l'origine du brouillon devient celle du champ. */
  async function dropArray(): Promise<void> {
    if (arrayDraft.value) await saveArray({ origin: arrayDraft.value })
  }

  const canRevert = computed(() => {
    const o = placingOrigin.value, hd = placedSelection()
    return !!o && !!hd && (o.position.join() !== hd.position.join() || o.mount !== hd.mount || o.roomId !== hd.roomId
      || o.levelId !== anchorLevel(hd) || o.yaw !== hd.yaw || !sameSize(o.size, hd.size) || o.leaves !== hd.leaves)
  })
  async function revertPlacement() {
    const o = placingOrigin.value, hd = selectedDevice.value
    if (!o || !hd) return
    draft.value = { position: o.position, roomId: o.roomId }
    // une orientation absente à l'entrée ne peut pas être effacée du JSON : on la ramène à 0, qui vaut pareil
    // (même raisonnement pour la taille : on réécrit celle par défaut, qui donne le même dessin)
    await savePlacement({
      ...(o.mount ? { mount: o.mount } : {}),
      ...(o.yaw !== hd.yaw ? { yaw: o.yaw ?? 0 } : {}),
      ...(!sameSize(o.size, hd.size) ? { size: o.size ?? { ...defaultCoverSize(hd.deviceId ? devices.descriptors[hd.deviceId] : undefined) } } : {}),
      // même raisonnement : un nombre de battants absent à l'entrée se rétablit par son défaut
      ...(o.leaves !== hd.leaves ? { leaves: o.leaves ?? coverLeaves({ ...hd, leaves: undefined }, hd.deviceId ? devices.descriptors[hd.deviceId] : undefined) } : {}),
      // niveau d'entrée : seulement s'il n'y a pas de pièce pour l'ancrer, sinon le niveau EFFACERAIT la pièce
      ...(!o.roomId && o.levelId && o.levelId !== anchorLevel(hd) ? { levelId: o.levelId } : {}),
    })
  }

  // ---- mode édition : réglage d'une OUVERTURE ---------------------------------------------------
  //
  // Le relevé d'une maison réelle est approximatif : les fenêtres et les portes s'ajustent ici, en
  // regardant la 3D. Les cotes se saisissent dans le panneau, la place se glisse le long des murs de
  // la pièce. Chaque geste terminé est écrit dans house.json par le serveur, comme un placement.
  //
  // Une ouverture n'est ni créée ni retirée d'ici : elle naît du relevé, l'UI ne fait que la régler.
  const savingOpening = ref(false)
  /** Cotes à la sélection, pour « Rétablir » — l'ouverture telle qu'on l'a trouvée. */
  const openingOrigin = shallowRef<OpeningPatch | null>(null)

  /** L'ouverture sélectionnée, brouillon compris : c'est elle que le panneau AFFICHE. */
  const selectedOpening = computed(() => findOpening(effective.value, selectedOpeningId.value))
  /** La même, telle qu'elle est ÉCRITE : c'est elle qu'on compare pour savoir s'il y a de quoi rétablir. */
  const savedOpening = computed(() => findOpening(house.value, selectedOpeningId.value))

  function selectOpening(id: string | null) {
    openingDraft.value = null
    selectedOpeningId.value = id
    const sel = findOpening(house.value, id)
    openingOrigin.value = sel
      ? {
        type: sel.opening.type, segment: sel.opening.segment, offset: sel.opening.offset,
        width: sel.opening.width, height: sel.opening.height,
        sill: openingSill(sel.opening, resolveDefaults(house.value?.defaults)),
      }
      : null
    if (!sel) return
    // le panneau d'une ouverture se lit sous sa pièce ; c'est elle qui donne le fil d'Ariane et le cadrage
    selectedKey.value = null
    selectedLevelId.value = null
    selectedRoomId.value = sel.room.id
    gardenFocus.value = false
    focusedLevelId.value = sel.room.levelId
  }

  /** Hauteur sous plafond de la pièce qui porte l'ouverture : la borne haute de ses cotes. */
  const openingCeiling = computed(() => {
    const sel = savedOpening.value
    const level = sel ? index.value?.levelsById.get(sel.room.levelId) : undefined
    return sel && level && house.value ? roomHeight(sel.room, level, resolveDefaults(house.value.defaults)) : 0
  })

  /** Bornes des champs du panneau, à la place actuelle de l'ouverture (voisines, plafond). */
  const openingBounds = computed(() => {
    const sel = selectedOpening.value
    if (!sel || !house.value) return null
    const siblings = index.value?.roomsByLevel.get(sel.room.levelId) ?? [sel.room]
    return openingLimits(sel.room, siblings, resolveDefaults(house.value.defaults), sel.opening, openingCeiling.value)
  })

  /**
   * Glissement : le point attrapé dans la 3D devient la place admissible la plus proche sur le
   * CONTOUR de la pièce — l'ouverture court sur son mur et passe au suivant au coin. Un point
   * qu'aucun mur ne peut recevoir ne bouge rien : l'ouverture bute au lieu de sauter.
   */
  function previewOpeningAt(xy: Vec2) {
    const sel = selectedOpening.value
    if (!sel || !house.value) return
    const siblings = index.value?.roomsByLevel.get(sel.room.levelId) ?? [sel.room]
    // `from` = là où elle est en ce moment : c'est ce qui la fait BUTER sur une voisine au lieu de
    // sauter par-dessus. Passer de l'autre côté se fait en faisant le tour de la pièce.
    const here = { segment: sel.opening.segment, offset: sel.opening.offset }
    const slot = slotFromPoint(sel.room, siblings, resolveDefaults(house.value.defaults), xy, sel.opening.width, sel.opening.id, here)
    if (!slot) return
    if (slot.segment === sel.opening.segment && Math.abs(slot.offset - sel.opening.offset) < 0.005) return
    openingDraft.value = { ...openingDraft.value, segment: slot.segment, offset: snapCm(slot.offset) }
  }

  /**
   * Écrit le brouillon (complété par `patch`) dans house.json. Les cotes du panneau passent par ici
   * directement — une touche « + » est un geste terminé, elle n'a pas de brouillon à porter.
   */
  async function saveOpening(patch?: OpeningPatch): Promise<boolean> {
    const sel = savedOpening.value
    if (!sel) return false
    const body: OpeningPatch = { ...openingDraft.value, ...patch }
    if (Object.keys(body).length === 0) return true
    savingOpening.value = true
    try {
      house.value = await getTransport().saveOpening(sel.room.id, sel.opening.id, body)
      return true
    } catch (err) {
      useNotificationsStore().error(t('opening.saveError', { message: (err as Error).message }))
      return false
    } finally {
      openingDraft.value = null
      savingOpening.value = false
    }
  }

  /** Fin du glissement : le brouillon devient la place de l'ouverture. */
  async function dropOpening(): Promise<void> { if (openingDraft.value) await saveOpening() }

  const canRevertOpening = computed(() => {
    const o = openingOrigin.value, sel = savedOpening.value
    if (!o || !sel || !house.value) return false
    const s = sel.opening
    return o.type !== s.type || o.segment !== s.segment || o.offset !== s.offset
      || o.width !== s.width || o.height !== s.height
      || o.sill !== openingSill(s, resolveDefaults(house.value.defaults))
  })
  /** Rétablit les cotes trouvées à la sélection ; l'allège absente du JSON se rétablit par sa valeur, qui donne le même mur. */
  async function revertOpening(): Promise<void> {
    if (openingOrigin.value) await saveOpening(openingOrigin.value)
  }

  // --- poser et retirer une ouverture --------------------------------------
  //
  // POSER se fait en deux temps : on choisit une nature dans le panneau de la pièce (l'ouverture est
  // alors ARMÉE, rien n'est écrit), puis on tape le mur dans la 3D. Le point touché décide du mur ET
  // de la place par la même règle que le glissement (`slotFromPoint`), donc ce qui naît est toujours
  // à un endroit que le serveur accepte — jamais une ouverture posée à l'aveugle qu'il faudrait
  // ensuite aller chercher.
  const placingOpening = shallowRef<{ roomId: string; type: OpeningType } | null>(null)

  /** Arme une nature sur la pièce sélectionnée. Le réglage en cours se referme : on pose, on ne règle plus. */
  function startPlacingOpening(type: OpeningType) {
    const room = selectedRoom.value
    if (!room) return
    selectOpening(null)
    placingOpening.value = { roomId: room.id, type }
  }
  function cancelPlacingOpening() { placingOpening.value = null }
  // quitter la pièce désarme : le mur qu'on taperait ne serait plus celui qu'on visait
  watch(selectedRoomId, (id) => { if (placingOpening.value && placingOpening.value.roomId !== id) placingOpening.value = null })

  /** Id libre pour une ouverture neuve : sa nature, numérotée s'il le faut (comme `addArray`). */
  function freeOpeningId(type: OpeningType): string {
    const used = new Set((house.value?.rooms ?? []).flatMap((r) => r.openings.map((o) => o.id)))
    let id: string = type
    for (let n = 2; used.has(id); n++) id = `${type}-${n}`
    return id
  }

  /**
   * Le mur tapé : l'ouverture naît là, aux cotes de sa nature (`newOpeningDims`), et devient la
   * sélection — on l'a posée pour la régler. Une hauteur de catalogue qui ne tient pas sous CE
   * plafond fait descendre l'allège, comme dans le panneau (`fitHeight`).
   */
  async function placeOpeningAt(xy: Vec2): Promise<void> {
    const armed = placingOpening.value
    const room = armed ? index.value?.roomsById.get(armed.roomId) : undefined
    const level = room ? index.value?.levelsById.get(room.levelId) : undefined
    if (!armed || !room || !level || !house.value) return
    const defaults = resolveDefaults(house.value.defaults)
    const dims = newOpeningDims(armed.type, defaults)
    const siblings = index.value?.roomsByLevel.get(room.levelId) ?? [room]
    const slot = slotFromPoint(room, siblings, defaults, xy, dims.width, '')
    if (!slot) {
      // aucun mur de la pièce n'a de vide assez large : le dire, plutôt que de poser ailleurs
      useNotificationsStore().error(t('opening.addNoSpace', { width: dims.width.toFixed(2) }))
      placingOpening.value = null
      return
    }
    const fitted = fitHeight(dims.sill, dims.height, roomHeight(room, level, defaults), dims.height)
    const id = freeOpeningId(armed.type)
    savingOpening.value = true
    try {
      const next = await getTransport().addOpening(room.id, {
        id, type: armed.type, segment: slot.segment, offset: snapCm(slot.offset),
        width: dims.width, height: fitted.height, sill: fitted.sill,
      })
      placingOpening.value = null
      house.value = next
      selectOpening(id)
    } catch (err) {
      useNotificationsStore().error(t('opening.saveError', { message: (err as Error).message }))
    } finally {
      savingOpening.value = false
    }
  }

  /**
   * Retire l'ouverture sélectionnée. On revient à sa PIÈCE : c'est de là qu'on l'a posée, et c'est
   * là qu'on voit le mur se refermer. L'ouvrant qui l'habillait est libéré par le serveur, dans la
   * même écriture (`removeOpeningFromJson`).
   */
  async function removeOpening(): Promise<boolean> {
    const sel = savedOpening.value
    if (!sel) return false
    savingOpening.value = true
    try {
      const next = await getTransport().removeOpening(sel.room.id, sel.opening.id)
      selectOpening(null)
      selectedRoomId.value = sel.room.id
      house.value = next
      return true
    } catch (err) {
      useNotificationsStore().error(t('opening.saveError', { message: (err as Error).message }))
      return false
    } finally {
      savingOpening.value = false
    }
  }

  /** Descripteur de plugin d'un appareil de la maison (la nature d'un ouvrant en dépend). */
  const descriptorOf = (d: HouseDevice) => (d.deviceId ? devices.descriptors[d.deviceId] : undefined)

  /** Les ouvrants posés sur une ouverture donnée. Une ouverture n'en porte qu'un ; la liste sert à libérer l'ancien. */
  const coversOn = (openingId: string) => (effective.value?.devices ?? [])
    .filter((d) => d.openingId === openingId && (descriptorOf(d)?.kind ?? d.kind) === 'cover')

  /** Appareils de la maison (volet, capteur) qui habillent l'ouverture sélectionnée. */
  const openingDevices = computed<HouseDevice[]>(() => {
    const id = selectedOpeningId.value
    return id ? (effective.value?.devices ?? []).filter((d) => d.openingId === id) : []
  })

  /**
   * Ouvrants qui ATTENDENT une ouverture : ceux dont la nature n'a pas de sens sans la fenêtre
   * qu'ils habillent (`expectsOpening`) et qu'aucune ouverture ne porte encore.
   *
   * C'est une liste de travail, pas une anomalie : on dessine la maison, on active le plugin Somfy
   * des mois plus tard, et six volets arrivent d'un coup sans savoir où ils vont. Elle se vide à
   * mesure qu'on les affecte.
   *
   * À ne pas confondre avec un appareil « non lié », qui, lui, n'a pas de liaison vers un appareil de
   * PLUGIN (`deviceId` absent, affiché grisé) : ici la liaison au fabricant existe, c'est la place
   * dans la maison qui manque.
   */
  const coversWithoutOpening = computed<HouseDevice[]>(() => (effective.value?.devices ?? [])
    .filter((d) => !d.openingId && (descriptorOf(d)?.kind ?? d.kind) === 'cover' && expectsOpening(descriptorOf(d))))

  /**
   * Affecte une ouverture à un ouvrant, ou l'en retire (`null`). **Seule écriture de la liaison** :
   * le panneau d'une ouverture et la vue Ouvrants y passent tous les deux, chacun dans son sens,
   * pour que la règle ne vive qu'à un endroit.
   *
   * Une ouverture ne porte qu'un ouvrant : celui qui s'y trouvait est libéré d'abord. Le serveur, lui,
   * ré-ancre l'appareil sur la pièce qui porte l'ouverture (voir `placeDeviceInJson`).
   */
  async function setCoverOpening(houseDeviceId: string, openingId: string | null): Promise<boolean> {
    savingOpening.value = true
    try {
      if (openingId) {
        for (const d of coversOn(openingId)) {
          if (d.id !== houseDeviceId) house.value = await getTransport().placeDevice(d.id, { openingId: '' })
        }
      }
      house.value = await getTransport().placeDevice(houseDeviceId, { openingId: openingId ?? '' })
      return true
    } catch (err) {
      useNotificationsStore().error(t('opening.saveError', { message: (err as Error).message }))
      return false
    } finally {
      savingOpening.value = false
    }
  }

  /**
   * Même liaison, vue depuis l'OUVERTURE sélectionnée : on choisit son ouvrant, ou « aucun », ce qui
   * libère celui qui s'y trouvait.
   */
  async function setOpeningDevice(houseDeviceId: string | null): Promise<boolean> {
    const openingId = selectedOpeningId.value
    if (!openingId) return false
    if (houseDeviceId) return setCoverOpening(houseDeviceId, openingId)
    savingOpening.value = true
    try {
      for (const d of coversOn(openingId)) house.value = await getTransport().placeDevice(d.id, { openingId: '' })
      return true
    } catch (err) {
      useNotificationsStore().error(t('opening.saveError', { message: (err as Error).message }))
      return false
    } finally {
      savingOpening.value = false
    }
  }

  return {
    house, effective, loading, error, index, levels, zones, soundRoutes, relaySource,
    focusedLevelId, gardenFocus, selectedRoomId, selectedLevelId, selectedKey, floorTab, selectedRoom, selectedZone, selectedDevice,
    load, setFloorTab, focusLevel, selectRoom, selectLevel, selectDevice, clearSelection, backToHome, backFromRoom, backFromDevice, houseDeviceFor, renameDevice, setDeviceTuning, bodyColorPreview, previewBodyColor, setRoomOrder,
    journalOverlay, journalFocus, journalActive, showJournal, hideJournal, focusJournalPoint, markJournalPoint,
    placing, saving, draft, canRevert, isProvisional, startPlacing, startPlacingNew, stopPlacing, previewPosition, previewHeight, savePlacement, revertPlacement, removePlacement,
    placementLevelId, setPlacementLevel,
    selectedOpeningId, selectedOpening, savedOpening, openingDraft, openingBounds, openingCeiling, openingDevices, savingOpening, canRevertOpening,
    placingOpening, startPlacingOpening, cancelPlacingOpening, placeOpeningAt, removeOpening,
    selectOpening, previewOpeningAt, saveOpening, dropOpening, revertOpening, setOpeningDevice, setCoverOpening, coversWithoutOpening,
    arrays, arraysOf, editingArrayId, editingArray, editingArrayModules, arrayDraft, hoveredKey, hoverSlot, freeInverters,
    startEditingArray, stopEditingArray, editArray, siteOf, siteOfDevice, addArray, saveArray, removeArray, previewArrayOrigin, dropArray,
  }
})
