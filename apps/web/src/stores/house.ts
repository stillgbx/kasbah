import { computed, ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
  import { applyHouseEditToJson, insertVertex, rectRoomAt, roomAgainstWall, type NewLevelSide, type RoomKind, mergeAppearancePatch, moveVertex, openingLabel, pushWall, removeVertex, roomShape, safeParseHouse, setEdgeLength, autoPlaceDevices, computeRoof, fitHeight, fitParkingGap, houseIdForDevice, isSurfaceOpening, longestEdgeYawDeg, indexHouse, isPlaced, newOpeningDims, newParkingSize, openingLimits, openingSill, panelArrayDevices, panelOf, parkingGaps, parkingHost, pointInPolygon, resolveDefaults, resolveDeviceLevelId, roomHeight, slotFromPoint, slotFromSurfacePoint, surfaceFootprint, withPanelArrays, type DeviceDescriptor, type HouseEditPatch, type HouseIssue, type Shapes, type SurveyDoc, type DeviceEntry, type Finish, type DeviceKind, type DevicePlacement, type GardenItem, type GardenItemPatch, type GardenKind, type GeoOrigin, type House, type HouseDevice, type HouseIndex, type Level, type Opening, type OpeningPatch, type OpeningType, type PanelArray, type PanelArrayPatch, type Parking, type ParkingPatch, type ParkingSide, type PlaceableDevice, type PlacedHouseDevice, type Relief, type Room, type SceneTuning, type Vec2, type Vec3, type Zone } from '@kasbah/shared'
import { getTransport } from '../api'
import type { JournalPoint } from '../lib/journal'
import { i18n, t } from '../i18n'
import { soundRouting } from '../lib/audioRouting'
import { findEnergySite } from '../lib/energy'
import { coverLeaves, defaultCoverSize } from '../lib/orientation'
import { expectsOpening } from '../lib/cover'
import { useDevicesStore } from './devices'
import { useNotificationsStore } from './notifications'
import { speciesOf } from '../three/garden/species'

// House (immutable: `shallowRef`, re-indexed when the object changes) + current selection:
// focused level (or garden, or all), room/zone, device. Shared by the scene, the panels and the URL.
// `effective` = the JSON's house + auto-placed plugin devices (see `autoPlaceDevices`): it is
// the one that is indexed and given to the 3D scene, never `house` alone.

export type FloorTab = 'garden' | 'all' | string
type Mount = NonNullable<HouseDevice['mount']>
type Size = NonNullable<HouseDevice['size']>
type Leaves = NonNullable<HouseDevice['leaves']>
/** Placement being edited (3D preview), not yet written to house.json. */
export interface PlacementDraft { position: Vec3; roomId: string | undefined }

/** Two identical footprints (absent on both sides included): serves the "Revert" button. */
const sameSize = (a: Size | undefined, b: Size | undefined) => a?.width === b?.width && a?.height === b?.height

/** Rounded to 5 cm: keeps a JSON readable. */
const snap = (v: number) => Math.round(v * 20) / 20
/** Rounded to the centimeter: an opening's measurement is surveyed with a tape measure, not in 5 cm steps. */
const snapCm = (v: number) => Math.round(v * 100) / 100

/** The opening `id` and the room that carries it, in a given house. */
function findOpening(h: House | null, id: string | null): { room: Room; opening: Opening } | null {
  if (!h || !id) return null
  for (const room of h.rooms) {
    const opening = room.openings.find((o) => o.id === id)
    if (opening) return { room, opening }
  }
  return null
}

/**
 * House overlaid with the draft of the opening being adjusted. The draft is not a layer
 * placed on the scene: it enters the house that the scene receives, so the sill, the lintel and the
 * glazing are redone as if the JSON were already written. What one sees during the gesture is
 * exactly what one will keep.
 */
/**
 * The house with the place `id` as it is being moved. Same role as
 * `withOpeningDraft`: the scene shows the gesture BEFORE the write, and it is the same house that feeds
 * the panel — the four measurements therefore follow the finger.
 */
function withParkingDraft(h: House | null, id: string | null, patch: ParkingPatch | null): House | null {
  if (!h || !id || !patch) return h
  if (!h.site.parkings.some((p) => p.id === id)) return h
  return {
    ...h,
    site: { ...h.site, parkings: h.site.parkings.map((p) => (p.id === id ? { ...p, ...patch } : p)) },
  }
}

/** The house with the garden item `id` as it is being adjusted (same role as the places). */
function withGardenDraft(h: House | null, id: string | null, patch: GardenItemPatch | null): House | null {
  if (!h || !id || !patch) return h
  if (!h.site.garden.some((g) => g.id === id)) return h
  // `spacing: null` clears a hedge's spacing: in the preview, the field disappears
  const apply = (g: GardenItem): GardenItem => {
    const { spacing, ...rest } = patch
    const next: GardenItem = { ...g, ...rest }
    if (spacing === null) delete next.spacing
    else if (spacing !== undefined) next.spacing = spacing
    return next
  }
  return { ...h, site: { ...h.site, garden: h.site.garden.map((g) => (g.id === id ? apply(g) : g)) } }
}

/** Height of an item that is born (m): an order of magnitude for the family, adjusted afterwards. */
export const GARDEN_DEFAULT_HEIGHT: Record<GardenKind, number> = { broadleaf: 7, fruit: 5, conifer: 9, palm: 6, bamboo: 5, shrub: 1.2, rock: 0.6, hedge: 1.8 }

/**
 * What an editing session changes in a house (shapes, readjusted openings, finishes): compared
 * before / after to know whether anything remains to be written. Neither the measurements (`meta.survey`) nor the
 * footprints of the levels, which are DEDUCED from them: a house converted to a survey without changing shape (the demo, whose
 * ground floor did not declare a footprint) has nothing to write.
 */
const buildingOf = (h: House | null) => JSON.stringify([
  h?.style ?? null,
  h?.rooms.map((r) => [r.id, r.levelId, r.name, r.kind, r.polygon, r.openings, r.style?.floorFinish ?? null, r.style?.wallFinish ?? null]) ?? [],
  h?.levels.map((l) => [l.id, l.name, l.shortName ?? null, l.elevation]) ?? [],
  h?.name ?? null,
])

/** Two lists of additions: the second completes the first, without duplicate ids. */
const unionById = <T extends { id: string }>(a: T[] = [], b: T[] = []): T[] => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))]
const union = (a: string[] = [], b: string[] = []): string[] => [...new Set([...a, ...b])]

/** Two session states: the second takes precedence (finishes surface by surface, shapes room by room). */
function mergeEdit(prev: HouseEditPatch | null, next: HouseEditPatch): HouseEditPatch {
  const out: HouseEditPatch = {}
  const appearance = prev?.appearance && next.appearance ? mergeAppearancePatch(prev.appearance, next.appearance) : next.appearance ?? prev?.appearance
  if (appearance) out.appearance = appearance
  const shapes = { ...prev?.shapes, ...next.shapes }
  if (Object.keys(shapes).length) out.shapes = shapes
  // structure: additions and removals accumulate, name and type room by room
  const newLevels = unionById(prev?.newLevels, next.newLevels)
  if (newLevels.length) out.newLevels = newLevels
  const newRooms = unionById(prev?.newRooms, next.newRooms)
  if (newRooms.length) out.newRooms = newRooms
  const removeRooms = union(prev?.removeRooms, next.removeRooms)
  if (removeRooms.length) out.removeRooms = removeRooms
  const removeLevels = union(prev?.removeLevels, next.removeLevels)
  if (removeLevels.length) out.removeLevels = removeLevels
  const rooms: NonNullable<HouseEditPatch['rooms']> = { ...prev?.rooms }
  for (const [id, r] of Object.entries(next.rooms ?? {})) rooms[id] = { ...rooms[id], ...r }
  if (Object.keys(rooms).length) out.rooms = rooms
  const lvls: NonNullable<HouseEditPatch['levels']> = { ...prev?.levels }
  for (const [id, l] of Object.entries(next.levels ?? {})) lvls[id] = { ...lvls[id], ...l }
  if (Object.keys(lvls).length) out.levels = lvls
  const propertyName = next.propertyName ?? prev?.propertyName
  if (propertyName !== undefined) out.propertyName = propertyName
  return out
}

/** An opening that no longer fits is told by its name and that of its room; the rest, as is. */
function issueText(h: House, i: HouseIssue): string {
  const m = /^rooms\[(\d+)\]\.openings\[(\d+)\]/.exec(i.path)
  const room = m ? h.rooms[Number(m[1])] : undefined
  const o = room?.openings[Number(m![2])]
  if (!room || !o) return `${i.path} : ${i.message}`
  // the roof is mounted on a new floor: the roof window left below is no longer under the roof
  if (o.type === 'roof-window' && i.message.startsWith('roof-window must belong')) return t('structure.roofWindowUnder', { room: room.name, opening: openingLabel(o) })
  return t('shape.openingNoFit', { room: room.name, opening: openingLabel(o) })
}

interface EditOutcome {
  house: House | null
  /** The document as the session gives it, even refused: it is ITS measurements that the editor shows. */
  raw: SurveyDoc | null
  blocking: string[]
  warnings: string[]
}
/** The house the session would give, and what prevents writing it (rooms named, not their ids). */
function runEdit(h: House, patch: HouseEditPatch): EditOutcome {
  let r
  try { r = applyHouseEditToJson(h, patch) } catch (err) { return { house: null, raw: null, blocking: [(err as Error).message], warnings: [] } }
  // the rooms born in the session are named too (the session's document carries them)
  const names = new Map([...h.rooms, ...((r.doc as unknown as House).rooms ?? [])].map((x) => [x.id, x.name]))
  const named = (msg: string) => msg.replace(/[a-z0-9_.-]+/gi, (w) => names.get(w) ?? w)
  const parsed = safeParseHouse(r.doc)
  return {
    house: parsed.success ? parsed.house : null,
    raw: r.doc as unknown as SurveyDoc,
    blocking: [...r.blocking.map(named), ...(parsed.success ? [] : parsed.issues.map((i) => issueText(r.doc as House, i)))],
    warnings: r.warnings.map(named),
  }
}

function withOpeningDraft(h: House | null, id: string | null, patch: OpeningPatch | null): House | null {
  if (!h || !id || !patch) return h
  if (!h.rooms.some((r) => r.openings.some((o) => o.id === id))) return h
  return { ...h, rooms: h.rooms.map((r) => (r.openings.some((o) => o.id === id)
    ? { ...r, openings: r.openings.map((o) => (o.id === id ? mergeOpening(o, patch) : o)) }
    : r)) }
}

/**
 * The draft placed on an opening. The three CLEARABLE fields follow here exactly the server's
 * rule (`patchOpeningInJson`): an empty string REMOVES the key instead of writing it. Without this
 * detour, handing back to the default (the kind, the palette) would have shown in the scene a
 * joinery with material `''`, which the file will never carry.
 */
function mergeOpening(o: Opening, patch: OpeningPatch): Opening {
  const { name, leaves, material, color, ...rest } = patch
  const next: Opening = { ...o, ...rest }
  if (name !== undefined) { if (name) next.name = name; else delete next.name }
  if (leaves !== undefined) { if (leaves) next.leaves = leaves; else delete next.leaves }
  if (material !== undefined) { if (material) next.material = material; else delete next.material }
  if (color !== undefined) { if (color) next.color = color; else delete next.color }
  return next
}

export const useHouseStore = defineStore('house', () => {
  const devices = useDevicesStore()
  const house = shallowRef<House | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** Devices reported by the plugins, in the shape expected by auto-placement. */
  const placeable = computed<PlaceableDevice[]>(() =>
    Object.values(devices.descriptors).map((d) => ({ id: d.id, kind: d.kind, room: d.meta.room })),
  )
  /**
   * Opening being adjusted (edit mode) and its draft not yet written. Declared HERE,
   * above `expanded`, because it is the one that overlays them on the house — the rest of their
   * machinery lives further down, with the edit mode.
   */
  const selectedOpeningId = ref<string | null>(null)
  const openingDraft = shallowRef<OpeningPatch | null>(null)
  /** Place being adjusted and its draft: same machinery, and same reason for being declared here. */
  const selectedParkingId = ref<string | null>(null)
  const parkingDraft = shallowRef<ParkingPatch | null>(null)
  /** Garden item being adjusted and its draft: same machinery. */
  const selectedGardenId = ref<string | null>(null)
  const gardenDraft = shallowRef<GardenItemPatch | null>(null)
  /**
   * Editing session in progress (edit mode): finishes and shapes of the rooms. The sequence of the
   * draft's states, to undo and redo, and the current step (0 = nothing changed). Nothing is written
   * before "Apply". `shapeTransient` = the shape during a DRAG: shown, not yet a step.
   */
  const editHistory = shallowRef<HouseEditPatch[]>([])
  const editStep = ref(0)
  const editDraft = computed<HouseEditPatch | null>(() => editHistory.value[editStep.value - 1] ?? null)
  const shapeTransient = shallowRef<Shapes | null>(null)
  const editPatch = computed<HouseEditPatch | null>(() =>
    shapeTransient.value ? mergeEdit(editDraft.value, { shapes: shapeTransient.value }) : editDraft.value)
  const editOutcome = computed<EditOutcome | null>(() => (house.value && editPatch.value ? runEdit(house.value, editPatch.value) : null))
  /**
   * The house shown during the session. A shape that validation refuses (an opening that no longer
   * fits on its wall) cannot be drawn: the scene then keeps the last one that could.
   */
  let lastGoodEdit: House | null = null
  const editView = computed<House | null>(() => {
    const o = editOutcome.value
    if (!o) { lastGoodEdit = null; return house.value }
    if (o.house) lastGoodEdit = o.house
    return o.house ?? lastGoodEdit ?? house.value
  })

  /**
   * The JSON's house completed with the modules derived from its panel arrays (`arrays`): it is on
   * it that auto-placement is done (an inverter linked to an array is not to be placed) and the scene.
   *
   * An empty slot carries its PLACE in the grid ("Slot 1-2"): it is the mark
   * read on a layout plan, where the array's name gave ten identical pills. The word
   * says it is EMPTY — named "Inverter 1-2", it was no longer distinguishable from an assigned inverter,
   * whose module carries, for its part, the vendor's reference ("Inverter 035730").
   */
  const expanded = computed<House | null>(() => {
    void i18n.global.locale.value                    // the slots' name follows the chosen language
    const drafted = withOpeningDraft(editView.value, selectedOpeningId.value, openingDraft.value)
    const base = withGardenDraft(withParkingDraft(drafted, selectedParkingId.value, parkingDraft.value), selectedGardenId.value, gardenDraft.value)
    return base ? withPanelArrays(base, (row, col) => t('arrays.slot', { r: row + 1, c: col + 1 })) : null
  })
  const placement = computed(() => {
    if (!expanded.value) return null
    return autoPlaceDevices(expanded.value, placeable.value, indexHouse(expanded.value))
  })
  /**
   * PROVISIONAL device: a plugin device with no entry at all (neither JSON nor auto-placement) that
   * the user is placing from a list. It lives here for the duration of the gesture, drawn in
   * the scene like the others; its first drop creates the entry in house.json (`savePlacement`),
   * "Done" without a drop abandons it. Same id as auto-placement would have given: on writing, the
   * reread house replaces it without the selection changing.
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
  /** Who plays whose sound at the moment (the JSON's `meta.audioOutput` links × states) — see `lib/audioRouting.ts`. */
  const soundRoutes = computed(() => soundRouting(effective.value?.devices ?? [], devices.states))
  /** Player whose sound this device RELAYS (soundbar of a TV that is playing), with its display name; otherwise `undefined`. */
  function relaySource(pluginDeviceId: string): (DeviceEntry & { name: string }) | undefined {
    const src = soundRoutes.value.relays.get(pluginDeviceId)
    const descriptor = src ? devices.descriptors[src] : undefined
    const state = src ? devices.states[src] : undefined
    if (!descriptor || !state) return undefined
    return { descriptor, state, name: index.value?.devicesByBinding.get(descriptor.id)?.name ?? descriptor.name }
  }
  const levels = computed<Level[]>(() => index.value?.levelsSorted ?? [])
  const zones = computed<Zone[]>(() => house.value?.site.zones ?? [])
  /** The parking spots, draft included: the house panel's list in edit mode. */
  const parkings = computed<Parking[]>(() => effective.value?.site.parkings ?? [])
  /** The garden items, draft included. */
  const gardenItems = computed<GardenItem[]>(() => effective.value?.site.garden ?? [])

  /** null = the whole house (or the garden if `gardenFocus`). */
  const focusedLevelId = ref<string | null>(null)
  const gardenFocus = ref(false)
  /** Selected room or zone. */
  const selectedRoomId = ref<string | null>(null)
  /** Selected level: the parent of a device placed OUTSIDE a room (the roof and its own). */
  const selectedLevelId = ref<string | null>(null)
  /** HOUSE device id (HouseDevice.id), or plugin id for an unplaced device. */
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
  // another screen moved a device: the server pushes the rewritten house
  watch(() => devices.serverHouse, (h) => { if (h) house.value = h })

  function setFloorTab(tab: FloorTab) {
    gardenFocus.value = tab === 'garden'
    focusedLevelId.value = tab === 'garden' || tab === 'all' ? null : tab
    if (selectedRoomId.value) {
      const room = index.value?.roomsById.get(selectedRoomId.value)
      const zone = index.value?.zonesById.get(selectedRoomId.value)
      if ((room && room.levelId !== focusedLevelId.value) || (zone && tab !== 'garden')) selectedRoomId.value = null
    }
    // A tab NAVIGATES: we leave the device (except in Move mode — the Location selector
    // alone then changes level). Otherwise `frameSelection` reframes it (`focusDevice` → `focusLevel`
    // of ITS room) and cancels the requested level.
    if (!placing.value) selectedKey.value = null
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
   * Selects a LEVEL: its panel lists the devices placed on it outside any room (the roof
   * and its camera, its panels). It is the parent of such a device in the breadcrumb.
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
  /** Back from a room: the LEVEL that carries it; a zone or a level lead back to the house. */
  function backFromRoom() {
    const room = selectedRoom.value
    selectedKey.value = null
    selectedRoomId.value = null
    selectedLevelId.value = room ? room.levelId : null
  }
  /**
   * Back from a device: its room or its zone if it anchors it, otherwise the LEVEL that carries it.
   * Except for a panel array MODULE: its parent is the solar installation that carries its
   * array, not the roof — it is through it that one came down, and it is the one that knows how to adjust it.
   */
  function backFromDevice() {
    const hd = selectedDevice.value
    const site = hd ? siteOfDevice(hd) : null
    if (site) { selectDevice(site); return }
    selectedKey.value = null
    if (hd && !hd.roomId && !hd.zoneId && hd.levelId) selectedLevelId.value = hd.levelId
  }

  /**
   * The installation an array is attached to: the one it NAMES, or, if it names no one
   * (hand-written JSON), the house's only installation. Same rule as the card's list
   * (`arraysOf`) — an anonymous array belongs to the installation being looked at.
   */
  function siteOf(array: PanelArray): string | undefined {
    return array.siteId ?? findEnergySite(devices.list)?.descriptor.id
  }
  /** Selection key of the installation that carries a module's array (`null` if it is not one). */
  function siteOfDevice(device: HouseDevice): string | null {
    const p = panelOf(device)
    const array = p ? house.value?.arrays.find((a) => a.id === p.arrayId) : undefined
    const siteId = array ? siteOf(array) : undefined
    if (!siteId) return null
    return index.value?.devicesByBinding.get(siteId)?.id ?? siteId
  }

  /**
   * Display order of a level's rooms (drag-and-drop in the Lights view). Applied right
   * away (the gesture has just ended), confirmed by the house that the server rewrites and broadcasts.
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

  /**
   * Light tuning of the 3D scene saved in the house (House view bench). No optimistic
   * application: the house does not change look on saving — the scene already shows the
   * tuning in progress, the write only makes it durable and common to all screens.
   */
  async function saveRenderTuning(tuning: SceneTuning): Promise<boolean> {
    try {
      house.value = await getTransport().saveRenderTuning(tuning)
      return true
    } catch (err) {
      useNotificationsStore().error(t('render.tuning.saveError', { message: (err as Error).message }))
      return false
    }
  }

  /** Saves the terrain relief (`null` = flat); the error is reported by a notification. */
  async function saveRelief(relief: Relief | null): Promise<boolean> {
    try {
      house.value = await getTransport().saveRelief(relief)
      return true
    } catch (err) {
      useNotificationsStore().error(t('relief.saveError', { message: (err as Error).message }))
      return false
    }
  }

  async function saveTerrain(polygon: Vec2[]): Promise<boolean> {
    try {
      house.value = await getTransport().saveTerrain(polygon)
      return true
    } catch (err) {
      useNotificationsStore().error(t('relief.outline.saveError', { message: (err as Error).message }))
      return false
    }
  }

  /** Saves the GPS origin aligned on the photo; the error is reported by a notification. */
  async function saveOrigin(origin: GeoOrigin): Promise<boolean> {
    try {
      house.value = await getTransport().saveOrigin(origin)
      return true
    } catch (err) {
      useNotificationsStore().error(t('settings.originSaveError', { message: (err as Error).message }))
      return false
    }
  }

  // ---- edit mode: SESSION (finishes of the rooms and of the facade, shapes of the rooms) ---------------
  //
  // Each choice enters the draft, which the scene shows right away; nothing is written to
  // house.json before "Apply", which writes the whole session at once (`PUT /api/house/edit`).

  /** The finishes as they are SEEN (draft included): it is what the selector ticks. */
  function roomFinish(roomId: string, surface: 'floor' | 'walls'): Finish | undefined {
    const r = editView.value?.rooms.find((x) => x.id === roomId)
    return surface === 'floor' ? r?.style?.floorFinish : r?.style?.wallFinish
  }
  const facadeFinish = computed<Finish | undefined>(() => editView.value?.style?.facade)

  /** A gesture: a new state of the draft, which cuts off the "redoable" states. */
  function pushEdit(patch: HouseEditPatch) {
    const next = mergeEdit(editDraft.value, patch)
    editHistory.value = [...editHistory.value.slice(0, editStep.value), next]
    editStep.value = editHistory.value.length
  }
  function setRoomFinish(roomId: string, surface: 'floor' | 'walls', finish: Finish | null) {
    pushEdit({ appearance: { rooms: { [roomId]: { [surface]: finish } } } })
  }
  function setFacadeFinish(finish: Finish | null) { pushEdit({ appearance: { facade: finish } }) }

  // -- shapes: the measurements of a room (survey), the polygon is deduced from them --
  /** The party wall drags along the one of the room opposite (panel setting, yes by default). */
  const coupleWalls = ref(true)
  /** The Dimensions tab is open: the scene shows the handles of the selected room. */
  const shapeEditing = ref(false)
  /** Chosen handle (vertex or wall), shared by the 3D and the list of sides. */
  const shapeSelection = ref<{ corner: number } | { wall: number } | null>(null)
  /**
   * The room's measurements in the draft (m, house reference frame) — even a refused draft: a
   * vertex just added across an opening must be visible so that it can be moved. The 3D,
   * for its part, keeps the last drawable shape.
   */
  function shapeOf(roomId: string): Vec2[] | null {
    const v = editOutcome.value?.raw ?? (editView.value as unknown as SurveyDoc | null)
    if (!v?.rooms.some((r) => r.id === roomId)) return null
    return roomShape(v, roomId)
  }
  /** The document on which the gestures apply: the draft as is, refused or not. */
  const editBase = () => editOutcome.value?.raw ?? (editView.value as unknown as SurveyDoc | null)
  function pushShapes(shapes: Shapes | null) { if (shapes) pushEdit({ shapes }) }
  /** Pushes a wall by `delta` m outward (negative: inward). */
  function pushRoomWall(roomId: string, edge: number, delta: number) {
    const base = editBase()
    if (base) pushShapes(pushWall(base, roomId, edge, delta, coupleWalls.value))
  }
  /** Sets the length of a side: the next wall moves back or forward. */
  function setSideLength(roomId: string, edge: number, length: number) {
    const base = editBase()
    if (base) pushShapes(setEdgeLength(base, roomId, edge, length, coupleWalls.value))
  }
  function addCorner(roomId: string, edge: number) { const base = editBase(); if (base) pushShapes(insertVertex(base, roomId, edge)) }
  function removeCorner(roomId: string, index: number) { const base = editBase(); if (base) pushShapes(removeVertex(base, roomId, index)) }

  /** Drag in progress: each position is computed from the shape at the START of the gesture. */
  let dragBase: SurveyDoc | null = null
  function beginShapeDrag() { dragBase = editBase(); shapeTransient.value = null }
  function previewRoomWall(roomId: string, edge: number, delta: number) {
    if (dragBase) shapeTransient.value = pushWall(dragBase, roomId, edge, delta, coupleWalls.value)
  }
  function previewCorner(roomId: string, index: number, to: Vec2) {
    if (dragBase) shapeTransient.value = moveVertex(dragBase, roomId, index, to)
  }
  /** End of the gesture: the shape becomes a history step (or is abandoned). */
  function endShapeDrag(commit = true) {
    const tr = shapeTransient.value
    dragBase = null
    shapeTransient.value = null
    if (commit && tr) pushEdit({ shapes: tr })
  }

  // -- structure: rooms and levels that are born or disappear, name and type of a room. Everything
  //    enters the same draft as the shapes: undo, redo, nothing written before "Apply".
  /** Level waiting for the tap where to place a 4 × 4 m room ("Add a room"). */
  const placingRoom = ref<string | null>(null)
  /** A free id in the session's house (born rooms and levels included). */
  function freeId(prefix: string, used: Iterable<string>): string {
    const taken = new Set(used)
    let n = 1
    while (taken.has(`${prefix}-${n}`)) n++
    return `${prefix}-${n}`
  }
  function addRoom(levelId: string, points: Vec2[]): void {
    const v = editView.value
    if (!v) return
    const ids = [...v.rooms.map((r) => r.id), ...(editDraft.value?.newRooms ?? []).map((r) => r.id)]
    const id = freeId('piece', ids)
    const name = t('structure.newRoomName', { n: v.rooms.length + 1 })
    pushEdit({ newRooms: [{ id, levelId }], shapes: { [id]: points }, rooms: { [id]: { name } } })
    selectRoom(id)
  }
  /** A room on the other side of the chosen wall: the wall's length over 3 m, shared partition. */
  function addRoomAgainstWall(roomId: string, edge: number): void {
    const base = editBase()
    const room = editView.value?.rooms.find((r) => r.id === roomId)
    if (base && room) addRoom(room.levelId, roomAgainstWall(base, roomId, edge))
  }
  /** The level where we will place: the tab's, otherwise the lowest. */
  const roomTargetLevelId = computed<string | null>(() => focusedLevelId.value ?? levels.value.at(-1)?.id ?? null)   // sorted from top to bottom
  function startPlacingRoom(): void { placingRoom.value = roomTargetLevelId.value }
  function cancelPlacingRoom(): void { placingRoom.value = null }
  function placeRoomAt(xy: Vec2): void {
    const levelId = placingRoom.value
    const base = editBase()
    placingRoom.value = null
    if (levelId && base) addRoom(levelId, rectRoomAt(base, levelId, xy))
  }
  function removeRoom(roomId: string): void {
    pushEdit({ removeRooms: [roomId] })
    if (selectedRoomId.value === roomId) selectRoom(null)
  }
  function setRoomIdentity(roomId: string, ident: { name?: string; kind?: RoomKind }): void {
    pushEdit({ rooms: { [roomId]: ident } })
  }
  /** Name and short name of a level (an empty short name removes it: the tab takes the name back). */
  function setLevelIdentity(levelId: string, ident: { name?: string; shortName?: string }): void {
    pushEdit({ levels: { [levelId]: ident } })
  }
  function setPropertyName(name: string): void { pushEdit({ propertyName: name }) }
  function addLevel(side: NewLevelSide): void {
    const v = editView.value
    if (!v) return
    const id = freeId('niveau', [...v.levels.map((l) => l.id), ...(editDraft.value?.newLevels ?? []).map((l) => l.id)])
    // "Floor 2" above a ground floor and a floor: we count the inhabited levels (or born
    // in the session), not the roof's empty level
    const born = new Set((editDraft.value?.newLevels ?? []).map((l) => l.id))
    const storeys = v.levels.filter((l) => born.has(l.id) || v.rooms.some((r) => r.levelId === l.id)).length
    const name = side === 'above' ? t('structure.newLevelAbove', { n: storeys }) : t('structure.newLevelBelow')
    pushEdit({ newLevels: [{ id, name, side }] })
    focusLevel(id)
  }
  /** A level is removed empty: no room, no device, no array, no spot, no roof on it. */
  function levelRemovable(levelId: string): boolean {
    const v = editView.value
    if (!v || v.levels.length <= 1) return false
    return !v.rooms.some((r) => r.levelId === levelId) && !v.devices.some((d) => d.levelId === levelId)
      && !v.site.parkings.some((p) => p.levelId === levelId) && !(v.arrays ?? []).some((a) => a.levelId === levelId)
      && v.roof?.levelId !== levelId
  }
  function removeLevel(levelId: string): void {
    if (!levelRemovable(levelId)) return
    pushEdit({ removeLevels: [levelId] })
    if (focusedLevelId.value === levelId) focusLevel(null)
  }

  // undoing, redoing or abandoning can make the room or the level we were looking at disappear:
  // we then go up to the house, rather than keeping a panel and a tab that show nothing
  watch(index, (ix) => {
    if (!ix) return
    if (selectedRoomId.value && !ix.roomsById.has(selectedRoomId.value) && !ix.zonesById.has(selectedRoomId.value)) selectRoom(null)
    if (focusedLevelId.value && !ix.levelsById.has(focusedLevelId.value)) focusLevel(null)
    if (placingRoom.value && !ix.levelsById.has(placingRoom.value)) placingRoom.value = null
  })

  const canUndoEdit = computed(() => editStep.value > 0)
  const canRedoEdit = computed(() => editStep.value < editHistory.value.length)
  function undoEdit() { if (canUndoEdit.value) editStep.value-- }
  function redoEdit() { if (canRedoEdit.value) editStep.value++ }
  /** Does the draft change anything about the written house? (choosing then going back does not count) */
  const editDirty = computed(() => !!editDraft.value && buildingOf(editView.value) !== buildingOf(house.value))
  /** What prevents writing the session: "Apply" stays grayed out as long as there is anything. */
  const editBlocking = computed<string[]>(() => editOutcome.value?.blocking ?? [])
  const editWarnings = computed<string[]>(() => editOutcome.value?.warnings ?? [])
  /** Abandons the draft: the scene goes back to the written house. */
  function discardEdit() { editHistory.value = []; editStep.value = 0; shapeTransient.value = null; dragBase = null; placingRoom.value = null }
  const savingEdit = ref(false)
  /** "Apply": the whole session at once; in case of refusal, the draft stays there. */
  async function saveEdit(): Promise<boolean> {
    const patch = editDraft.value
    if (!patch || !editDirty.value) { discardEdit(); return true }
    if (editBlocking.value.length) return false
    savingEdit.value = true
    try {
      house.value = await getTransport().saveEdit(patch)
      discardEdit()
      return true
    } catch (err) {
      useNotificationsStore().error(t('finish.saveError', { message: (err as Error).message }))
      return false
    } finally {
      savingEdit.value = false
    }
  }

  /** House device linked to a plugin id. */
  function houseDeviceFor(pluginDeviceId: string): HouseDevice | undefined {
    return index.value?.devicesByBinding.get(pluginDeviceId)
  }

  // ---- "Move" mode: the selected device is dragged in the 3D (x;y) and adjusted in
  // height from the panel; each drop is written to house.json by the server. -------------
  const placing = ref(false)
  const saving = ref(false)
  const draft = shallowRef<PlacementDraft | null>(null)
  /** Placement on entering the mode, for "Revert". */
  const placingOrigin = shallowRef<{ position: Vec3; roomId: string | undefined; levelId: string | null; mount: Mount | undefined; yaw: number | undefined; size: Size | undefined; leaves: Leaves | undefined } | null>(null)
  /**
   * The selected device, provided it is PLACED. All the placement gestures start from a
   * scene marker, and a device with no position has none: they therefore cannot target it.
   * This guard replaces a dozen scattered `!`.
   */
  const placedSelection = (): PlacedHouseDevice | null => {
    const hd = selectedDevice.value
    return hd && isPlaced(hd) ? hd : null
  }

  /** The level that anchors the device, whether through its room or directly. */
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
    // a provisional device never dropped disappears with the mode
    if (provisional.value && !house.value?.devices.some((d) => d.id === provisional.value!.id)) {
      // the panel stays on the plugin device (unplaced), which offers "Place" again
      if (selectedKey.value === provisional.value.id) selectedKey.value = provisional.value.deviceId ?? null
      provisional.value = null
    }
  }
  watch(selectedKey, (key) => { if (key !== provisional.value?.id) stopPlacing() })

  /**
   * Approximate center of a level: middle of the bounding box of its rooms (or of its outline).
   * A level with NO room nor outline — that is how a roof is declared — falls back on the footprint of the
   * whole building: without that, everything placed there landed at the house's origin, in a corner.
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
   * Places a plugin device that has no entry yet: provisional at the center of the displayed level
   * (or of the first one), at table height, selected, "Move" mode open. The level is changed
   * afterwards through the selector of the "Location" section (`setPlacementLevel`).
   */
/** Placement requested before the house or the inventory are there: replayed as soon as they arrive. */
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
  /** Level that anchors the device being placed (room or level alone), for the panel's selector. */
  const placementLevelId = computed<string | null>(() => {
    const p = provisional.value
    if (p) return p.levelId ?? null
    const hd = placedSelection()
    return hd ? anchorLevel(hd) : null
  })

  /**
   * Takes the device being placed to another level — from the "Location" section's SELECTOR,
   * and only from it. Until 2026-09-15 it was the level tab that did it:
   * a click to go and look elsewhere re-anchored the device without saying so (a living room light ended up
   * anchored to the roof). The tab now only navigates.
   *
   * A provisional device never dropped goes to the center of the chosen level; a device already placed keeps its x;y and
   * its height IN SPACE (see `moveToLevel`). The view follows: it is where the device is now.
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
   * Re-anchors the selected device on another level: x;y kept, room taken again under the point
   * (otherwise the level alone anchors — the case of a level without a room like the roof), and z taken again relative
   * to the new level's floor so that the device does not move in space.
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

  /** Preview of a ground position (3D drag); `roomId` null = outside any room → we keep the old one. */
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
   * Settings of a device that only the user can know: the offset of its place computed
   * by GPS, the correction of its orientation, the capacity of its battery (no vendor
   * gives it), a vehicle's lease, the leaves, material and color of a cover (a motor publishes a travel, not a
   * white wooden shutter). Same path as renaming: the house entry is created if needed, WITHOUT a position —
   * a vehicle has no written place. `[0, 0]` and `0` clear, as the empty string clears a name.
   */
  async function setDeviceTuning(pluginDeviceId: string, tuning: Pick<DevicePlacement, 'gpsOffset' | 'mapOffset' | 'yawOffset' | 'batteryKwh' | 'model3d' | 'bodyColor' | 'bodyFinish' | 'leaves' | 'coverMaterial' | 'coverColor' | 'speakerShape' | 'lease'>): Promise<boolean> {
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
   * The body tint SHOWN while it is being chosen, writing nothing: the scene paints it
   * at each movement of the picker, and `setDeviceTuning` only goes out on the validated choice — otherwise
   * each shade hovered would rewrite the house file. `null` gives back the previous tint, for
   * an abandoned choice.
   */
  const bodyColorPreview = shallowRef<{ key: string; color: string | null } | null>(null)
  function previewBodyColor(pluginDeviceId: string, color: string | null): void {
    bodyColorPreview.value = { key: houseDeviceFor(pluginDeviceId)?.id ?? pluginDeviceId, color }
  }

  /**
   * A device's LOG shown IN the scene: its positioned incidents, placed on the ground
   * while the panel unfolds it — that is how a failure is located. `null` removes everything.
   * `journalFocus`: the row the user has just chosen, on which the camera frames itself.
   * Same seam as the tint preview: the store says, `HomeView` passes it to the scene.
   */
  const journalOverlay = shallowRef<{ key: string; points: JournalPoint[] } | null>(null)
  const journalFocus = shallowRef<{ key: string; at: number } | null>(null)
  /** The ACTIVE incident (date): row chosen in the panel, or pin touched in the scene — both share it. */
  const journalActive = shallowRef<number | null>(null)
  function showJournal(pluginDeviceId: string, points: JournalPoint[]): void {
    journalOverlay.value = { key: houseDeviceFor(pluginDeviceId)?.id ?? pluginDeviceId, points }
  }
  function hideJournal(): void { journalOverlay.value = null; journalFocus.value = null; journalActive.value = null }
  /** A chosen row: the camera frames itself on it, and it becomes the active incident. */
  function focusJournalPoint(pluginDeviceId: string, at: number): void {
    journalFocus.value = { key: houseDeviceFor(pluginDeviceId)?.id ?? pluginDeviceId, at }
    journalActive.value = at
  }
  /** A pin touched in the scene: the active incident changes, the camera stays where it is. */
  function markJournalPoint(at: number | null): void { journalActive.value = at }

  /**
   * Renames a device in the house — WITHOUT placing it. It is the only possible path for a
   * device that has no place in the scene (a vehicle): its entry is created if needed, and
   * it has no position. An empty name CLEARS the chosen name, and the vendor's takes over again.
   */
  async function renameDevice(pluginDeviceId: string, name: string): Promise<boolean> {
    const hd = houseDeviceFor(pluginDeviceId)
    const placement: DevicePlacement = { name }
    // absent from the JSON: its `deviceId` is what gives it an entry
    if (!hd) placement.deviceId = pluginDeviceId
    try {
      house.value = await getTransport().placeDevice(hd?.id ?? houseIdForDevice(pluginDeviceId), placement)
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    }
  }

  /** Writes the draft (completed by `override`) to house.json; an auto-placed device gains its entry there. */
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
      else if (hd.meta.provisional && hd.levelId) p.levelId = hd.levelId   // dropped outside any room: the level anchors
      if (!p.mount && hd.mount) p.mount = hd.mount
    }
    // level change: the level only anchors outside any room (the server ignores `levelId`
    // when `roomId` is given, and clears the room when the level anchors alone)
    if (override?.levelId && !p.roomId) p.levelId = override.levelId
    saving.value = true
    try {
      house.value = await getTransport().placeDevice(hd.id, p)
      if (provisional.value?.id === hd.id) provisional.value = null       // the entry now exists in the reread house
      return true
    } catch (err) {
      useNotificationsStore().error(t('place.saveError', { message: (err as Error).message }))
      return false
    } finally {
      draft.value = null
      saving.value = false
    }
  }

  /** Selected device still provisional (never dropped): "Cancel" rather than "Done", nothing to remove. */
  const isProvisional = computed(() => !!selectedDevice.value && selectedDevice.value.id === provisional.value?.id)

  /**
   * Takes the selected device out of the house: its entry is removed from the JSON, it becomes auto-placed
   * or "unplaced" and the selection follows the plugin device (the panel stays open on it).
   * A provisional device never dropped is simply abandoned.
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

  // ---- panel arrays: an array is created, adjusted and dragged from the solar
  // installation's panel. The modules, for their part, are derived from the array (`panelArrayDevices`): there is
  // only one object to write, whatever the number of panels. -------------------------------------
  const editingArrayId = ref<string | null>(null)
  /** Origin during a DRAG (3D preview), not yet written to house.json. */
  const arrayDraft = shallowRef<Vec3 | null>(null)
  /**
   * Slot highlighted from the inverter grid (hovering a cell): the scene lights up the
   * matching module. It is the thread that links the two — without it, one fills a grid without
   * knowing which roof panel one is naming.
   */
  const hoveredKey = ref<string | null>(null)
  const hoverSlot = (key: string | null) => { hoveredKey.value = key }
  const arrays = computed<PanelArray[]>(() => house.value?.arrays ?? [])
  /**
   * An installation's arrays: those that name it (`siteId`), plus those that name no one
   * — a hand-written file has no reason to say it, and a house has only one solar
   * installation. It is this link that the installation's removal follows to take its arrays with it.
   */
  const arraysOf = (siteDeviceId: string) => arrays.value.filter((a) => !a.siteId || a.siteId === siteDeviceId)
  const editingArray = computed<PanelArray | null>(() => arrays.value.find((a) => a.id === editingArrayId.value) ?? null)
  /** Modules of the array being edited, draft origin included: what the scene must show. */
  const editingArrayModules = computed<HouseDevice[]>(() => {
    const a = editingArray.value
    if (!a) return []
    return panelArrayDevices(arrayDraft.value ? { ...a, origin: arrayDraft.value } : a)
  })

  /**
   * The level that carries the panels: the displayed one if it has NO room (that is how a roof is
   * declared, see the wiki), otherwise the last level without a room, otherwise the highest. An array placed by
   * default on the living room would be seen right away; an array without a level would not be written at all.
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
   * Inverters of this installation that no array carries and that no house entry places:
   * these are the ones that can be assigned to a slot. An inverter is a POWER sensor of the same
   * plugin as the site (Enphase publishes one per module, so does the simulation).
   *
   * SORTED by name, digits included (`numeric`): the gateway announces them in its own order, and
   * finding a serial number among twenty rows in disorder, installation plan in hand, is
   * a treasure hunt. It is also the order in which a new array fills up.
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
   * Installation from which the array is adjusted: an array that did not say where it came from (written
   * by hand, or before `siteId` existed) ADOPTS it at the first adjustment. Otherwise it would remain
   * anonymous forever, and would not leave with its installation.
   */
  const editingArraySite = ref<string | null>(null)

  /**
   * Height at which an array is placed, measured from the floor of the panels' level: the TOP of the
   * roof. A flat roof is a 20 cm slab placed on the walls, and the roof level is declared at its
   * base: an array at 0 was buried in it, invisible and impossible to grab by eye. A gable
   * roof starts, for its part, from the eaves plane (0) and rises with its slope.
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
    // the array lives on the roof: we display it, otherwise we would be adjusting an array we cannot see
    gardenFocus.value = false
    focusedLevelId.value = a.levelId
  }
  function stopEditingArray() { editingArrayId.value = null; editingArraySite.value = null; arrayDraft.value = null; hoveredKey.value = null }

  /**
   * Adjusts an array from ELSEWHERE than the installation's card (a module's panel): we jump
   * to the installation that carries it — its panel carries the card — then open the adjustment.
   *
   * This order is the right one: `selectDevice` frames the level of the INSTALLATION (it may be on the
   * ground floor), and it is `startEditingArray`, afterwards, that brings back to the ARRAY's level. The
   * selection guard, for its part, only runs after both and sees a consistent adjustment.
   */
  function editArray(arrayId: string) {
    const a = arrays.value.find((x) => x.id === arrayId)
    if (!a) return
    const siteId = siteOf(a)
    if (siteId) selectDevice(index.value?.devicesByBinding.get(siteId)?.id ?? siteId)
    startEditingArray(arrayId, siteId)
  }
  // Leaving the solar installation closes the adjustment: the card that carried it is no longer there.
  // ARRIVING there, on the other hand, does not close it — it is what allows opening an array from the
  // panel of one of its modules (we jump to the installation, the adjustment follows).
  watch(selectedKey, (key) => {
    const site = editingArraySite.value
    const hd = key ? index.value?.devicesById.get(key) : undefined
    if (!site || (key !== site && hd?.deviceId !== site)) stopEditingArray()
  })

  /**
   * New array: two rows of five, placed at the center of the panels' level, tilted like the
   * roof, and EMPTY. Empty, because the order of the serial numbers has no reason to follow the
   * roof layout: an automatic fill was almost certainly wrong, and everything had to be
   * undone by hand before being able to place each inverter at its real place.
   *
   * It is born NAMED and attached to its installation: the name serves as a mark on screen (even on
   * modules without an inverter), and `siteId` makes it leave with it if it is removed from the house.
   */
  async function addArray(siteDeviceId: string): Promise<boolean> {
    const levelId = panelLevelId()
    if (!levelId) return false
    const used = new Set(arrays.value.map((a) => a.id))
    let id = 'pv'
    for (let n = 1; used.has(id); n++) id = `pv-${n}`
    const [x, y] = levelCentre(levelId)
    // The array faces where its INSTALLATION faces: we orient the gateway toward the south as we
    // orient its panels, and the array no longer has a reason to go in another direction.
    const yaw = index.value?.devicesByBinding.get(siteDeviceId)?.yaw ?? 0
    const ok = await writeArray(id, {
      name: t('arrays.field', { n: arraysOf(siteDeviceId).length + 1 }),
      siteId: siteDeviceId,
      levelId, origin: [x, y, panelBaseZ(levelId)], rows: 2, cols: 5, yaw,
      // The array HUGS the roof: the support's slope comes from the roofing — 0 on a flat roof (the
      // schema still gives a default slope to `roof`, which means nothing there). The tilt
      // of the MODULES, for its part, is not invented: it is the frame, and we do not know what is mounted.
      slope: house.value?.roof?.type === 'gable' ? house.value.roof.pitch : 0,
    })
    if (ok) startEditingArray(id, siteDeviceId)
    return ok
  }

  /** Writes an array (creation or adjustment); the rewritten house comes back from the server. */
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

  /** Adjusts the array being edited (and attaches it to its installation if it was not). */
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
   * Drag preview: one grabs ANY module and the whole array follows, so the
   * origin moves by the same gap as the grabbed module. The gap is always measured from the
   * module's WRITTEN position (the house only moves on drop): nothing accumulates.
   */
  function previewArrayOrigin(key: string, xy: [number, number]) {
    const a = editingArray.value
    const hd = index.value?.devicesById.get(key)
    if (!a || !hd || !isPlaced(hd)) return
    arrayDraft.value = [snap(a.origin[0] + xy[0] - hd.position[0]), snap(a.origin[1] + xy[1] - hd.position[1]), a.origin[2]]
  }
  /** Drop: the draft's origin becomes the array's. */
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
    // an orientation absent on entry cannot be cleared from the JSON: we bring it back to 0, which is worth the same
    // (same reasoning for the size: we rewrite the default one, which gives the same drawing)
    await savePlacement({
      ...(o.mount ? { mount: o.mount } : {}),
      ...(o.yaw !== hd.yaw ? { yaw: o.yaw ?? 0 } : {}),
      ...(!sameSize(o.size, hd.size) ? { size: o.size ?? { ...defaultCoverSize(hd.deviceId ? devices.descriptors[hd.deviceId] : undefined) } } : {}),
      // same reasoning: a number of leaves absent on entry is restored by its default
      ...(o.leaves !== hd.leaves ? { leaves: o.leaves ?? coverLeaves({ ...hd, leaves: undefined }, hd.deviceId ? devices.descriptors[hd.deviceId] : undefined) } : {}),
      // entry level: only if there is no room to anchor it, otherwise the level would CLEAR the room
      ...(!o.roomId && o.levelId && o.levelId !== anchorLevel(hd) ? { levelId: o.levelId } : {}),
    })
  }

  // ---- edit mode: adjustment of an OPENING ---------------------------------------------------
  //
  // The survey of a real house is approximate: windows and doors are adjusted here, while
  // looking at the 3D. The measurements are entered in the panel, the place is dragged along the walls of
  // the room. Each finished gesture is written to house.json by the server, like a placement.
  //
  // An opening is neither created nor removed from here: it is born from the survey, the UI only adjusts it.
  const savingOpening = ref(false)
  /** Measurements at selection, for "Revert" — the opening as it was found. */
  const openingOrigin = shallowRef<OpeningPatch | null>(null)

  /** The selected opening, draft included: it is the one the panel DISPLAYS. */
  const selectedOpening = computed(() => findOpening(effective.value, selectedOpeningId.value))
  /** The same, as it is WRITTEN: it is the one compared to know whether there is anything to revert. */
  const savedOpening = computed(() => findOpening(house.value, selectedOpeningId.value))

  function selectOpening(id: string | null) {
    openingDraft.value = null
    selectedOpeningId.value = id
    const sel = findOpening(house.value, id)
    openingOrigin.value = sel
      ? {
        type: sel.opening.type, segment: sel.opening.segment, offset: sel.opening.offset,
        x: sel.opening.x, y: sel.opening.y, yaw: sel.opening.yaw,
        width: sel.opening.width, height: sel.opening.height,
        sill: openingSill(sel.opening, resolveDefaults(house.value?.defaults)),
        // the joinery is reverted like the measurements; absent at selection, it is REMOVED (empty
        // string) rather than frozen on the deduced value
        leaves: sel.opening.leaves ?? '', material: sel.opening.material ?? '', color: sel.opening.color ?? '',
      }
      : null
    if (!sel) return
    // an opening's panel reads under its room; it is what gives the breadcrumb and the framing
    selectedKey.value = null
    selectedLevelId.value = null
    selectedRoomId.value = sel.room.id
    gardenFocus.value = false
    // Roof window: stay on the roof level (otherwise the roof hides and the handle seems to be on the ground).
    if (sel.opening.type === 'roof-window' && house.value) {
      const roofDesc = computeRoof(house.value, resolveDefaults(house.value.defaults))
      const roofTab = roofDesc
        ? house.value.levels.find((l) => l.elevation >= roofDesc.zBase - 1e-3)
        : undefined
      focusedLevelId.value = roofTab?.id ?? sel.room.levelId
    } else {
      focusedLevelId.value = sel.room.levelId
    }
  }

  /** Ceiling height of the room that carries the opening: the upper bound of its measurements. */
  const openingCeiling = computed(() => {
    const sel = savedOpening.value
    const level = sel ? index.value?.levelsById.get(sel.room.levelId) : undefined
    return sel && level && house.value ? roomHeight(sel.room, level, resolveDefaults(house.value.defaults)) : 0
  })

  /** Bounds of the panel's fields, at the opening's current place (neighbors, ceiling). */
  const openingBounds = computed(() => {
    const sel = selectedOpening.value
    if (!sel || !house.value) return null
    const siblings = index.value?.roomsByLevel.get(sel.room.levelId) ?? [sel.room]
    return openingLimits(sel.room, siblings, resolveDefaults(house.value.defaults), sel.opening, openingCeiling.value)
  })

  /**
   * Drag: the point grabbed in the 3D becomes the nearest admissible place on the room's
   * OUTLINE — the opening runs along its wall and moves on to the next at the corner. A point
   * that no wall can receive moves nothing: the opening stops short instead of jumping.
   */
  function previewOpeningAt(xy: Vec2) {
    const sel = selectedOpening.value
    if (!sel || !house.value) return
    if (isSurfaceOpening(sel.opening.type)) {
      // a Velux on a roof slope slides on its FOOTPRINT at the targeted point: heading of the descent, length
      // shortened by the slope (`surfaceFootprint`) — it can thus approach the wall at its true size
      const roofDesc = sel.opening.type === 'roof-window' ? computeRoof(house.value, resolveDefaults(house.value.defaults)) : undefined
      const fp = surfaceFootprint({
        type: sel.opening.type, x: xy[0], y: xy[1], yaw: sel.opening.yaw ?? 0, width: sel.opening.width, height: sel.opening.height,
      }, roofDesc)
      const slot = slotFromSurfacePoint(sel.room, xy, fp.yaw, fp.width, fp.height)
      if (!slot) return
      if (Math.abs(slot.x - (sel.opening.x ?? 0)) < 0.005 && Math.abs(slot.y - (sel.opening.y ?? 0)) < 0.005) return
      openingDraft.value = { ...openingDraft.value, x: slot.x, y: slot.y }
      return
    }
    if (sel.opening.segment === undefined || sel.opening.offset === undefined) return
    const siblings = index.value?.roomsByLevel.get(sel.room.levelId) ?? [sel.room]
    // `from` = where it is at the moment: it is what makes it STOP at a neighbor instead of
    // jumping over it. Going to the other side is done by going around the room.
    const here = { segment: sel.opening.segment, offset: sel.opening.offset }
    const slot = slotFromPoint(sel.room, siblings, resolveDefaults(house.value.defaults), xy, sel.opening.width, sel.opening.id, here)
    if (!slot) return
    if (slot.segment === sel.opening.segment && Math.abs(slot.offset - sel.opening.offset) < 0.005) return
    openingDraft.value = { ...openingDraft.value, segment: slot.segment, offset: snapCm(slot.offset) }
  }

  /**
   * Writes the draft (completed by `patch`) to house.json. The panel's measurements go through here
   * directly — a "+" key is a finished gesture, it has no draft to carry.
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

  /** End of the drag: the draft becomes the opening's place. */
  async function dropOpening(): Promise<void> { if (openingDraft.value) await saveOpening() }

  const canRevertOpening = computed(() => {
    const o = openingOrigin.value, sel = savedOpening.value
    if (!o || !sel || !house.value) return false
    const s = sel.opening
    return o.type !== s.type || o.segment !== s.segment || o.offset !== s.offset
      || o.x !== s.x || o.y !== s.y || o.yaw !== s.yaw
      || o.width !== s.width || o.height !== s.height
      || o.sill !== openingSill(s, resolveDefaults(house.value.defaults))
      || o.leaves !== (s.leaves ?? '') || o.material !== (s.material ?? '') || o.color !== (s.color ?? '')
  })
  /** Reverts the measurements found at selection; the sill absent from the JSON is reverted by its value, which gives the same wall. */
  async function revertOpening(): Promise<void> {
    if (openingOrigin.value) await saveOpening(openingOrigin.value)
  }

  // --- placing and removing an opening --------------------------------------
  //
  // PLACING is done in two steps: a kind is chosen in the room's panel (the opening is
  // then ARMED, nothing is written), then the wall is tapped in the 3D. The touched point decides the wall AND
  // the place by the same rule as the drag (`slotFromPoint`), so what is born is always
  // at a spot the server accepts — never an opening placed blindly that would then
  // have to be fetched.
  const placingOpening = shallowRef<{ roomId: string; type: OpeningType } | null>(null)

  /** Arms a kind. Wall / floor: selected room required. Roof: room optional (resolved on tap). */
  function startPlacingOpening(type: OpeningType) {
    selectOpening(null)
    if (type === 'roof-window') {
      placingOpening.value = { roomId: selectedRoom.value?.id ?? '', type }
      // Switches to the roof level to see and tap the roofing (from a floor, the roof is hidden).
      const h = house.value
      if (h) {
        const roofDesc = computeRoof(h, resolveDefaults(h.defaults))
        const roofTab = roofDesc
          ? h.levels.find((l) => l.elevation >= roofDesc.zBase - 1e-3)
          : undefined
        if (roofTab) focusLevel(roofTab.id)
      }
      return
    }
    const room = selectedRoom.value
    if (!room) return
    placingOpening.value = { roomId: room.id, type }
  }
  function cancelPlacingOpening() { placingOpening.value = null }
  // leaving the room disarms — except a roof placement without a room (empty roomId), which survives the tab change
  watch(selectedRoomId, (id) => {
    const armed = placingOpening.value
    if (armed?.roomId && armed.roomId !== id) placingOpening.value = null
  })

  /** Free id for a new opening: its kind, numbered if needed (like `addArray`). */
  function freeOpeningId(type: OpeningType): string {
    const used = new Set((house.value?.rooms ?? []).flatMap((r) => r.openings.map((o) => o.id)))
    let id: string = type
    for (let n = 2; used.has(id); n++) id = `${type}-${n}`
    return id
  }

  /**
   * The tapped wall / floor / roof: the opening is born there, with the measurements of its kind (`newOpeningDims`), and
   * becomes the selection — it was placed to be adjusted.
   */
  async function placeOpeningAt(xy: Vec2): Promise<void> {
    const armed = placingOpening.value
    if (!armed || !house.value) return
    let room = armed.roomId ? index.value?.roomsById.get(armed.roomId) : undefined
    if (!room && armed.type === 'roof-window') {
      const carrierId = house.value.roof?.levelId
      const candidates = house.value.rooms.filter((r) => !carrierId || r.levelId === carrierId)
      room = candidates.find((r) => pointInPolygon(xy, r.polygon))
      if (!room) {
        useNotificationsStore().error(t('opening.addNoRoomUnderRoof'))
        return
      }
    }
    const level = room ? index.value?.levelsById.get(room.levelId) : undefined
    if (!room || !level) return
    const defaults = resolveDefaults(house.value.defaults)
    const dims = newOpeningDims(armed.type, defaults)
    const id = freeOpeningId(armed.type)
    savingOpening.value = true
    try {
      if (isSurfaceOpening(armed.type)) {
        let yaw = 0
        let planHeight = dims.height
        if (armed.type === 'roof-window') {
          // on a roof slope: heading of the descent, length seen from the sky shortened by the slope
          const fp = surfaceFootprint({ type: armed.type, x: xy[0], y: xy[1], yaw: 180, width: dims.width, height: dims.height }, computeRoof(house.value, defaults))
          yaw = fp.yaw
          planHeight = fp.height
        }
        const slot = slotFromSurfacePoint(room, xy, yaw, dims.width, planHeight)
        if (!slot) {
          useNotificationsStore().error(t('opening.addNoSpaceSurface', { width: dims.width.toFixed(2) }))
          placingOpening.value = null
          return
        }
        const next = await getTransport().addOpening(room.id, {
          id, type: armed.type, x: slot.x, y: slot.y, yaw: slot.yaw,
          width: dims.width, height: dims.height,
        })
        placingOpening.value = null
        house.value = next
        selectOpening(id)
        return
      }
      const siblings = index.value?.roomsByLevel.get(room.levelId) ?? [room]
      const slot = slotFromPoint(room, siblings, defaults, xy, dims.width, '')
      if (!slot) {
        useNotificationsStore().error(t('opening.addNoSpace', { width: dims.width.toFixed(2) }))
        placingOpening.value = null
        return
      }
      const fitted = fitHeight(dims.sill, dims.height, roomHeight(room, level, defaults), dims.height)
      const next = await getTransport().addOpening(room.id, {
        id, type: armed.type, segment: slot.segment, offset: snapCm(slot.offset),
        width: dims.width, height: fitted.height, sill: fitted.sill,
      })
      placingOpening.value = null
      house.value = next
      selectOpening(id)
    } catch (err) {
      useNotificationsStore().error(t('opening.saveError', { message: (err as Error).message }))
      placingOpening.value = null
    } finally {
      savingOpening.value = false
    }
  }

  /**
   * Removes the selected opening. We go back to its ROOM: it is from there that it was placed, and it is
   * there that one sees the wall close up again. The cover that dressed it is released by the server, in the
   * same write (`removeOpeningFromJson`).
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

  // --- parking spots ---------------------------------------------
  //
  // A car and a robot are placed from their GPS, which is good to within a few meters: that is
  // enough to say "it is back home", not to put it in its garage. A SPOT says where the machine
  // is stored when it is at rest nearby (`assignParkings`, shared with the scene).
  //
  // The gesture is that of the openings, on the ground: a kind is armed in the house panel, the place is
  // tapped in the 3D, then the four measurements are adjusted — what separates the spot from the outline of
  // its host (the garage, the driveway) — or it is dragged with a finger.
  const savingParking = ref(false)
  /**
   * Spot armed, waiting for the point to be tapped in the 3D. `levelId` comes from a ROOM's
   * panel ("add a spot in this garage"): the level is then decided in advance, and the tap
   * only gives the point. Armed from the house, it is the touched surface that decides.
   */
  const placingParking = shallowRef<{ accepts: DeviceKind; deviceId?: string; levelId?: string } | null>(null)

  /** The selected spot, draft included: it is the one the panel DISPLAYS. */
  const selectedParking = computed<Parking | null>(
    () => effective.value?.site.parkings.find((p) => p.id === selectedParkingId.value) ?? null)
  /** The same, as it is WRITTEN. */
  const savedParking = computed<Parking | null>(
    () => house.value?.site.parkings.find((p) => p.id === selectedParkingId.value) ?? null)

  /**
   * The spots placed IN a room: those whose host is this room. It is what the panel
   * of a room in edit mode lists — one adds a garage spot from the garage, not from
   * a list of the whole house.
   */
  const parkingsInRoom = (roomId: string) => parkings.value.filter((p) => {
    const h = house.value ? parkingHost(house.value, p) : null
    return h?.kind === 'room' && h.id === roomId
  })

  /** What CARRIES the selected spot (room, zone or terrain): the four measurements are taken there. */
  const parkingHostOf = computed(() => {
    const p = selectedParking.value
    return p && effective.value ? parkingHost(effective.value, p) : null
  })
  /** The four measurements of the selected spot, as the panel and the scene show them. */
  const parkingGapsOf = computed<Record<ParkingSide, number | null> | null>(() => {
    const p = selectedParking.value, host = parkingHostOf.value
    return p && host ? parkingGaps(host.polygon, p) : null
  })

  function selectParking(id: string | null) {
    parkingDraft.value = null
    selectedParkingId.value = id
    if (!id) return
    // a spot is adjusted from the house: no room nor device selected, the breadcrumb goes back there
    selectedKey.value = null
    selectedOpeningId.value = null
    // Placed in a room (a garage), it is its LEVEL that we look at: otherwise we would adjust the markings
    // of a garage through the roof. It is the store that says so, as for an opening, so that
    // the level tab (`floorTab`) shows it instead of contradicting the scene.
    const p = house.value?.site.parkings.find((x) => x.id === id)
    const host = p && house.value ? parkingHost(house.value, p) : null
    const room = host?.kind === 'room' ? index.value?.roomsById.get(host.id) : undefined
    if (room) { focusedLevelId.value = room.levelId; gardenFocus.value = false }
  }

  /** Drag: the grabbed point becomes the CENTER of the spot. On the ground, nothing constrains it. */
  function previewParkingAt(xy: Vec2) {
    const p = savedParking.value
    if (!p) return
    parkingDraft.value = { ...parkingDraft.value, center: [snapCm(xy[0]), snapCm(xy[1])] }
  }

  /** Writes the draft (completed by `patch`) to house.json. */
  async function saveParking(patch?: ParkingPatch): Promise<boolean> {
    const p = savedParking.value
    if (!p) return false
    const body: ParkingPatch = { ...parkingDraft.value, ...patch }
    if (Object.keys(body).length === 0) return true
    savingParking.value = true
    try {
      house.value = await getTransport().saveParking(p.id, body)
      return true
    } catch (err) {
      useNotificationsStore().error(t('parking.saveError', { message: (err as Error).message }))
      return false
    } finally {
      parkingDraft.value = null
      savingParking.value = false
    }
  }

  /** End of the drag: the draft becomes the spot's place. */
  async function dropParking(): Promise<void> { if (parkingDraft.value) await saveParking() }

  /**
   * Measurement wanted on a side → the spot SLIDES by what is missing (`fitParkingGap`), the other measurements
   * follow. It is the rule of the opening measurements: we keep what was typed, we move what
   * can be moved, rather than trimming silently.
   */
  async function setParkingGap(side: ParkingSide, wanted: number): Promise<boolean> {
    const p = savedParking.value, host = parkingHostOf.value
    if (!p || !host) return false
    const center = fitParkingGap(host.polygon, p, side, wanted)
    return center ? saveParking({ center }) : false
  }

  /** Arms a spot: we choose what goes in it, then tap the place in the 3D. */
  function startPlacingParking(accepts: DeviceKind, deviceId?: string, levelId?: string) {
    selectParking(null)
    placingParking.value = { accepts, ...(deviceId ? { deviceId } : {}), ...(levelId ? { levelId } : {}) }
  }
  function cancelPlacingParking() { placingParking.value = null }

  /** Free id for a new spot: what goes in it, numbered if needed (like `freeOpeningId`). */
  function freeParkingId(accepts: DeviceKind): string {
    const used = new Set((house.value?.site.parkings ?? []).map((p) => p.id))
    let id = `park.${accepts}`
    for (let n = 2; used.has(id); n++) id = `park.${accepts}-${n}`
    return id
  }

  /**
   * The tapped place: the spot is born there, with the catalog measurements of what goes in it
   * (`newParkingSize`), oriented like the room that carries it when there is one — a garage stores
   * a car in its direction, and that is better than north. It becomes the selection: it was placed
   * to be adjusted.
   */
  async function placeParkingAt(xy: Vec2, levelId?: string | null): Promise<void> {
    const armed = placingParking.value
    if (!armed || !house.value) return
    // The level imposed by the room from which we armed wins over the touched surface: we said "in
    // this garage", a finger sliding on the neighboring lawn must not change its mind for us.
    const level = armed.levelId ?? levelId ?? undefined
    const size = newParkingSize(armed.accepts)
    const probe = {
      id: '', accepts: armed.accepts, center: [snapCm(xy[0]), snapCm(xy[1])] as Vec2, size, yaw: 0,
      ...(level ? { levelId: level } : {}),
    }
    const host = parkingHost(house.value, probe)
    // A room's axis comes back in `[-180, 180]`; we write it in `[0, 360[`, the convention of
    // oriented devices — otherwise the panel would display "-90°" where it shows "270°".
    const axis = host?.kind === 'room' ? longestEdgeYawDeg(host.polygon) ?? 0 : 0
    const yaw = ((axis % 360) + 360) % 360
    const id = freeParkingId(armed.accepts)
    savingParking.value = true
    try {
      const next = await getTransport().addParking({
        id, accepts: armed.accepts, ...(armed.deviceId ? { deviceId: armed.deviceId } : {}),
        ...(level ? { levelId: level } : {}),
        center: probe.center, size, yaw: snapCm(yaw),
      })
      placingParking.value = null
      house.value = next
      selectParking(id)
    } catch (err) {
      useNotificationsStore().error(t('parking.saveError', { message: (err as Error).message }))
    } finally {
      savingParking.value = false
    }
  }

  /** The spot reserved for this device, if it has one: a robot's base (Robots view, panel). */
  const dockFor = (deviceId: string) => parkings.value.find((p) => p.deviceId === deviceId) ?? null

  /** Removes the selected spot: the machine that was stored there goes back to its GPS point. */
  async function removeParking(): Promise<boolean> {
    const p = savedParking.value
    if (!p) return false
    savingParking.value = true
    try {
      const next = await getTransport().removeParking(p.id)
      selectParking(null)
      house.value = next
      return true
    } catch (err) {
      useNotificationsStore().error(t('parking.saveError', { message: (err as Error).message }))
      return false
    } finally {
      savingParking.value = false
    }
  }

  // --- garden (trees, bushes, stones) ------------------------------------
  //
  // Decor, placed like a spot: a family is armed in the house panel, the lawn is tapped,
  // then the height and the heading are adjusted, or the item is dragged with a finger.
  const savingGarden = ref(false)
  /** Family (and possibly species) armed, waiting for the point to be tapped on the terrain. */
  const placingGarden = shallowRef<{ kind: GardenKind; species?: string } | null>(null)
  /** The selected item, draft included (the one the panel DISPLAYS). */
  const selectedGardenItem = computed<GardenItem | null>(
    () => effective.value?.site.garden.find((g) => g.id === selectedGardenId.value) ?? null)
  const savedGardenItem = computed<GardenItem | null>(
    () => house.value?.site.garden.find((g) => g.id === selectedGardenId.value) ?? null)

  function selectGardenItem(id: string | null) {
    gardenDraft.value = null
    selectedGardenId.value = id
    if (!id) return
    // a garden item is adjusted from the house, like a spot
    selectedKey.value = null
    selectedOpeningId.value = null
    selectedParkingId.value = null
  }

  /** Preview without writing (drag, height slider): the scene follows, the file waits. */
  function previewGardenItem(patch: GardenItemPatch) {
    if (!savedGardenItem.value) return
    gardenDraft.value = { ...gardenDraft.value, ...patch }
  }
  function previewGardenAt(xy: Vec2) { previewGardenItem({ center: [snapCm(xy[0]), snapCm(xy[1])] }) }

  /** Writes the draft (completed by `patch`) to house.json. */
  async function saveGardenItem(patch?: GardenItemPatch): Promise<boolean> {
    const g = savedGardenItem.value
    if (!g) return false
    const body: GardenItemPatch = { ...gardenDraft.value, ...patch }
    if (Object.keys(body).length === 0) return true
    savingGarden.value = true
    try {
      house.value = await getTransport().saveGardenItem(g.id, body)
      return true
    } catch (err) {
      useNotificationsStore().error(t('garden.saveError', { message: (err as Error).message }))
      return false
    } finally {
      gardenDraft.value = null
      savingGarden.value = false
    }
  }
  async function dropGardenItem(): Promise<void> { if (gardenDraft.value) await saveGardenItem() }

  /** Another shape for the same item: a new seed, nothing else changes. */
  function reshapeGardenItem(): Promise<boolean> {
    return saveGardenItem({ seed: Math.floor(Math.random() * 1_000_000) })
  }

  function startPlacingGarden(kind: GardenKind, species?: string) {
    selectGardenItem(null)
    placingGarden.value = { kind, ...(species ? { species } : {}) }
  }
  function cancelPlacingGarden() { placingGarden.value = null }

  function freeGardenId(kind: GardenKind): string {
    const used = new Set((house.value?.site.garden ?? []).map((g) => g.id))
    let n = 1
    while (used.has(`garden.${kind}-${n}`)) n++
    return `garden.${kind}-${n}`
  }

  /**
   * The point tapped on the terrain: the item is born there at its family's typical height, with a heading
   * drawn at random (a row of trees placed one by one does not look cloned). The arming stays raised:
   * one often plants several trees in a row — "Done" or a tap beside it lowers it.
   */
  async function placeGardenAt(xy: Vec2): Promise<void> {
    const armed = placingGarden.value
    if (!armed || !house.value) return
    const { kind, species } = armed
    const recipe = speciesOf({ kind, species })
    const id = freeGardenId(kind)
    savingGarden.value = true
    try {
      house.value = await getTransport().addGardenItem({
        id, kind, center: [snapCm(xy[0]), snapCm(xy[1])], height: recipe?.height ?? GARDEN_DEFAULT_HEIGHT[kind],
        yaw: Math.floor(Math.random() * 360), ...(recipe ? { species: recipe.id } : {}),
      })
    } catch (err) {
      useNotificationsStore().error(t('garden.saveError', { message: (err as Error).message }))
    } finally {
      savingGarden.value = false
    }
  }

  async function removeGardenItem(): Promise<boolean> {
    const g = savedGardenItem.value
    if (!g) return false
    savingGarden.value = true
    try {
      const next = await getTransport().removeGardenItem(g.id)
      selectGardenItem(null)
      house.value = next
      return true
    } catch (err) {
      useNotificationsStore().error(t('garden.saveError', { message: (err as Error).message }))
      return false
    } finally {
      savingGarden.value = false
    }
  }

  /** Plugin descriptor of a house device (a cover's kind depends on it). */
  const descriptorOf = (d: HouseDevice) => (d.deviceId ? devices.descriptors[d.deviceId] : undefined)

  /** The covers placed on a given opening. An opening carries only one; the list serves to release the old one. */
  const coversOn = (openingId: string) => (effective.value?.devices ?? [])
    .filter((d) => d.openingId === openingId && (descriptorOf(d)?.kind ?? d.kind) === 'cover')

  /** House devices (shutter, sensor) that dress the selected opening. */
  const openingDevices = computed<HouseDevice[]>(() => {
    const id = selectedOpeningId.value
    return id ? (effective.value?.devices ?? []).filter((d) => d.openingId === id) : []
  })

  /**
   * Covers that AWAIT an opening: those whose kind has no meaning without the window
   * they dress (`expectsOpening`) and that no opening carries yet.
   *
   * It is a work list, not an anomaly: the house is drawn, the Somfy plugin is activated
   * months later, and six shutters arrive at once without knowing where they go. It empties as
   * they are assigned.
   *
   * Not to be confused with an "unlinked" device, which has no link to a
   * PLUGIN device (`deviceId` absent, displayed grayed out): here the link to the vendor exists, it is the place
   * in the house that is missing.
   */
  const coversWithoutOpening = computed<HouseDevice[]>(() => (effective.value?.devices ?? [])
    .filter((d) => !d.openingId && (descriptorOf(d)?.kind ?? d.kind) === 'cover' && expectsOpening(descriptorOf(d))))

  /**
   * Assigns an opening to a cover, or removes it (`null`). **The only write of the link**:
   * an opening's panel and the Covers view both go through it, each in its own direction,
   * so that the rule lives in a single place.
   *
   * An opening carries only one cover: the one that was there is released first. The server, for its part,
   * re-anchors the device on the room that carries the opening (see `placeDeviceInJson`).
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
   * Same link, seen from the selected OPENING: we choose its cover, or "none", which
   * releases the one that was there.
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

  /**
   * Same link, for a plugin cover that has NO house entry yet: the plugin was activated after the
   * opening was drawn, and its door has no room to be auto-placed in. The entry is created right
   * on the opening, which gives it the room that carries it — no "Place" detour through the scene.
   * The position is only a seed: the server aligns it on the bay's centre (`alignDevicesOnOpenings`).
   */
  async function setOpeningPluginDevice(pluginDeviceId: string): Promise<boolean> {
    const openingId = selectedOpeningId.value
    if (!openingId) return false
    savingOpening.value = true
    try {
      for (const d of coversOn(openingId)) house.value = await getTransport().placeDevice(d.id, { openingId: '' })
      house.value = await getTransport().placeDevice(houseIdForDevice(pluginDeviceId), { deviceId: pluginDeviceId, openingId, position: [0, 0, 0] })
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
    roomFinish, facadeFinish, setRoomFinish, setFacadeFinish, canUndoEdit, canRedoEdit, undoEdit, redoEdit, editDirty, editBlocking, editWarnings, discardEdit, savingEdit, saveEdit,
    coupleWalls, shapeEditing, shapeSelection, shapeOf, pushRoomWall, setSideLength, addCorner, removeCorner, beginShapeDrag, previewRoomWall, previewCorner, endShapeDrag,
    placingRoom, roomTargetLevelId, startPlacingRoom, cancelPlacingRoom, placeRoomAt, addRoomAgainstWall, removeRoom, setRoomIdentity, setLevelIdentity, setPropertyName, addLevel, levelRemovable, removeLevel,
    load, setFloorTab, focusLevel, selectRoom, selectLevel, selectDevice, clearSelection, backToHome, backFromRoom, backFromDevice, houseDeviceFor, renameDevice, setDeviceTuning, bodyColorPreview, previewBodyColor, setRoomOrder, saveRenderTuning, saveRelief, saveTerrain, saveOrigin,
    journalOverlay, journalFocus, journalActive, showJournal, hideJournal, focusJournalPoint, markJournalPoint,
    placing, saving, draft, canRevert, isProvisional, startPlacing, startPlacingNew, stopPlacing, previewPosition, previewHeight, savePlacement, revertPlacement, removePlacement,
    placementLevelId, setPlacementLevel,
    selectedOpeningId, selectedOpening, savedOpening, openingDraft, openingBounds, openingCeiling, openingDevices, savingOpening, canRevertOpening,
    placingOpening, startPlacingOpening, cancelPlacingOpening, placeOpeningAt, removeOpening,
    selectOpening, previewOpeningAt, saveOpening, dropOpening, revertOpening, setOpeningDevice, setOpeningPluginDevice, setCoverOpening, coversWithoutOpening,
    parkings, parkingsInRoom, selectedParkingId, selectedParking, savedParking, parkingHostOf, parkingGapsOf, savingParking, placingParking,
    dockFor,
    selectParking, previewParkingAt, saveParking, dropParking, setParkingGap,
    startPlacingParking, cancelPlacingParking, placeParkingAt, removeParking,
    gardenItems, selectedGardenId, selectedGardenItem, savedGardenItem, savingGarden, placingGarden,
    selectGardenItem, previewGardenItem, previewGardenAt, saveGardenItem, dropGardenItem, reshapeGardenItem,
    startPlacingGarden, cancelPlacingGarden, placeGardenAt, removeGardenItem,
    arrays, arraysOf, editingArrayId, editingArray, editingArrayModules, arrayDraft, hoveredKey, hoverSlot, freeInverters,
    startEditingArray, stopEditingArray, editArray, siteOf, siteOfDevice, addArray, saveArray, removeArray, previewArrayOrigin, dropArray,
  }
})
