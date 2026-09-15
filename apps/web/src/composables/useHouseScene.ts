import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue'
import { useTheme } from 'vuetify'
import { useDocumentVisibility, useIntervalFn, useResizeObserver } from '@vueuse/core'
import type { DeviceState, House, Vec3 } from '@kasbah/shared'
import { readUiTheme } from '../three/core/theme'
import { resolveAmbience } from '../three/core/ambience'
import { styleById } from '../three/styles'
import { HouseScene, type HouseSceneOptions } from '../three/HouseScene'
import { useDevicesStore } from '../stores/devices'
import { useSettingsStore } from '../stores/settings'

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
  const ambience = computed(() => resolveAmbience({ mode: settings.sceneAmbience, date: clock.value, geo: geo.value }))

  const deviceTap = new Set<Handler<[string]>>()
  const roomTap = new Set<Handler<[string]>>()
  const zoneTap = new Set<Handler<[string]>>()
  const levelTap = new Set<Handler<[string]>>()
  const backgroundTap = new Set<Handler<[]>>()
  const deviceDrag = new Set<Handler<[string, [number, number], string | null]>>()
  const deviceDrop = new Set<Handler<[string, [number, number], string | null]>>()

  onMounted(() => {
    const canvas = args.canvas.value
    if (!canvas) return
    scene = new HouseScene(canvas, { labelLayer: args.labelLayer.value, style: style.value, ambience: ambience.value })
    scene.setAppearance({ ui: readUiTheme(), style: style.value, ambience: ambience.value, assets: settings.sceneAssets })
    supported.value = scene.supported
    // Une scène 3D ne se débogue qu'en la regardant : en développement seulement, le contrôleur est
    // posé sur `window` pour qu'une console (ou un pilote de navigateur) puisse lire ses lumières,
    // ses matériaux et sa caméra sans instrumenter le code à chaque fois.
    if (import.meta.env.DEV) (window as unknown as { kasbahScene?: HouseScene }).kasbahScene = scene
    if (!scene.supported) return
    scene.on('deviceTap', (key) => deviceTap.forEach((f) => f(key)))
    scene.on('roomTap', (id) => roomTap.forEach((f) => f(id)))
    scene.on('zoneTap', (id) => zoneTap.forEach((f) => f(id)))
    scene.on('levelTap', (id) => levelTap.forEach((f) => f(id)))
    scene.on('backgroundTap', () => backgroundTap.forEach((f) => f()))
    scene.on('deviceDrag', (k, xy, r) => deviceDrag.forEach((f) => f(k, xy, r)))
    scene.on('deviceDrop', (k, xy, r) => deviceDrop.forEach((f) => f(k, xy, r)))

    const parent = canvas.parentElement ?? canvas
    const fit = () => { const r = parent.getBoundingClientRect(); scene?.resize(r.width, r.height) }
    fit()
    useResizeObserver(parent, fit)

    scene.setDescriptors(devices.descriptors)
    if (args.options) scene.setOptions(args.options.value)
    if (args.house.value) scene.load(args.house.value)
    scene.updateStates(args.states.value)
    ready.value = true
  })

  // seuls les appareils ont changé (placement, auto-placement) → marqueurs seulement, la caméra ne bouge pas
  watch(args.house, (h, prev) => {
    if (!scene || !h) return
    if (prev && sameShell(prev, h)) { scene.updateDevices(h); return }
    scene.load(h); scene.setDescriptors(devices.descriptors); scene.updateStates(args.states.value, true)
  })
  watch(() => devices.descriptors, (d) => scene?.setDescriptors(d))
  watch(args.states, (s) => scene?.updateStates(s))
  if (args.options) watch(args.options, (o) => scene?.setOptions(o), { deep: true })
  // nextTick : les variables CSS du nouveau thème doivent être appliquées avant lecture
  watch(() => theme.global.name.value, () => { void nextTick(() => scene?.setAppearance({ ui: readUiTheme() })) })
  watch(style, (s) => scene?.setAppearance({ style: s }))
  watch(ambience, (a) => scene?.setAppearance({ ambience: a }))
  watch(() => settings.sceneAssets, (v) => scene?.setAppearance({ assets: v }))
  // Un quart d'heure : le soleil se déplace de moins de 4°, et la scène ne rend qu'à la demande.
  useIntervalFn(() => { clock.value = new Date() }, 15 * 60 * 1000)
  watch(visibility, (v) => scene?.setPaused(v === 'hidden'))

  onBeforeUnmount(() => { scene?.dispose(); scene = null })

  return {
    supported, ready,
    onDeviceTap: (f: Handler<[string]>) => { deviceTap.add(f) },
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
    moveMarker: (key: string, position: Vec3) => scene?.moveMarker(key, position),
    controller: () => scene,
  }
}

/** Même bâti (niveaux, pièces, site, toit, défauts) : seul `devices` peut différer. */
function sameShell(a: House, b: House): boolean {
  const shell = (h: House) => JSON.stringify([h.levels, h.rooms, h.site, h.roof, h.defaults])
  return shell(a) === shell(b)
}
