import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue'
import type { JournalPoint } from '../lib/journal'
import { useTheme } from 'vuetify'
import { useDocumentVisibility, useIntervalFn, useResizeObserver, watchThrottled } from '@vueuse/core'
import type { DeviceState, House, Vec3 } from '@kasbah/shared'
import { readUiTheme } from '../three/core/theme'
import { resolveAmbience } from '../three/core/ambience'
import { styleById } from '../three/styles'
import { HouseScene, type HouseSceneOptions, type ReliefEditState, type ScenePrepareStage } from '../three/HouseScene'
import { useDevicesStore } from '../stores/devices'
import { useSettingsStore } from '../stores/settings'
import { useWeather } from './useWeather'

// Adaptateur Vue du contrôleur de scène : cycle de vie, taille, apparence (style de rendu, heure,
// thème Vuetify) → scène, maison/états → scène (diff par référence), événements de tap → callbacks.

export interface UseHouseSceneArgs {
  canvas: Ref<HTMLCanvasElement | null>
  labelLayer: Ref<HTMLDivElement | null>
  house: ComputedRef<House | null>
  states: ComputedRef<Record<string, DeviceState>>
  options?: ComputedRef<Partial<HouseSceneOptions>>
}

type Handler<T extends unknown[]> = (...args: T) => void

export function useHouseScene(args: UseHouseSceneArgs) {
  const supported = ref(true)
  const ready = ref(false)
  /** La maison se prépare (matières, shaders, première image) : l'étape en cours, ou `null`. */
  const preparing = ref<{ stage: ScenePrepareStage; progress: { done: number; total: number } | null } | null>(null)
  /** Une maison a été préparée et montrée au moins une fois (ou la 3D est indisponible : rien à attendre). */
  const shown = ref(false)
  const relief = shallowRef<ReliefEditState | null>(null)
  let scene: HouseScene | null = null
  const theme = useTheme()
  const visibility = useDocumentVisibility()
  const devices = useDevicesStore()
  const settings = useSettingsStore()

  const style = computed(() => styleById(settings.sceneStyle))
  /** Le soleil bouge : en mode `auto`, l'heure de la scène est relue régulièrement, pas une seule fois. */
  const clock = ref(new Date())
  const geo = computed(() => {
    const o = args.house.value?.origin
    return o ? { lat: o.lat, lon: o.lon } : null
  })
  // la nébulosité vient de l'appareil météo quand il y en a un : c'est elle qui efface les ombres
  // et grise le ciel (`three/core/ambience.ts`) ; sans météo, ciel dégagé
  const weather = useWeather()
  // En débogage, les Réglages peuvent FORCER une météo dans la scène (pour la regarder sous la
  // neige sans attendre janvier) : elle remplace alors la vraie ici, et seulement ici.
  const forced = computed(() => (settings.sceneDebug && settings.sceneWeather !== 'real' ? settings.sceneWeather : null))
  const ambience = computed(() => resolveAmbience({
    mode: settings.sceneAmbience, date: clock.value, geo: geo.value,
    // le vent, lui, est toujours le vrai : la météo forcée n'en a pas de curseur
    ...(weather.live.value ? { windKmh: weather.live.value.windKmh, windDirDeg: weather.live.value.windDirDeg } : {}),
    ...(forced.value
      ? { cloudiness: settings.sceneCloudCover / 100, visibilityM: settings.sceneVisibilityM, condition: forced.value }
      : {
        cloudiness: weather.cloudiness.value,
        ...(weather.live.value?.visibilityM !== undefined ? { visibilityM: weather.live.value.visibilityM } : {}),
        ...(weather.live.value ? { condition: weather.live.value.condition } : {}),
      }),
  }))

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

  onMounted(() => {
    const canvas = args.canvas.value
    if (!canvas) return
    scene = new HouseScene(canvas, { labelLayer: args.labelLayer.value, style: style.value, ambience: ambience.value })
    scene.setAppearance({ ui: readUiTheme(), style: style.value, ambience: ambience.value, assets: settings.sceneAssets, tuning: settings.sceneTuning })
    supported.value = scene.supported
    if (!scene.supported) shown.value = true
    // Une scène 3D ne se débogue qu'en la regardant : en développement seulement, le contrôleur est
    // posé sur `window` pour qu'une console (ou un pilote de navigateur) puisse lire ses lumières,
    // ses matériaux et sa caméra sans instrumenter le code à chaque fois.
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
    // Les deux réglages de la scène que les Réglages tiennent (budget de rendu, projection) passent
    // d'abord ; ce que l'appelant impose par `options` gagne ensuite.
    scene.setOptions({ quality: settings.sceneQuality, projection: settings.sceneProjection, ...(args.options ? args.options.value : {}) })
    if (args.house.value) scene.load(args.house.value)
    scene.updateStates(args.states.value)
    ready.value = true
  })

  // seuls les appareils ont changé (placement, auto-placement) → marqueurs seulement, la caméra ne bouge pas
  watch(args.house, (h, prev) => {
    if (!scene || !h) return
    if (prev && sameShell(prev, h)) { scene.updateDevices(h); return }
    // seules des ouvertures ont bougé (on en règle une au doigt) → murs du seul niveau touché
    if (prev && sameShellButOpenings(prev, h)) { scene.updateOpenings(h); return }
    // seules des PLACES ont bougé → marquage au sol et engins qui s'y rangent, rien d'autre
    if (prev && sameShellButParkings(prev, h)) { scene.updateParkings(h); return }
    // seul le RELIEF a changé (on vient de l'enregistrer) → le terrain et ce qui s'y pose
    if (prev && sameShellButRelief(prev, h)) { scene.updateRelief(h); return }
    scene.load(h); scene.setDescriptors(devices.descriptors); scene.updateStates(args.states.value, true)
  })
  watch(() => devices.descriptors, (d) => scene?.setDescriptors(d))
  watch(args.states, (s) => scene?.updateStates(s))
  if (args.options) watch(args.options, (o) => scene?.setOptions(o), { deep: true })
  watch(() => settings.sceneQuality, (q) => scene?.setOptions({ quality: q }))
  watch(() => settings.sceneProjection, (p) => scene?.setOptions({ projection: p }))
  // nextTick : les variables CSS du nouveau thème doivent être appliquées avant lecture
  watch(() => theme.global.name.value, () => { void nextTick(() => scene?.setAppearance({ ui: readUiTheme() })) })
  watch(style, (s) => scene?.setAppearance({ style: s }))
  // Une ambiance refait le ciel (~35 ms) : les curseurs de la météo forcée en envoient une par cran,
  // et le glissement accrochait. Au plus une tous les 100 ms, la dernière toujours appliquée.
  watchThrottled(ambience, (a) => scene?.setAppearance({ ambience: a }), { throttle: 100 })
  watch(() => settings.sceneAssets, (v) => scene?.setAppearance({ assets: v }))
  // Le banc de réglage tire ses curseurs en direct : chemin court (chaîne d'image, halos, trait
  // de pièce), là où `setAppearance` referait matières, ciel et ombres à chaque image du glissement.
  watch(() => settings.sceneTuning, (t) => scene?.setTuning(t))
  // Un quart d'heure : le soleil se déplace de moins de 4°, et la scène ne rend qu'à la demande.
  useIntervalFn(() => { clock.value = new Date() }, 15 * 60 * 1000)
  watch(visibility, (v) => scene?.setPaused(v === 'hidden'))

  onBeforeUnmount(() => { scene?.dispose(); scene = null })

  return {
    supported, ready, preparing, shown,
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
    /** L'édition du relief telle que la scène la voit (rayon, point choisi, brouillon), `null` hors du mode. */
    relief,
    setPlacingParking: (on: boolean) => scene?.setPlacingParking(on),
    onGroundTap: (f: Handler<[[number, number], string | null]>) => { groundTap.add(f) },
    setSelectedParking: (id: string | null) => scene?.setSelectedParking(id),
    focusParking: (id: string) => scene?.focusParking(id),
    onParkingTap: (f: Handler<[string]>) => { parkingTap.add(f) },
    onParkingDrag: (f: Handler<[string, [number, number]]>) => { parkingDrag.add(f) },
    onParkingDrop: (f: Handler<[string]>) => { parkingDrop.add(f) },
    onPlaceTap: (f: Handler<[[number, number]]>) => { placeTap.add(f) },
    moveMarker: (key: string, position: Vec3) => scene?.moveMarker(key, position),
    previewBodyColor: (key: string, color: string | null) => scene?.previewBodyColor(key, color),
    setJournalPoints: (key: string | null, points: readonly JournalPoint[]) => scene?.setJournalPoints(key, points),
    focusJournalPoint: (at: number) => scene?.focusJournalPoint(at),
    setActiveJournalPoint: (at: number | null) => scene?.setActiveJournalPoint(at),
    controller: () => scene,
  }
}

/** Même bâti (niveaux, pièces, site, toit, défauts) : seul `devices` peut différer. */
function sameShell(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, h.site, h.roof, h.defaults])
  return shell(a) === shell(b)
}

/**
 * Même bâti aux OUVERTURES près. `rooms` porte `openings[]` : régler une fenêtre sortait donc de
 * `sameShell` et passait par `load()` complet — toute la maison reconstruite, caméra recentrée, à
 * chaque mouvement de doigt. Ce cas-là a son chemin (`updateOpenings`).
 */
function sameShellButOpenings(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms.map((r) => ({ ...r, openings: [] })), h.site, h.roof, h.defaults])
  return shell(a) === shell(b)
}

/** Même bâti au RELIEF du terrain près : l'enregistrer ne doit pas recentrer la caméra. */
function sameShellButRelief(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, { ...h.site, relief: null }, h.roof, h.defaults])
  return shell(a) === shell(b)
}

/**
 * Même bâti aux PLACES DE STATIONNEMENT près. Elles vivent dans `site`, donc régler une place
 * sortait de `sameShell` et rechargeait la maison entière — caméra recentrée à chaque mouvement de
 * doigt, le même piège que les ouvertures. Ce cas-là a son chemin (`updateParkings`).
 */
function sameShellButParkings(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, { ...h.site, parkings: [] }, h.roof, h.defaults])
  return shell(a) === shell(b)
}
