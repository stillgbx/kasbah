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
/**
 * La maison avec la place `id` telle qu'on est en train de la déplacer. Même rôle que
 * `withOpeningDraft` : la scène montre le geste AVANT l'écriture, et c'est la même maison qui nourrit
 * le panneau — les quatre cotes suivent donc le doigt.
 */
function withParkingDraft(h: House | null, id: string | null, patch: ParkingPatch | null): House | null {
  if (!h || !id || !patch) return h
  if (!h.site.parkings.some((p) => p.id === id)) return h
  return {
    ...h,
    site: { ...h.site, parkings: h.site.parkings.map((p) => (p.id === id ? { ...p, ...patch } : p)) },
  }
}

/** La maison avec l'élément de jardin `id` tel qu'on est en train de le régler (même rôle que les places). */
function withGardenDraft(h: House | null, id: string | null, patch: GardenItemPatch | null): House | null {
  if (!h || !id || !patch) return h
  if (!h.site.garden.some((g) => g.id === id)) return h
  // `spacing: null` efface l'espacement d'une haie : dans l'aperçu, le champ disparaît
  const apply = (g: GardenItem): GardenItem => {
    const { spacing, ...rest } = patch
    const next: GardenItem = { ...g, ...rest }
    if (spacing === null) delete next.spacing
    else if (spacing !== undefined) next.spacing = spacing
    return next
  }
  return { ...h, site: { ...h.site, garden: h.site.garden.map((g) => (g.id === id ? apply(g) : g)) } }
}

/** Hauteur d'un élément qui naît (m) : un ordre de grandeur de la famille, réglé ensuite. */
export const GARDEN_DEFAULT_HEIGHT: Record<GardenKind, number> = { broadleaf: 7, fruit: 5, conifer: 9, palm: 6, bamboo: 5, shrub: 1.2, rock: 0.6, hedge: 1.8 }

/**
 * Ce qu'une séance d'édition change à une maison (formes, ouvertures recalées, finitions) : comparé
 * avant / après pour savoir s'il reste à écrire. Ni les cotes (`meta.survey`) ni les emprises des
 * niveaux, qui s'en DÉDUISENT : une maison convertie en relevé sans changer de forme (la démo, dont le
 * RDC ne déclarait pas d'emprise) n'a rien à écrire.
 */
const buildingOf = (h: House | null) => JSON.stringify([
  h?.style ?? null,
  h?.rooms.map((r) => [r.id, r.levelId, r.name, r.kind, r.polygon, r.openings, r.style?.floorFinish ?? null, r.style?.wallFinish ?? null]) ?? [],
  h?.levels.map((l) => [l.id, l.name, l.shortName ?? null, l.elevation]) ?? [],
  h?.name ?? null,
])

/** Deux listes d'ajouts : la seconde complète la première, sans doublon d'id. */
const unionById = <T extends { id: string }>(a: T[] = [], b: T[] = []): T[] => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))]
const union = (a: string[] = [], b: string[] = []): string[] => [...new Set([...a, ...b])]

/** Deux états de séance : le second passe devant (finitions surface par surface, formes pièce par pièce). */
function mergeEdit(prev: HouseEditPatch | null, next: HouseEditPatch): HouseEditPatch {
  const out: HouseEditPatch = {}
  const appearance = prev?.appearance && next.appearance ? mergeAppearancePatch(prev.appearance, next.appearance) : next.appearance ?? prev?.appearance
  if (appearance) out.appearance = appearance
  const shapes = { ...prev?.shapes, ...next.shapes }
  if (Object.keys(shapes).length) out.shapes = shapes
  // structure : les ajouts et les retraits s'accumulent, nom et type pièce par pièce
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

/** Une ouverture qui ne tient plus se dit par son nom et celui de sa pièce ; le reste, tel quel. */
function issueText(h: House, i: HouseIssue): string {
  const m = /^rooms\[(\d+)\]\.openings\[(\d+)\]/.exec(i.path)
  const room = m ? h.rooms[Number(m[1])] : undefined
  const o = room?.openings[Number(m![2])]
  if (!room || !o) return `${i.path} : ${i.message}`
  // le toit est monté sur un étage neuf : la fenêtre de toit restée dessous n'est plus sous le toit
  if (o.type === 'roof-window' && i.message.startsWith('roof-window must belong')) return t('structure.roofWindowUnder', { room: room.name, opening: openingLabel(o) })
  return t('shape.openingNoFit', { room: room.name, opening: openingLabel(o) })
}

interface EditOutcome {
  house: House | null
  /** Le document tel que la séance le donne, même refusé : ce sont SES cotes que l'éditeur montre. */
  raw: SurveyDoc | null
  blocking: string[]
  warnings: string[]
}
/** La maison que la séance donnerait, et ce qui empêche de l'écrire (pièces nommées, pas leurs ids). */
function runEdit(h: House, patch: HouseEditPatch): EditOutcome {
  let r
  try { r = applyHouseEditToJson(h, patch) } catch (err) { return { house: null, raw: null, blocking: [(err as Error).message], warnings: [] } }
  // les pièces nées dans la séance se nomment aussi (le document de la séance les porte)
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
 * Le brouillon posé sur une ouverture. Les trois champs EFFAÇABLES suivent ici exactement la règle
 * du serveur (`patchOpeningInJson`) : une chaîne vide RETIRE la clé au lieu de l'écrire. Sans ce
 * détour, rendre la main au défaut (la nature, la palette) aurait montré dans la scène une
 * menuiserie de matière `''`, que le fichier ne portera jamais.
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
  /** Place en cours de réglage et son brouillon : même mécanique, et même raison d'être déclarés ici. */
  const selectedParkingId = ref<string | null>(null)
  const parkingDraft = shallowRef<ParkingPatch | null>(null)
  /** Élément du jardin en cours de réglage et son brouillon : même mécanique. */
  const selectedGardenId = ref<string | null>(null)
  const gardenDraft = shallowRef<GardenItemPatch | null>(null)
  /**
   * Séance d'édition en cours (mode édition) : finitions et formes des pièces. La suite des états du
   * brouillon, pour annuler et rétablir, et le pas courant (0 = rien de changé). Rien n'est écrit
   * avant « Valider ». `shapeTransient` = la forme pendant un GLISSEMENT : montrée, pas encore un pas.
   */
  const editHistory = shallowRef<HouseEditPatch[]>([])
  const editStep = ref(0)
  const editDraft = computed<HouseEditPatch | null>(() => editHistory.value[editStep.value - 1] ?? null)
  const shapeTransient = shallowRef<Shapes | null>(null)
  const editPatch = computed<HouseEditPatch | null>(() =>
    shapeTransient.value ? mergeEdit(editDraft.value, { shapes: shapeTransient.value }) : editDraft.value)
  const editOutcome = computed<EditOutcome | null>(() => (house.value && editPatch.value ? runEdit(house.value, editPatch.value) : null))
  /**
   * La maison montrée pendant la séance. Une forme que la validation refuse (une ouverture qui ne
   * tient plus sur son mur) ne peut pas se dessiner : la scène garde alors la dernière qui pouvait.
   */
  let lastGoodEdit: House | null = null
  const editView = computed<House | null>(() => {
    const o = editOutcome.value
    if (!o) { lastGoodEdit = null; return house.value }
    if (o.house) lastGoodEdit = o.house
    return o.house ?? lastGoodEdit ?? house.value
  })

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
    const drafted = withOpeningDraft(editView.value, selectedOpeningId.value, openingDraft.value)
    const base = withGardenDraft(withParkingDraft(drafted, selectedParkingId.value, parkingDraft.value), selectedGardenId.value, gardenDraft.value)
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
  /** Les places de stationnement, brouillon compris : la liste du panneau de la maison en mode édition. */
  const parkings = computed<Parking[]>(() => effective.value?.site.parkings ?? [])
  /** Les éléments du jardin, brouillon compris. */
  const gardenItems = computed<GardenItem[]>(() => effective.value?.site.garden ?? [])

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
  // un autre écran a déplacé un appareil : le serveur pousse la maison réécrite
  watch(() => devices.serverHouse, (h) => { if (h) house.value = h })

  function setFloorTab(tab: FloorTab) {
    gardenFocus.value = tab === 'garden'
    focusedLevelId.value = tab === 'garden' || tab === 'all' ? null : tab
    if (selectedRoomId.value) {
      const room = index.value?.roomsById.get(selectedRoomId.value)
      const zone = index.value?.zonesById.get(selectedRoomId.value)
      if ((room && room.levelId !== focusedLevelId.value) || (zone && tab !== 'garden')) selectedRoomId.value = null
    }
    // Un onglet NAVIGUE : on quitte l'appareil (sauf en mode Déplacer — le sélecteur Emplacement
    // seul change alors de niveau). Sinon `frameSelection` le recadre (`focusDevice` → `focusLevel`
    // de SA pièce) et annule le niveau demandé.
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

  /**
   * Réglage de la lumière de la scène 3D enregistré dans la maison (banc de la vue Maison). Pas
   * d'application optimiste : la maison ne change pas d'aspect à l'enregistrement — la scène montre
   * déjà le réglage en cours, l'écriture ne fait que le rendre durable et commun à tous les écrans.
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

  /** Enregistre le relief du terrain (`null` = plat) ; l'erreur est dite par une notification. */
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

  /** Enregistre l'origine GPS calée sur la photo ; l'erreur est dite par une notification. */
  async function saveOrigin(origin: GeoOrigin): Promise<boolean> {
    try {
      house.value = await getTransport().saveOrigin(origin)
      return true
    } catch (err) {
      useNotificationsStore().error(t('settings.originSaveError', { message: (err as Error).message }))
      return false
    }
  }

  // ---- mode édition : SÉANCE (finitions des pièces et de la façade, formes des pièces) ---------------
  //
  // Chaque choix entre dans le brouillon, que la scène montre aussitôt ; rien n'est écrit dans
  // house.json avant « Valider », qui écrit toute la séance d'un coup (`PUT /api/house/edit`).

  /** Les finitions telles qu'on les VOIT (brouillon compris) : c'est ce que le sélecteur coche. */
  function roomFinish(roomId: string, surface: 'floor' | 'walls'): Finish | undefined {
    const r = editView.value?.rooms.find((x) => x.id === roomId)
    return surface === 'floor' ? r?.style?.floorFinish : r?.style?.wallFinish
  }
  const facadeFinish = computed<Finish | undefined>(() => editView.value?.style?.facade)

  /** Un geste : un nouvel état du brouillon, qui coupe les états « rétablissables ». */
  function pushEdit(patch: HouseEditPatch) {
    const next = mergeEdit(editDraft.value, patch)
    editHistory.value = [...editHistory.value.slice(0, editStep.value), next]
    editStep.value = editHistory.value.length
  }
  function setRoomFinish(roomId: string, surface: 'floor' | 'walls', finish: Finish | null) {
    pushEdit({ appearance: { rooms: { [roomId]: { [surface]: finish } } } })
  }
  function setFacadeFinish(finish: Finish | null) { pushEdit({ appearance: { facade: finish } }) }

  // -- formes : les cotes d'une pièce (relevé), le polygone en est déduit --
  /** Le mur mitoyen entraîne celui de la pièce d'en face (réglage du panneau, oui par défaut). */
  const coupleWalls = ref(true)
  /** L'onglet Dimensions est ouvert : la scène montre les poignées de la pièce sélectionnée. */
  const shapeEditing = ref(false)
  /** Poignée choisie (sommet ou mur), partagée par la 3D et la liste des côtés. */
  const shapeSelection = ref<{ corner: number } | { wall: number } | null>(null)
  /**
   * Les cotes de la pièce dans le brouillon (m, repère de la maison) — même un brouillon refusé : un
   * sommet qu'on vient d'ajouter au travers d'une ouverture doit se voir pour qu'on le déplace. La 3D,
   * elle, garde la dernière forme dessinable.
   */
  function shapeOf(roomId: string): Vec2[] | null {
    const v = editOutcome.value?.raw ?? (editView.value as unknown as SurveyDoc | null)
    if (!v?.rooms.some((r) => r.id === roomId)) return null
    return roomShape(v, roomId)
  }
  /** Le document sur lequel s'appliquent les gestes : le brouillon tel quel, refusé ou non. */
  const editBase = () => editOutcome.value?.raw ?? (editView.value as unknown as SurveyDoc | null)
  function pushShapes(shapes: Shapes | null) { if (shapes) pushEdit({ shapes }) }
  /** Pousse un mur de `delta` m vers l'extérieur (négatif : vers l'intérieur). */
  function pushRoomWall(roomId: string, edge: number, delta: number) {
    const base = editBase()
    if (base) pushShapes(pushWall(base, roomId, edge, delta, coupleWalls.value))
  }
  /** Fixe la longueur d'un côté : le mur suivant recule ou avance. */
  function setSideLength(roomId: string, edge: number, length: number) {
    const base = editBase()
    if (base) pushShapes(setEdgeLength(base, roomId, edge, length, coupleWalls.value))
  }
  function addCorner(roomId: string, edge: number) { const base = editBase(); if (base) pushShapes(insertVertex(base, roomId, edge)) }
  function removeCorner(roomId: string, index: number) { const base = editBase(); if (base) pushShapes(removeVertex(base, roomId, index)) }

  /** Glissement en cours : chaque position se calcule depuis la forme du DÉBUT du geste. */
  let dragBase: SurveyDoc | null = null
  function beginShapeDrag() { dragBase = editBase(); shapeTransient.value = null }
  function previewRoomWall(roomId: string, edge: number, delta: number) {
    if (dragBase) shapeTransient.value = pushWall(dragBase, roomId, edge, delta, coupleWalls.value)
  }
  function previewCorner(roomId: string, index: number, to: Vec2) {
    if (dragBase) shapeTransient.value = moveVertex(dragBase, roomId, index, to)
  }
  /** Fin du geste : la forme devient un pas d'historique (ou s'abandonne). */
  function endShapeDrag(commit = true) {
    const tr = shapeTransient.value
    dragBase = null
    shapeTransient.value = null
    if (commit && tr) pushEdit({ shapes: tr })
  }

  // -- structure : pièces et niveaux qui naissent ou disparaissent, nom et type d'une pièce. Tout
  //    entre dans le même brouillon que les formes : annuler, rétablir, rien d'écrit avant « Valider ».
  /** Niveau qui attend le tap où poser une pièce de 4 × 4 m (« Ajouter une pièce »). */
  const placingRoom = ref<string | null>(null)
  /** Un id libre dans la maison de la séance (les pièces et niveaux nés compris). */
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
  /** Une pièce de l'autre côté du mur choisi : la longueur du mur sur 3 m, cloison partagée. */
  function addRoomAgainstWall(roomId: string, edge: number): void {
    const base = editBase()
    const room = editView.value?.rooms.find((r) => r.id === roomId)
    if (base && room) addRoom(room.levelId, roomAgainstWall(base, roomId, edge))
  }
  /** Le niveau où l'on posera : celui de l'onglet, sinon le plus bas. */
  const roomTargetLevelId = computed<string | null>(() => focusedLevelId.value ?? levels.value.at(-1)?.id ?? null)   // trié du haut vers le bas
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
  /** Nom et nom court d'un niveau (un nom court vide le retire : l'onglet reprend le nom). */
  function setLevelIdentity(levelId: string, ident: { name?: string; shortName?: string }): void {
    pushEdit({ levels: { [levelId]: ident } })
  }
  function setPropertyName(name: string): void { pushEdit({ propertyName: name }) }
  function addLevel(side: NewLevelSide): void {
    const v = editView.value
    if (!v) return
    const id = freeId('niveau', [...v.levels.map((l) => l.id), ...(editDraft.value?.newLevels ?? []).map((l) => l.id)])
    // « Étage 2 » au-dessus d'un rez-de-chaussée et d'un étage : on compte les niveaux habités (ou nés
    // dans la séance), pas le niveau vide du toit
    const born = new Set((editDraft.value?.newLevels ?? []).map((l) => l.id))
    const storeys = v.levels.filter((l) => born.has(l.id) || v.rooms.some((r) => r.levelId === l.id)).length
    const name = side === 'above' ? t('structure.newLevelAbove', { n: storeys }) : t('structure.newLevelBelow')
    pushEdit({ newLevels: [{ id, name, side }] })
    focusLevel(id)
  }
  /** Un niveau se retire vide : ni pièce, ni appareil, ni champ, ni place, ni toit dessus. */
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

  // annuler, rétablir ou abandonner peut faire disparaître la pièce ou le niveau qu'on regardait :
  // on remonte alors à la maison, plutôt que de garder un panneau et un onglet qui ne montrent rien
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
  /** Le brouillon change-t-il quelque chose à la maison écrite ? (choisir puis revenir ne compte pas) */
  const editDirty = computed(() => !!editDraft.value && buildingOf(editView.value) !== buildingOf(house.value))
  /** Ce qui empêche d'écrire la séance : « Valider » reste grisé tant qu'il y en a. */
  const editBlocking = computed<string[]>(() => editOutcome.value?.blocking ?? [])
  const editWarnings = computed<string[]>(() => editOutcome.value?.warnings ?? [])
  /** Abandonne le brouillon : la scène revient à la maison écrite. */
  function discardEdit() { editHistory.value = []; editStep.value = 0; shapeTransient.value = null; dragBase = null; placingRoom.value = null }
  const savingEdit = ref(false)
  /** « Valider » : toute la séance d'un coup ; en cas de refus, le brouillon reste là. */
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
   * donne), les vantaux, la matière et la couleur d'un ouvrant (un moteur publie une course, pas un
   * volet bois blanc). Même chemin que le renommage : l'entrée de maison est créée au besoin, SANS position —
   * un véhicule n'a pas de place écrite. `[0, 0]` et `0` effacent, comme la chaîne vide efface un nom.
   */
  async function setDeviceTuning(pluginDeviceId: string, tuning: Pick<DevicePlacement, 'gpsOffset' | 'mapOffset' | 'yawOffset' | 'batteryKwh' | 'model3d' | 'bodyColor' | 'bodyFinish' | 'leaves' | 'coverMaterial' | 'coverColor' | 'speakerShape'>): Promise<boolean> {
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
        x: sel.opening.x, y: sel.opening.y, yaw: sel.opening.yaw,
        width: sel.opening.width, height: sel.opening.height,
        sill: openingSill(sel.opening, resolveDefaults(house.value?.defaults)),
        // la menuiserie se rétablit comme les cotes ; absente à la sélection, elle se RETIRE (chaîne
        // vide) plutôt que de se figer sur la valeur déduite
        leaves: sel.opening.leaves ?? '', material: sel.opening.material ?? '', color: sel.opening.color ?? '',
      }
      : null
    if (!sel) return
    // le panneau d'une ouverture se lit sous sa pièce ; c'est elle qui donne le fil d'Ariane et le cadrage
    selectedKey.value = null
    selectedLevelId.value = null
    selectedRoomId.value = sel.room.id
    gardenFocus.value = false
    // Fenêtre de toit : rester sur le niveau-toit (sinon le toit se cache et la poignée semble au sol).
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
    if (isSurfaceOpening(sel.opening.type)) {
      // un Velux sur un versant glisse sur son EMPRISE au point visé : cap de la descente, longueur
      // raccourcie par la pente (`surfaceFootprint`) — il peut ainsi approcher le mur de sa vraie taille
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
      || o.x !== s.x || o.y !== s.y || o.yaw !== s.yaw
      || o.width !== s.width || o.height !== s.height
      || o.sill !== openingSill(s, resolveDefaults(house.value.defaults))
      || o.leaves !== (s.leaves ?? '') || o.material !== (s.material ?? '') || o.color !== (s.color ?? '')
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

  /** Arme une nature. Mur / sol : pièce sélectionnée requise. Toit : pièce optionnelle (résolue au tap). */
  function startPlacingOpening(type: OpeningType) {
    selectOpening(null)
    if (type === 'roof-window') {
      placingOpening.value = { roomId: selectedRoom.value?.id ?? '', type }
      // Bascule sur le niveau-toit pour voir et taper la toiture (depuis un étage, le toit est masqué).
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
  // quitter la pièce désarme — sauf pose toit sans pièce (roomId vide), qui survit au changement d'onglet
  watch(selectedRoomId, (id) => {
    const armed = placingOpening.value
    if (armed?.roomId && armed.roomId !== id) placingOpening.value = null
  })

  /** Id libre pour une ouverture neuve : sa nature, numérotée s'il le faut (comme `addArray`). */
  function freeOpeningId(type: OpeningType): string {
    const used = new Set((house.value?.rooms ?? []).flatMap((r) => r.openings.map((o) => o.id)))
    let id: string = type
    for (let n = 2; used.has(id); n++) id = `${type}-${n}`
    return id
  }

  /**
   * Le mur / sol / toit tapé : l'ouverture naît là, aux cotes de sa nature (`newOpeningDims`), et
   * devient la sélection — on l'a posée pour la régler.
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
          // sur un versant : cap de la descente, longueur vue du ciel raccourcie par la pente
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

  // --- places de stationnement ---------------------------------------------
  //
  // Une voiture et un robot se placent d'après leur GPS, qui est bon à quelques mètres près : c'est
  // assez pour dire « il est rentré », pas pour le poser dans son garage. Une PLACE dit où l'engin se
  // range quand il est au repos à côté (`assignParkings`, partagé avec la scène).
  //
  // Le geste est celui des ouvertures, au sol : on arme une nature dans le panneau de la maison, on
  // tape l'endroit dans la 3D, puis on règle les quatre cotes — ce qui sépare la place du contour de
  // son hôte (le garage, l'allée) — ou on la glisse au doigt.
  const savingParking = ref(false)
  /**
   * Place armée, en attente du point qu'on va taper dans la 3D. `levelId` vient du panneau d'une
   * PIÈCE (« ajouter une place dans ce garage ») : le niveau est alors décidé d'avance, et le tap ne
   * donne plus que le point. Armée depuis la maison, c'est la surface touchée qui tranche.
   */
  const placingParking = shallowRef<{ accepts: DeviceKind; deviceId?: string; levelId?: string } | null>(null)

  /** La place sélectionnée, brouillon compris : c'est elle que le panneau AFFICHE. */
  const selectedParking = computed<Parking | null>(
    () => effective.value?.site.parkings.find((p) => p.id === selectedParkingId.value) ?? null)
  /** La même, telle qu'elle est ÉCRITE. */
  const savedParking = computed<Parking | null>(
    () => house.value?.site.parkings.find((p) => p.id === selectedParkingId.value) ?? null)

  /**
   * Les places posées DANS une pièce : celles dont l'hôte est cette pièce. C'est ce que le panneau
   * d'une pièce en mode édition liste — on ajoute une place de garage depuis le garage, pas depuis
   * une liste de toute la maison.
   */
  const parkingsInRoom = (roomId: string) => parkings.value.filter((p) => {
    const h = house.value ? parkingHost(house.value, p) : null
    return h?.kind === 'room' && h.id === roomId
  })

  /** Ce qui PORTE la place sélectionnée (pièce, zone ou terrain) : les quatre cotes s'y mesurent. */
  const parkingHostOf = computed(() => {
    const p = selectedParking.value
    return p && effective.value ? parkingHost(effective.value, p) : null
  })
  /** Les quatre cotes de la place sélectionnée, telles que le panneau et la scène les montrent. */
  const parkingGapsOf = computed<Record<ParkingSide, number | null> | null>(() => {
    const p = selectedParking.value, host = parkingHostOf.value
    return p && host ? parkingGaps(host.polygon, p) : null
  })

  function selectParking(id: string | null) {
    parkingDraft.value = null
    selectedParkingId.value = id
    if (!id) return
    // une place se règle depuis la maison : ni pièce ni appareil sélectionnés, le fil d'Ariane y revient
    selectedKey.value = null
    selectedOpeningId.value = null
    // Posée dans une pièce (un garage), c'est son NIVEAU qu'on regarde : sinon on règle le marquage
    // d'un garage à travers le toit. C'est le magasin qui le dit, comme pour une ouverture, pour que
    // l'onglet de niveau (`floorTab`) le montre au lieu de contredire la scène.
    const p = house.value?.site.parkings.find((x) => x.id === id)
    const host = p && house.value ? parkingHost(house.value, p) : null
    const room = host?.kind === 'room' ? index.value?.roomsById.get(host.id) : undefined
    if (room) { focusedLevelId.value = room.levelId; gardenFocus.value = false }
  }

  /** Glissement : le point attrapé devient le CENTRE de la place. Au sol, rien ne la contraint. */
  function previewParkingAt(xy: Vec2) {
    const p = savedParking.value
    if (!p) return
    parkingDraft.value = { ...parkingDraft.value, center: [snapCm(xy[0]), snapCm(xy[1])] }
  }

  /** Écrit le brouillon (complété par `patch`) dans house.json. */
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

  /** Fin du glissement : le brouillon devient la place de la place. */
  async function dropParking(): Promise<void> { if (parkingDraft.value) await saveParking() }

  /**
   * Cote voulue sur un côté → la place GLISSE de ce qui manque (`fitParkingGap`), les autres cotes
   * suivent. C'est la règle des cotes d'ouverture : on garde ce qui a été tapé, on déplace ce qui
   * peut l'être, plutôt que de rogner en silence.
   */
  async function setParkingGap(side: ParkingSide, wanted: number): Promise<boolean> {
    const p = savedParking.value, host = parkingHostOf.value
    if (!p || !host) return false
    const center = fitParkingGap(host.polygon, p, side, wanted)
    return center ? saveParking({ center }) : false
  }

  /** Arme une place : on choisit ce qui s'y range, puis on tape l'endroit dans la 3D. */
  function startPlacingParking(accepts: DeviceKind, deviceId?: string, levelId?: string) {
    selectParking(null)
    placingParking.value = { accepts, ...(deviceId ? { deviceId } : {}), ...(levelId ? { levelId } : {}) }
  }
  function cancelPlacingParking() { placingParking.value = null }

  /** Id libre pour une place neuve : ce qui s'y range, numéroté s'il le faut (comme `freeOpeningId`). */
  function freeParkingId(accepts: DeviceKind): string {
    const used = new Set((house.value?.site.parkings ?? []).map((p) => p.id))
    let id = `park.${accepts}`
    for (let n = 2; used.has(id); n++) id = `park.${accepts}-${n}`
    return id
  }

  /**
   * L'endroit tapé : la place naît là, aux cotes de catalogue de ce qui s'y range
   * (`newParkingSize`), orientée comme la pièce qui la porte quand il y en a une — un garage range
   * une voiture dans son sens, et c'est mieux que le nord. Elle devient la sélection : on l'a posée
   * pour la régler.
   */
  async function placeParkingAt(xy: Vec2, levelId?: string | null): Promise<void> {
    const armed = placingParking.value
    if (!armed || !house.value) return
    // Le niveau imposé par la pièce d'où l'on a armé gagne sur la surface touchée : on a dit « dans
    // ce garage », un doigt qui glisse sur la pelouse voisine ne doit pas changer d'avis pour nous.
    const level = armed.levelId ?? levelId ?? undefined
    const size = newParkingSize(armed.accepts)
    const probe = {
      id: '', accepts: armed.accepts, center: [snapCm(xy[0]), snapCm(xy[1])] as Vec2, size, yaw: 0,
      ...(level ? { levelId: level } : {}),
    }
    const host = parkingHost(house.value, probe)
    // L'axe d'une pièce revient dans `[-180, 180]` ; on l'écrit dans `[0, 360[`, la convention des
    // appareils orientés — sans quoi le panneau afficherait « -90° » là où il montre « 270° ».
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

  /** La place réservée à cet appareil, s'il en a une : la base d'un robot (vue Robots, panneau). */
  const dockFor = (deviceId: string) => parkings.value.find((p) => p.deviceId === deviceId) ?? null

  /** Retire la place sélectionnée : l'engin qui s'y rangeait retourne à son point GPS. */
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

  // --- jardin (arbres, buissons, pierres) ------------------------------------
  //
  // Du décor, posé comme une place : on arme une famille dans le panneau de la maison, on tape la
  // pelouse, puis on règle la hauteur et le cap, ou on glisse l'élément au doigt.
  const savingGarden = ref(false)
  /** Famille (et espèce éventuelle) armée, en attente du point qu'on va taper sur le terrain. */
  const placingGarden = shallowRef<{ kind: GardenKind; species?: string } | null>(null)
  /** L'élément sélectionné, brouillon compris (celui que le panneau AFFICHE). */
  const selectedGardenItem = computed<GardenItem | null>(
    () => effective.value?.site.garden.find((g) => g.id === selectedGardenId.value) ?? null)
  const savedGardenItem = computed<GardenItem | null>(
    () => house.value?.site.garden.find((g) => g.id === selectedGardenId.value) ?? null)

  function selectGardenItem(id: string | null) {
    gardenDraft.value = null
    selectedGardenId.value = id
    if (!id) return
    // un élément du jardin se règle depuis la maison, comme une place
    selectedKey.value = null
    selectedOpeningId.value = null
    selectedParkingId.value = null
  }

  /** Aperçu sans écriture (glissement, curseur de hauteur) : la scène suit, le fichier attend. */
  function previewGardenItem(patch: GardenItemPatch) {
    if (!savedGardenItem.value) return
    gardenDraft.value = { ...gardenDraft.value, ...patch }
  }
  function previewGardenAt(xy: Vec2) { previewGardenItem({ center: [snapCm(xy[0]), snapCm(xy[1])] }) }

  /** Écrit le brouillon (complété par `patch`) dans house.json. */
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

  /** Une autre forme pour le même élément : une graine neuve, rien d'autre ne change. */
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
   * Le point tapé sur le terrain : l'élément y naît à la hauteur type de sa famille, avec un cap
   * tiré au hasard (une rangée d'arbres posés un à un n'a pas l'air clonée). L'arme reste levée :
   * on plante souvent plusieurs arbres d'affilée — « Terminé » ou un tap à côté la baisse.
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
    roomFinish, facadeFinish, setRoomFinish, setFacadeFinish, canUndoEdit, canRedoEdit, undoEdit, redoEdit, editDirty, editBlocking, editWarnings, discardEdit, savingEdit, saveEdit,
    coupleWalls, shapeEditing, shapeSelection, shapeOf, pushRoomWall, setSideLength, addCorner, removeCorner, beginShapeDrag, previewRoomWall, previewCorner, endShapeDrag,
    placingRoom, roomTargetLevelId, startPlacingRoom, cancelPlacingRoom, placeRoomAt, addRoomAgainstWall, removeRoom, setRoomIdentity, setLevelIdentity, setPropertyName, addLevel, levelRemovable, removeLevel,
    load, setFloorTab, focusLevel, selectRoom, selectLevel, selectDevice, clearSelection, backToHome, backFromRoom, backFromDevice, houseDeviceFor, renameDevice, setDeviceTuning, bodyColorPreview, previewBodyColor, setRoomOrder, saveRenderTuning, saveRelief, saveTerrain, saveOrigin,
    journalOverlay, journalFocus, journalActive, showJournal, hideJournal, focusJournalPoint, markJournalPoint,
    placing, saving, draft, canRevert, isProvisional, startPlacing, startPlacingNew, stopPlacing, previewPosition, previewHeight, savePlacement, revertPlacement, removePlacement,
    placementLevelId, setPlacementLevel,
    selectedOpeningId, selectedOpening, savedOpening, openingDraft, openingBounds, openingCeiling, openingDevices, savingOpening, canRevertOpening,
    placingOpening, startPlacingOpening, cancelPlacingOpening, placeOpeningAt, removeOpening,
    selectOpening, previewOpeningAt, saveOpening, dropOpening, revertOpening, setOpeningDevice, setCoverOpening, coversWithoutOpening,
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
