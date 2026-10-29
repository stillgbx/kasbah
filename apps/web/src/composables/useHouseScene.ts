import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { JournalPoint } from '../lib/journal'
import { useTheme } from 'vuetify'
import { useDocumentVisibility, useIntervalFn, useResizeObserver, watchThrottled } from '@vueuse/core'
import type { DeviceState, House, Vec3 } from '@kasbah/shared'
import { readUiTheme } from '../three/core/theme'
import { resolveAmbience } from '../three/core/ambience'
import { resolveSeason } from '../three/garden/season'
import { styleById } from '../three/styles'
import { HouseScene, type HouseSceneOptions, type ReliefEditState, type ScenePrepareStage } from '../three/HouseScene'
import type { ShapeSelection } from '../three/shape/roomShapeEditor'
import type { GroundShape } from '../three/builders/groundOverlay'
import { useDevicesStore } from '../stores/devices'
import { useSettingsStore } from '../stores/settings'
import { useWeather } from './useWeather'
import { sceneProbe, startSceneProbe } from '../lib/sceneProbe'
import { lacksResources } from '../three/core/post'

// Vue adapter of the scene controller: lifecycle, size, appearance (rendering style, time,
// Vuetify theme) → scene, house/states → scene (diff by reference), tap events → callbacks.

export interface UseHouseSceneArgs {
  canvas: Ref<HTMLCanvasElement | null>
  labelLayer: Ref<HTMLDivElement | null>
  house: ComputedRef<House | null>
  states: ComputedRef<Record<string, DeviceState>>
  options?: ComputedRef<Partial<HouseSceneOptions>>
}

type Handler<T extends unknown[]> = (...args: T) => void

const FORCED_KEY = 'kasbah.scene3dForced'
function forcedThisSession(): boolean {
  try { return sessionStorage.getItem(FORCED_KEY) === '1' } catch { return false }
}

export function useHouseScene(args: UseHouseSceneArgs) {
  const supported = ref(true)
  const ready = ref(false)
  /** The house is being prepared (materials, shaders, first frame): the current step, or `null`. */
  const preparing = ref<{ stage: ScenePrepareStage; progress: { done: number; total: number } | null } | null>(null)
  /** A house has been prepared and shown at least once (or 3D is unavailable: nothing to wait for). */
  const shown = ref(false)
  /** Too weak a machine (`lacksResources`): no scene is created, the house view says why. */
  const lowResources = ref(false)
  const relief = shallowRef<ReliefEditState | null>(null)
  let scene: HouseScene | null = null
  let stopProbe: (() => void) | null = null
  const theme = useTheme()
  const visibility = useDocumentVisibility()
  const devices = useDevicesStore()
  const settings = useSettingsStore()

  const style = computed(() => styleById(settings.sceneStyle))
  /** The sun moves: in `auto` mode, the scene's time is re-read regularly, not just once. */
  const clock = ref(new Date())
  const geo = computed(() => {
    const o = args.house.value?.origin
    return o ? { lat: o.lat, lon: o.lon } : null
  })
  // cloud cover comes from the weather device when there is one: it is what erases the shadows
  // and greys the sky (`three/core/ambience.ts`); without weather, clear sky
  const weather = useWeather()
  // In debug, Settings can FORCE a weather in the scene (to look at it under
  // snow without waiting for January): it then replaces the real one here, and only here.
  const forced = computed(() => (settings.sceneDebug && settings.sceneWeather !== 'real' ? settings.sceneWeather : null))
  const ambience = computed(() => resolveAmbience({
    mode: settings.sceneAmbience, date: clock.value, geo: geo.value,
    // the wind, for its part, is always the real one: the forced weather has no slider for it
    ...(weather.live.value ? { windKmh: weather.live.value.windKmh, windDirDeg: weather.live.value.windDirDeg } : {}),
    ...(forced.value
      ? { cloudiness: settings.sceneCloudCover / 100, visibilityM: settings.sceneVisibilityM, condition: forced.value }
      : {
        cloudiness: weather.cloudiness.value,
        ...(weather.live.value?.visibilityM !== undefined ? { visibilityM: weather.live.value.visibilityM } : {}),
        ...(weather.live.value ? { condition: weather.live.value.condition } : {}),
      }),
  }))
  /** Garden season: imposed by Settings, or that of the date in the house's hemisphere. */
  const season = computed(() => resolveSeason(settings.sceneSeason, clock.value, geo.value?.lat))

  const deviceTap = new Set<Handler<[string]>>()
  const journalTap = new Set<Handler<[number]>>()
  const roomTap = new Set<Handler<[string]>>()
  const zoneTap = new Set<Handler<[string]>>()
  const levelTap = new Set<Handler<[string]>>()
  const backgroundTap = new Set<Handler<[]>>()
  const deviceDrag = new Set<Handler<[string, [number, number], string | null]>>()
  const deviceDrop = new Set<Handler<[string, [number, number], string | null]>>()
  const openingTap = new Set<Handler<[string]>>()
  const openingDrag = new Set<Handler<[string, [number, number]]>>()
  const openingDrop = new Set<Handler<[string]>>()
  const placeTap = new Set<Handler<[[number, number]]>>()
  const groundTap = new Set<Handler<[[number, number], string | null]>>()
  const parkingTap = new Set<Handler<[string]>>()
  const parkingDrag = new Set<Handler<[string, [number, number]]>>()
  const parkingDrop = new Set<Handler<[string]>>()
  const gardenTap = new Set<Handler<[string]>>()
  const gardenDrag = new Set<Handler<[string, [number, number]]>>()
  const gardenDrop = new Set<Handler<[string]>>()
  const gardenPlaceTap = new Set<Handler<[[number, number]]>>()
  const roomPlaceTap = new Set<Handler<[[number, number]]>>()
  const shapeWall = new Set<Handler<[number, number, boolean]>>()
  const shapeCorner = new Set<Handler<[number, [number, number], boolean]>>()
  const shapeSelect = new Set<Handler<[ShapeSelection]>>()

  onMounted(() => {
    const canvas = args.canvas.value
    if (!canvas) return
    // the 3D test of the diagnostic page wants the scene whatever the machine
    if (lacksResources() && !sceneProbe && !forcedThisSession()) {
      lowResources.value = true; supported.value = false; shown.value = true
      return
    }
    scene = new HouseScene(canvas,{ labelLayer: args.labelLayer.value, style: style.value, ambience: ambience.value })
    // a 3D test of the diagnostic page (`?probe=`) imposes its switches, without saving them
    if (sceneProbe) stopProbe = startSceneProbe(scene, canvas, sceneProbe)
    scene.setAppearance({ ui: readUiTheme(), style: style.value, ambience: ambience.value, assets: sceneProbe?.assets ?? settings.sceneAssets, tuning: settings.sceneTuning })
    supported.value = scene.supported
    if (!scene.supported) shown.value = true
    // A 3D scene can only be debugged by looking at it: in development only, the controller is
    // placed on `window` so that a console (or a browser driver) can read its lights,
    // materials and camera without instrumenting the code each time.
    if (import.meta.env.DEV) (window as unknown as { kasbahScene?: HouseScene }).kasbahScene = scene
    if (!scene.supported) return
    scene.on('deviceTap', (key) => deviceTap.forEach((f) => f(key)))
    scene.on('roomTap', (id) => roomTap.forEach((f) => f(id)))
    scene.on('zoneTap', (id) => zoneTap.forEach((f) => f(id)))
    scene.on('levelTap', (id) => levelTap.forEach((f) => f(id)))
    scene.on('journalTap', (at) => journalTap.forEach((f) => f(at)))
    scene.on('backgroundTap', () => backgroundTap.forEach((f) => f()))
    scene.on('deviceDrag', (k, xy, r) => deviceDrag.forEach((f) => f(k, xy, r)))
    scene.on('deviceDrop', (k, xy, r) => deviceDrop.forEach((f) => f(k, xy, r)))
    scene.on('openingTap', (id) => openingTap.forEach((f) => f(id)))
    scene.on('openingDrag', (id, xy) => openingDrag.forEach((f) => f(id, xy)))
    scene.on('openingDrop', (id) => openingDrop.forEach((f) => f(id)))
    scene.on('placeTap', (xy) => placeTap.forEach((f) => f(xy)))
    scene.on('groundTap', (xy, levelId) => groundTap.forEach((f) => f(xy, levelId)))
    scene.on('parkingTap', (id) => parkingTap.forEach((f) => f(id)))
    scene.on('parkingDrag', (id, xy) => parkingDrag.forEach((f) => f(id, xy)))
    scene.on('parkingDrop', (id) => parkingDrop.forEach((f) => f(id)))
    scene.on('gardenTap', (id) => gardenTap.forEach((f) => f(id)))
    scene.on('gardenDrag', (id, xy) => gardenDrag.forEach((f) => f(id, xy)))
    scene.on('gardenDrop', (id) => gardenDrop.forEach((f) => f(id)))
    scene.on('gardenPlaceTap', (xy) => gardenPlaceTap.forEach((f) => f(xy)))
    scene.on('roomPlaceTap', (xy) => roomPlaceTap.forEach((f) => f(xy)))
    scene.on('shapeWall', (e, d, fin) => shapeWall.forEach((f) => f(e, d, fin)))
    scene.on('shapeCorner', (i, xy, fin) => shapeCorner.forEach((f) => f(i, xy, fin)))
    scene.on('shapeSelect', (sel) => shapeSelect.forEach((f) => f(sel)))
    scene.on('reliefChange', (state) => { relief.value = state })
    scene.on('prepare', (stage, progress) => {
      preparing.value = stage ? { stage, progress } : null
      if (!stage) shown.value = true
    })

    const parent = canvas.parentElement ?? canvas
    const fit = () => { const r = parent.getBoundingClientRect(); scene?.resize(r.width, r.height) }
    fit()
    useResizeObserver(parent, fit)

    scene.setDescriptors(devices.descriptors)
    // The two scene settings that Settings holds (render budget, projection) go
    // first; what the caller imposes through `options` wins afterwards.
    scene.setOptions({
      quality: sceneProbe?.quality ?? settings.sceneQuality, projection: settings.sceneProjection, ...(args.options ? args.options.value : {}),
      ...(sceneProbe?.shadows !== undefined ? { shadows: sceneProbe.shadows } : {}),
    })
    if (args.house.value) scene.load(args.house.value)
    scene.updateStates(args.states.value)
    scene.setSeason(season.value)
    ready.value = true
  })

  // only the devices changed (placement, auto-placement) → markers only, the camera does not move
  watch(args.house, (h, prev) => {
    if (!scene || !h) return
    if (prev && sameShell(prev, h)) { scene.updateDevices(h); return }
    // only openings moved (one is being adjusted by finger) → walls of the touched level only
    if (prev && sameShellButOpenings(prev, h)) { scene.updateOpenings(h); return }
    // only the SHELL changed (finishes, room shape, footprints) → level meshes, roof and
    // terrain if needed, without reloading the house nor recentering the camera
    if (prev && sameShellButBuilding(prev, h)) { scene.updateBuilding(h); return }
    // only PLACES moved → ground marking and vehicles stored there, nothing else
    if (prev && sameShellButParkings(prev, h)) { scene.updateParkings(h); return }
    // only the GARDEN changed (a tree is placed, dragged or adjusted) → the elements only
    if (prev && sameShellButGarden(prev, h)) { scene.updateGarden(h); return }
    // only the TERRAIN changed (relief or outline saved) → the terrain and what is placed on it
    if (prev && sameShellButRelief(prev, h)) { scene.updateRelief(h); return }
    scene.load(h); scene.setDescriptors(devices.descriptors); scene.updateStates(args.states.value, true)
  })
  watch(() => devices.descriptors, (d) => scene?.setDescriptors(d))
  watch(args.states, (s) => scene?.updateStates(s))
  if (args.options) watch(args.options, (o) => scene?.setOptions(o), { deep: true })
  watch(() => settings.sceneQuality, (q) => scene?.setOptions({ quality: q }))
  watch(() => settings.sceneProjection, (p) => scene?.setOptions({ projection: p }))
  // nextTick: the new theme's CSS variables must be applied before reading
  watch(() => theme.global.name.value, () => { void nextTick(() => scene?.setAppearance({ ui: readUiTheme() })) })
  watch(style, (s) => scene?.setAppearance({ style: s }))
  watch(season, (s) => scene?.setSeason(s))
  // A light scene redoes the sky (~35 ms): the forced weather's sliders send one per notch,
  // and the drag stuttered. At most one every 100 ms, the last one always applied.
  // And only if it CHANGED: the ambience is a recomputed object, new on each re-read (the quarter
  // hour, a weather state with the same values), and each one redid sky, materials and shadows for nothing.
  let sentAmbience = JSON.stringify(ambience.value)
  watchThrottled(ambience, (a) => {
    const key = JSON.stringify(a)
    if (key === sentAmbience) return
    sentAmbience = key
    scene?.setAppearance({ ambience: a })
  }, { throttle: 100 })
  watch(() => settings.sceneAssets, (v) => scene?.setAppearance({ assets: v }))
  // The tuning bench draws its sliders live: short path (frame chain, halos, room
  // outline), where `setAppearance` would redo materials, sky and shadows at each frame of the drag.
  watch(() => settings.sceneTuning, (t) => scene?.setTuning(t))
  // A quarter hour: the sun moves by less than 4°, and the scene only renders on demand.
  useIntervalFn(() => { clock.value = new Date() }, 15 * 60 * 1000)
  watch(visibility, (v) => scene?.setPaused(v === 'hidden'))

  onBeforeUnmount(() => { stopProbe?.(); scene?.dispose(); scene = null })

  return {
    supported, ready, preparing, shown, lowResources,
    /**
     * "Show anyway", for THIS session only: a machine that cannot hold the scene would otherwise
     * crash again at every opening. The scene is created on mount, hence the reload.
     */
    showAnyway: () => {
      try { sessionStorage.setItem(FORCED_KEY, '1') } catch { /* private browsing: the reload simply shows the message again */ }
      location.reload()
    },
    onDeviceTap: (f: Handler<[string]>) => { deviceTap.add(f) },
    onJournalTap: (f: Handler<[number]>) => { journalTap.add(f) },
    onRoomTap: (f: Handler<[string]>) => { roomTap.add(f) },
    onZoneTap: (f: Handler<[string]>) => { zoneTap.add(f) },
    onLevelTap: (f: Handler<[string]>) => { levelTap.add(f) },
    onBackgroundTap: (f: Handler<[]>) => { backgroundTap.add(f) },
    focusLevel: (id: string | null) => scene?.focusLevel(id),
    focusLevelView: (id: string) => scene?.focusLevelView(id),
    focusRoom: (id: string) => scene?.focusRoom(id),
    focusZone: (id: string) => scene?.focusZone(id),
    focusDevice: (key: string) => scene?.focusDevice(key),
    focusOutdoor: () => scene?.focusOutdoor(),
    resetView: () => scene?.resetView(),
    orbitBy: (delta: number) => scene?.orbitBy(delta),
    dollyBy: (factor: number) => scene?.dollyBy(factor),
    setViewInset: (rightPx: number) => scene?.setViewInset(rightPx),
    highlightRoom: (id: string | null) => scene?.highlightRoom(id),
    setSelected: (key: string | null) => scene?.setSelected(key),
    onDeviceDrag: (f: Handler<[string, [number, number], string | null]>) => { deviceDrag.add(f) },
    onDeviceDrop: (f: Handler<[string, [number, number], string | null]>) => { deviceDrop.add(f) },
    setMovable: (key: string | string[] | null) => scene?.setMovable(key),
    setEditingOpenings: (on: boolean) => scene?.setEditingOpenings(on),
    setSelectedOpening: (id: string | null) => scene?.setSelectedOpening(id),
    focusOpening: (id: string) => scene?.focusOpening(id),
    onOpeningTap: (f: Handler<[string]>) => { openingTap.add(f) },
    onOpeningDrag: (f: Handler<[string, [number, number]]>) => { openingDrag.add(f) },
    onOpeningDrop: (f: Handler<[string]>) => { openingDrop.add(f) },
    setPlacingOpening: (armed: { roomId: string; type: string } | null) => scene?.setPlacingOpening(armed),
    setEditingParkings: (on: boolean) => scene?.setEditingParkings(on),
    setEditingRelief: (on: boolean) => scene?.setEditingRelief(on),
    setTerrainTab: (tab: 'relief' | 'outline') => scene?.setTerrainTab(tab),
    /** Relief editing as the scene sees it (radius, chosen point, draft), `null` outside the mode. */
    relief,
    setPlacingParking: (on: boolean) => scene?.setPlacingParking(on),
    onGroundTap: (f: Handler<[[number, number], string | null]>) => { groundTap.add(f) },
    setSelectedParking: (id: string | null) => scene?.setSelectedParking(id),
    focusParking: (id: string) => scene?.focusParking(id),
    onParkingTap: (f: Handler<[string]>) => { parkingTap.add(f) },
    onParkingDrag: (f: Handler<[string, [number, number]]>) => { parkingDrag.add(f) },
    onParkingDrop: (f: Handler<[string]>) => { parkingDrop.add(f) },
    setEditingGarden: (on: boolean) => scene?.setEditingGarden(on),
    setPlacingGarden: (on: boolean) => scene?.setPlacingGarden(on),
    setPlacingRoom: (on: boolean) => scene?.setPlacingRoom(on),
    setSelectedGarden: (id: string | null) => scene?.setSelectedGarden(id),
    focusGarden: (id: string) => scene?.focusGarden(id),
    onGardenTap: (f: Handler<[string]>) => { gardenTap.add(f) },
    onGardenDrag: (f: Handler<[string, [number, number]]>) => { gardenDrag.add(f) },
    onGardenDrop: (f: Handler<[string]>) => { gardenDrop.add(f) },
    onGardenPlaceTap: (f: Handler<[[number, number]]>) => { gardenPlaceTap.add(f) },
    onRoomPlaceTap: (f: Handler<[[number, number]]>) => { roomPlaceTap.add(f) },
    onPlaceTap: (f: Handler<[[number, number]]>) => { placeTap.add(f) },
    setShapeEditing: (roomId: string | null) => scene?.setShapeEditing(roomId),
    setShapeOutline: (points: readonly [number, number][]) => scene?.setShapeOutline(points),
    setShapeSelection: (sel: ShapeSelection) => scene?.setShapeSelection(sel),
    onShapeWall: (f: Handler<[number, number, boolean]>) => { shapeWall.add(f) },
    onShapeCorner: (f: Handler<[number, [number, number], boolean]>) => { shapeCorner.add(f) },
    onShapeSelect: (f: Handler<[ShapeSelection]>) => { shapeSelect.add(f) },
    moveMarker: (key: string, position: Vec3) => scene?.moveMarker(key, position),
    previewBodyColor: (key: string, color: string | null) => scene?.previewBodyColor(key, color),
    setJournalPoints: (key: string | null, points: readonly JournalPoint[]) => scene?.setJournalPoints(key, points),
    focusJournalPoint: (at: number) => scene?.focusJournalPoint(at),
    setActiveJournalPoint: (at: number | null) => scene?.setActiveJournalPoint(at),
    setGroundOverlay: (shapes: readonly GroundShape[]) => scene?.setGroundOverlay(shapes),
    controller: () => scene,
  }
}

/** Same shell (levels, rooms, site, roof, defaults, appearance): only `devices` may differ. */
function sameShell(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, h.site, h.roofs, h.roof, h.defaults, h.style])
  return shell(a) === shell(b)
}

/**
 * Same shell except the OPENINGS. `rooms` carries `openings[]`: adjusting a window thus left
 * `sameShell` and went through a full `load()` — the whole house rebuilt, camera recentered, on
 * every finger movement. This case has its own path (`updateOpenings`).
 */
function sameShellButOpenings(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms.map((r) => ({ ...r, openings: [] })), h.site, h.roofs, h.roof, h.defaults, h.style])
  return shell(a) === shell(b)
}

/**
 * Same house except the SHELL: finishes (`room.style`, `house.style`), room shape (polygon,
 * walls, readjusted openings, measurements), level footprint — and the auto-placed devices that
 * follow their center. Neither the site, nor the declared roof, nor the defaults, nor the level elevation.
 */
function sameShellButBuilding(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels.map((l) => ({ ...l, outline: null })), h.rooms.map((r) => [r.id, r.levelId]), h.site, h.roofs, h.roof, h.defaults])
  return shell(a) === shell(b)
}

/** Same shell except the TERRAIN (relief, outline): saving it must not recenter the camera. */
function sameShellButRelief(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, { ...h.site, relief: null, terrain: null }, h.roofs, h.roof, h.defaults])
  return shell(a) === shell(b)
}

/**
 * Same shell except the PARKING SPACES. They live in `site`, so adjusting a space
 * left `sameShell` and reloaded the whole house — camera recentered on every finger
 * movement, the same trap as the openings. This case has its own path (`updateParkings`).
 */
function sameShellButParkings(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, { ...h.site, parkings: [] }, h.roofs, h.roof, h.defaults])
  return shell(a) === shell(b)
}

/** Same shell except the GARDEN (trees, bushes, stones): dragging them does not reload the house. */
function sameShellButGarden(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, { ...h.site, garden: [] }, h.roofs, h.roof, h.defaults])
  return shell(a) === shell(b)
}
