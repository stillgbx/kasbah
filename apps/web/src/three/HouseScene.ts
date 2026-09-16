import {
  AmbientLight, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Plane, Raycaster, Scene, Spherical, type Texture, TOUCH, Vector2, Vector3, VSMShadowMap,
  WebGLRenderer, Box3, Fog, Mesh, MeshBasicMaterial, type Material, type MeshStandardMaterial, type Object3D,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  boundsCenter, buildingBounds, computeHouseGeometry, deviceFloorZ, geoDistance, indexHouse, longestEdgeYawDeg, pointInPolygon, resolveDefaults, resolveDeviceLevelId, sitePosition,
  roofBounds, roomBounds, zoneBounds,
  type DeviceDescriptor, type DeviceState, type House, type HouseDevice, type HouseGeometry, type HouseIndex, type Level, type PlacedHouseDevice, type Vec3,
} from '@kasbah/shared'
import { applyLook, backdropColor, createMaterials, disposeMaterials, type MaterialSet } from './builders/materials'
import { loadPackTextures, packById } from './textures/assets'
import { createSkyEnvironment, overcastSky } from './core/sky'
import { DECOR_LAYER, LAMP_LAYER, SITE_DECOR_LAYER } from './core/layers'
import { createPostPipeline, detectQuality, gpuName, PIXEL_RATIO, toneMappingOf, type EffectiveQuality, type PostPipeline, type RenderQuality } from './core/post'
import { fogDistance, sunDirection, type SceneAmbience } from './core/ambience'
import { defaultAmbience, defaultSceneTheme, rolesOf, styleById, type RenderStyle, type StyleLook } from './styles'
import { buildHouse, type HouseNodes, type LevelNodes } from './builders/buildHouse'
import { flatPolygon, flatRing, insetPolygon } from './builders/shapes'
import { clamp, fitBox, sphericalOf, type CameraPose } from './core/cameraFit'
import { boundsToWorldBox } from './core/coords'
import { disposeObject3D } from './core/dispose'
import { createDragDetector, createTapDetector, type DragDetector, type TapEvent } from './core/input'
import { createRenderLoop, type RenderLoop } from './core/renderLoop'
import { resolveSceneTheme, type SceneTheme, type UiTheme } from './core/theme'
import { createTween, easeInOutCubic } from './core/tween'
import { emitsSound, soundRouting } from '../lib/audioRouting'
import { createMarker } from './markers/createMarker'
import type { DeviceMarker, SoundCue } from './markers/DeviceMarker'

// Contrôleur de scène sans Vue. Dépendances injectables (renderer, RAF) → instanciable en Node
// pour les tests sans WebGL. Le composable useHouseScene est son adaptateur réactif.

export type LevelFocusMode = 'hide' | 'ghost'

export interface HouseSceneOptions {
  levelFocusMode: LevelFocusMode
  shadows: boolean
  /** Budget du post-traitement. `auto` mesure la machine puis se corrige (`core/post.ts`). */
  quality: RenderQuality
}

/**
 * Ce qui décide de l'APPARENCE de la scène, en trois axes indépendants : le style de rendu (le
 * goût), l'ambiance (l'heure qu'il fait au-dessus de la maison) et le thème de l'application (les
 * repères posés dessus). Aucun des trois n'impose les deux autres.
 */
export interface SceneAppearance {
  ui: UiTheme
  style: RenderStyle
  ambience: SceneAmbience
  /** Matières en images à la place des procédurales, si le style porte un pack (`textures/assets.ts`). */
  assets: boolean
}

export interface HouseSceneDeps {
  createRenderer?: (canvas: HTMLCanvasElement) => WebGLRenderer | null
  createLabelRenderer?: (layer: HTMLElement) => CSS2DRenderer
  requestFrame?: (cb: (now: number) => void) => number
  cancelFrame?: (h: number) => void
  now?: () => number
  theme?: SceneTheme
  style?: RenderStyle
  ambience?: SceneAmbience
  labelLayer?: HTMLElement | null
  /** Désactive OrbitControls/tap (tests Node). */
  headless?: boolean
}

/** Ce que le voile de débogage affiche (Réglages → Rendu 3D → Débogage). */
export interface SceneDebugStats {
  /** Images rendues par seconde. Le rendu étant à la demande, c'est 0 au repos — et c'est normal. */
  fps: number
  /**
   * Temps passé DANS `render()`, moyenne glissante (ms). Pas du CPU pur : quand la file de commandes
   * du GPU est pleine, le pilote bloque à l'envoi et cette attente s'y retrouve.
   */
  cpuMs: number
  /**
   * Temps écoulé ENTRE deux images, moins celui passé à dessiner. C'est ce que le navigateur fait de
   * son côté : style, disposition, peinture, composition, présentation à l'écran. Un « hors rendu »
   * qui gonfle pendant qu'on tourne désigne tout sauf notre dessin.
   */
  outsideMs: number
  /** Appels de dessin et triangles d'UNE image, toutes passes comprises. */
  calls: number
  triangles: number
  programs: number
  geometries: number
  textures: number
  /** Passes de rendu de la dernière image (1 globale + une par niveau qui a de quoi la mériter). */
  passes: number
  /** Niveaux qui méritent leur passe, indépendamment de ce que la dernière image a dessiné. */
  levelPasses: number
  /** La carte d'ombre du soleil a-t-elle été refaite à la dernière image ? */
  shadowsRebuilt: boolean
  /** Lampes qui portent une ombre cubique (six rendus de profondeur chacune). */
  pointShadows: number
  markers: number
  /**
   * Animations de marqueur en cours (onde d'un lecteur, souffle d'une batterie). Tant qu'il y en a
   * une, la boucle tourne SANS qu'on touche à rien — bridée à `ANIMATION_HZ` (`core/renderLoop.ts`).
   */
  animations: number
  quality: EffectiveQuality
  pixelRatio: number
}

/**
 * Sonde posée autour d'une image RENDUE. Le voile de débogage y branche `stats.js` : c'est la seule
 * façon d'obtenir sa courbe, puisque la scène ne rend qu'à la demande — un `stats.update()` appelé
 * depuis une boucle à part compterait des images qui n'existent pas.
 */
export interface FrameProbe { begin(): void; end(): void }

export interface SceneEvents {
  deviceTap: (key: string) => void
  roomTap: (roomId: string) => void
  zoneTap: (zoneId: string) => void
  /** Tap sur le toit : le niveau qui le porte (il n'a ni pièce ni sol à toucher). */
  levelTap: (levelId: string) => void
  backgroundTap: () => void
  /** Glissement de l'appareil déplaçable : position au sol (repère maison) et pièce survolée (même niveau) ou null. */
  deviceDrag: (key: string, xy: [number, number], roomId: string | null) => void
  deviceDrop: (key: string, xy: [number, number], roomId: string | null) => void
}

const HOME_RADIUS_M = 120
/** Côté de la boîte cadrée autour d'un appareil sélectionné : lui de près, sa pièce autour. */
const DEVICE_FOCUS_SIZE_M = 3
/** Inclinaison permise en cadrant un appareil : plongeante, pour voir par-dessus les murs. */
const DEVICE_FOCUS_POLAR = [(20 * Math.PI) / 180, (40 * Math.PI) / 180] as const
const DEFAULT_AZIMUTH = -Math.PI / 4     // depuis le sud-est
const DEFAULT_POLAR = (55 * Math.PI) / 180
/** Cadrage d'un niveau-toit : plus plongeant que les autres, on vient regarder la dalle elle-même. */
const ROOF_POLAR = (35 * Math.PI) / 180
/** Un éclair : facteur d'exposition et durée (ms) de chaque éclat — deux éclats, le second plus long. */
const FLASH: readonly (readonly [number, number])[] = [[2.6, 70], [1, 90], [1.9, 120]]
/** Entre deux éclairs, au hasard dans cette fourchette (ms). */
const FLASH_EVERY_MS: readonly [number, number] = [6000, 16000]
const WORLD_UP = new Vector3(0, 1, 0)
const WHITE = new Color(0xffffff)
/** Largeur (m) du trait qui souligne la pièce sélectionnée : un pixel de loin, une bande de près. */
const HIGHLIGHT_RING_M = 0.14
/** Rayon (px) autour de l'ancre ou de la pilule où l'appui saisit l'appareil déplaçable. */
const GRAB_RADIUS_PX = { touch: 44, mouse: 28 }
/**
 * Niveau de détail des pilules selon l'ÉCHELLE à l'écran (pixels par mètre au point visé) : de près
 * icône et nom, plus loin l'icône seule, en vue d'ensemble un point. En pixels par mètre plutôt qu'en
 * mètres de distance : à distance égale, une scène étroite (volet ouvert, tablette en portrait) montre
 * la maison plus petite, et c'est la densité à l'écran qui gêne. Posé en `data-lod` sur la couche des
 * marqueurs ; la pilule sélectionnée reste toujours entière (CSS).
 * Repères (scène de 600 px de haut) : appareil cadré 8,8 m ≈ 100 px/m, pièce ≈ 55-70, niveau ≈ 30-40,
 * vue d'ensemble ≈ 20.
 */
type PillLod = 'full' | 'icon' | 'dot'
const PILL_LOD_FULL_MIN_PX_PER_M = 65
const PILL_LOD_ICON_MIN_PX_PER_M = 26
/**
 * Fenêtre pendant laquelle les ombres se refont après un changement de scène. Elle couvre la course
 * animée la plus longue (un volet met 400 ms) : au-delà, rien de ce qui porte une ombre ne bouge plus.
 */
const SHADOW_SETTLE_MS = 700
/** Délai après lequel les étiquettes sont considérées immobiles (et leur promotion relâchée). */
const LABELS_IDLE_MS = 500

export class HouseScene {
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer | null
  readonly labelRenderer: CSS2DRenderer | null
  readonly controls: OrbitControls | null
  readonly loop: RenderLoop
  readonly markers = new Map<string, DeviceMarker>()
  readonly supported: boolean

  private materials: MaterialSet
  private theme: SceneTheme
  private style: RenderStyle
  private ambience: SceneAmbience
  private look: StyleLook
  /** Matières en images demandées (Réglages). Elles ne s'appliquent que si le style porte un pack. */
  private assets = false
  /** Jeton des chargements de matières : un rôle qui arrive pour un style qu'on a quitté est ignoré. */
  private photoGen = 0
  private post: PostPipeline | null = null
  private quality: EffectiveQuality = 'high'
  /** Minuterie de l'orage en cours (prochain éclat, ou éclat en train de s'éteindre) ; `null` = pas d'orage. */
  private stormTimer: ReturnType<typeof setTimeout> | null = null
  /** Direction d'où vient la lumière du jour, monde three. Relue à chaque changement d'ambiance. */
  private sunDir = new Vector3(0.45, 0.82, 0.35)
  /**
   * Les ombres ne dépendent PAS de la caméra : les refaire à chaque image pendant qu'on tourne
   * autour de la maison, c'est redessiner tout le bâti pour rien. Elles se refont pendant un court
   * moment après un changement de scène — le temps qu'une course de volet s'achève.
   */
  private shadowsDirtyUntil = 0
  private perf = { fps: 0, cpuMs: 0, outsideMs: 0, lastStart: 0, wasInteractive: false, frames: 0, since: 0, passes: 1, shadowsRebuilt: false }
  /**
   * Niveaux qui MÉRITENT leur passe : ceux qui portent une lampe allumée (à relire sous sa lumière)
   * ou un décor visible (onde, jauge, guide — que la passe globale n'a pas dessiné). Sur une maison
   * de trente pièces, une passe de plus, c'est tout le bâti redessiné ; en plein jour, lampes
   * éteintes, il n'y en a aucune à faire.
   */
  private levelsNeedingPass = new Set<string>()
  private probe: FrameProbe | null = null
  private labelsVisible = true
  private labelsIdle: ReturnType<typeof setTimeout> | null = null
  private nodes: HouseNodes | null = null
  private house: House | null = null
  private index: HouseIndex | null = null
  private geometry: HouseGeometry | null = null
  private options: HouseSceneOptions = { levelFocusMode: 'hide', shadows: true, quality: 'auto' }
  private focusedLevelId: string | null = null
  private pillLod: PillLod | null = null
  private highlightedRoom: string | null = null
  /** Le trait et le voile posés sur la pièce sélectionnée (`highlightRoom`), dans le groupe de son niveau. */
  private highlightMeshes: Mesh[] = []
  private selectedKey: string | null = null
  private listeners: { [K in keyof SceneEvents]: Set<SceneEvents[K]> } = {
    deviceTap: new Set(), roomTap: new Set(), zoneTap: new Set(), levelTap: new Set(), backgroundTap: new Set(),
    deviceDrag: new Set(), deviceDrop: new Set(),
  }
  private detachInput: (() => void) | null = null
  private movableKeys: string[] = []
  /** Marqueur effectivement attrapé parmi les déplaçables (les modules d'un champ bougent ensemble). */
  private grabbedKey: string | null = null
  private drag: DragDetector | null = null
  private readonly dragPlane = new Plane()
  private readonly dragOffset = new Vector3()
  private lastDrag: { xy: [number, number]; roomId: string | null } | null = null
  private readonly raycaster = new Raycaster()
  private size = { width: 1, height: 1 }
  private cameraTween: { cancel(): void } | null = null
  private readonly deps: HouseSceneDeps
  private readonly sun: DirectionalLight
  private readonly hemi: HemisphereLight
  private readonly ambient: AmbientLight
  /** Largeur (px) du bord droit du canvas couverte par le panneau flottant : le cadrage vise la partie libre. */
  private viewInsetRight = 0
  /** Ce que reflète une carrosserie. Propre aux véhicules : la maison, elle, n'a pas d'environnement. */
  private skyEnv: Texture | null = null
  private descriptors = new Map<string, DeviceDescriptor>()
  private states: Record<string, DeviceState> = {}

  constructor(readonly canvas: HTMLCanvasElement, deps: HouseSceneDeps = {}) {
    this.deps = deps
    this.style = deps.style ?? styleById(null)
    this.ambience = deps.ambience ?? defaultAmbience()
    this.look = this.style.look(this.ambience)
    this.theme = deps.theme ?? defaultSceneTheme()
    this.sunDir = sunDirection(this.ambience)
    this.materials = createMaterials(this.theme, this.look)
    // Voir `render()` : les matrices monde se mettent à jour une fois par image, pas une fois par passe.
    this.scene.matrixWorldAutoUpdate = false
    this.camera = new PerspectiveCamera(38, 1, 0.1, 500)
    this.camera.position.set(20, 18, 20)
    // halos, ondes, jauges — d'un niveau et du jardin — et les lampes d'intérieur (`core/layers.ts`)
    for (const l of [DECOR_LAYER, SITE_DECOR_LAYER, LAMP_LAYER]) this.camera.layers.enable(l)

    const create = deps.createRenderer ?? defaultCreateRenderer
    this.renderer = deps.headless ? null : create(canvas)
    this.supported = deps.headless ? true : this.renderer !== null
    // VSM (Variance Shadow Maps) et non PCFSoftShadowMap : depuis three 0.184 ce dernier est
    // déprécié et retombe sur du PCF DUR (bords crénelés) avec un avertissement en console.
    // VSM floute nativement, piloté par `shadow.radius` / `shadow.blurSamples`.
    if (this.renderer) { this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = VSMShadowMap }
    this.applySky()
    this.applyQuality()
    this.labelRenderer = deps.labelLayer ? (deps.createLabelRenderer ?? ((el) => new CSS2DRenderer({ element: el })))(deps.labelLayer) : null

    this.hemi = new HemisphereLight(0xffffff, 0x8899aa, 1)
    this.ambient = new AmbientLight(0xffffff, 0.25)
    this.sun = new DirectionalLight(0xffffff, 2)
    this.scene.add(this.hemi, this.ambient, this.sun)
    this.applyLighting()
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0005
    // `normalBias` décale le point testé le long de la normale : c'est lui qui tue l'acné des
    // murs rasants, là où `bias` seul décollait l'ombre de son objet (peter-panning).
    this.sun.shadow.normalBias = 0.02
    this.sun.shadow.radius = 3
    this.sun.shadow.blurSamples = 16
    this.scene.add(this.sun)

    if (!deps.headless && this.renderer) {
      this.controls = new OrbitControls(this.camera, canvas)
      this.controls.enableDamping = true
      this.controls.dampingFactor = 0.08
      this.controls.rotateSpeed = 0.6
      this.controls.screenSpacePanning = false
      this.controls.minDistance = 4
      this.controls.maxDistance = 120
      this.controls.maxPolarAngle = Math.PI / 2 - 0.08
      this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }
      this.controls.addEventListener('change', () => this.loop.invalidate())
      this.controls.addEventListener('start', () => { this.cameraTween?.cancel(); this.cameraTween = null })
    } else this.controls = null

    this.loop = createRenderLoop({
      render: (interactive) => this.render(interactive),
      updateControls: () => (this.controls ? this.controls.update() : false),
      ...(deps.requestFrame ? { requestFrame: deps.requestFrame } : {}),
      ...(deps.cancelFrame ? { cancelFrame: deps.cancelFrame } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    })

    if (!deps.headless) this.detachInput = createTapDetector(canvas, { onTap: (ev) => this.handleTap(ev) })
  }

  // ---- événements ---------------------------------------------------------
  on<K extends keyof SceneEvents>(event: K, fn: SceneEvents[K]): () => void {
    this.listeners[event].add(fn)
    return () => this.listeners[event].delete(fn)
  }
  private emit<K extends keyof SceneEvents>(event: K, ...args: Parameters<SceneEvents[K]>) {
    for (const fn of this.listeners[event]) (fn as (...a: Parameters<SceneEvents[K]>) => void)(...args)
  }

  // ---- chargement ---------------------------------------------------------
  load(house: House): void {
    const firstLoad = this.house === null
    this.clear()
    this.house = house
    this.index = indexHouse(house)
    this.geometry = computeHouseGeometry(house)
    this.nodes = buildHouse(this.geometry, this.materials)
    this.invalidateShadows()
    this.nodes.terrain.receiveShadow = true
    this.scene.add(this.nodes.root)
    this.fitSunShadow()
    this.buildMarkers()
    this.refreshLevelPasses()
    const c = this.geometry.bounds
    this.controls?.target.set((c.min[0] + c.max[0]) / 2, 0, -(c.min[1] + c.max[1]) / 2)
    this.applyLevelFocus()
    if (firstLoad) this.resetView(false)
    this.loop.invalidate()
  }

  private fitSunShadow(): void {
    if (!this.geometry || !this.house) return
    // Cadrer la carte d'ombre sur le BÂTI, pas sur les bornes de la maison (qui incluent le
    // terrain) : sur une parcelle large, la même carte 2048 passait l'essentiel de ses texels
    // sur de la pelouse vide. Les ombres portées restent couvertes : dans le repère de la
    // lumière, l'ombre d'une boîte tient exactement dans l'emprise de cette boîte.
    const b = boundsToWorldBox(buildingBounds(this.house, resolveDefaults(this.house.defaults), this.geometry.roof))
    const center = b.getCenter(new Vector3())
    const r = b.getSize(new Vector3()).length() / 2
    // La lumière vient d'où vient le soleil de l'heure courante (`core/ambience.ts`), à une distance
    // qui dégage le bâti — une `DirectionalLight` n'a pas de position au sens physique, seule compte
    // la DIRECTION, mais le frustum d'ombre, lui, part bien de ce point.
    this.sun.position.copy(center).addScaledVector(this.sunDir, Math.max(r * 1.6, 12))
    this.sun.target.position.copy(center)
    this.scene.add(this.sun.target)
    // Frustum ajusté aux huit coins du bâti exprimés dans le repère de la lumière.
    const zAxis = new Vector3().subVectors(this.sun.position, center).normalize()
    const xAxis = new Vector3().crossVectors(new Vector3(0, 1, 0), zAxis).normalize()
    const yAxis = new Vector3().crossVectors(zAxis, xAxis)
    const corner = new Vector3()
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minD = Infinity, maxD = -Infinity
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(this.sun.position)
      const x = corner.dot(xAxis), y = corner.dot(yAxis), d = -corner.dot(zAxis)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (d < minD) minD = d
      if (d > maxD) maxD = d
    }
    const margin = Math.max(0.5, r * 0.08)      // le flou VSM déborde du frustum : marge
    const cam = this.sun.shadow.camera
    cam.left = minX - margin; cam.right = maxX + margin
    cam.bottom = minY - margin; cam.top = maxY + margin
    cam.near = Math.max(0.1, minD - margin); cam.far = maxD + margin + r
    cam.updateProjectionMatrix()
  }

  clear(): void {
    for (const m of this.markers.values()) m.dispose()
    this.markers.clear()
    if (this.nodes) {
      disposeObject3D(this.nodes.root, new Set<Material>(this.materials.all))
      this.nodes = null
    }
    this.house = null
    this.index = null
    this.geometry = null
    this.highlightedRoom = null
    this.highlightMeshes = []                // libérés avec la racine
  }

  /** Descripteurs de plugin (type de marqueur, icône). Reconstruit les marqueurs. */
  setDescriptors(descriptors: Record<string, DeviceDescriptor>): void {
    this.descriptors = new Map(Object.entries(descriptors))
    if (this.house) { this.buildMarkers(); this.updateStates(this.states, true); this.applyLevelFocus(); this.loop.invalidate() }
  }

  /**
   * Où poser un appareil : sa `position` du JSON, ou — pour un VÉHICULE, qui n'en a pas — celle
   * que son GPS lui donne, à condition qu'il soit sur le terrain. `null` = pas de marqueur.
   *
   * Une voiture n'est pas un objet du bâtiment : sa place n'est pas une donnée qu'on écrit, c'est
   * un calcul qui suit le relevé. Garée ailleurs, elle disparaît simplement de la scène.
   */
  private effectivePosition(device: HouseDevice): Vec3 | null {
    if (device.position) return device.position
    const state = device.deviceId ? this.states[device.deviceId] : undefined
    if (state?.kind !== 'vehicle' || !state.location || !this.house) return null
    return sitePosition(this.house, state.location, device.gpsOffset)
  }

  /**
   * Orientation d'un véhicule placé par son GPS, du plus sûr au plus supposé :
   *   1. le `yaw` du JSON, s'il a été posé à la main — l'utilisateur a tranché ;
   *   2. le CAP du fabricant (`headingDeg`), quand il le donne (Tesla) : c'est une mesure ;
   *   3. l'axe de la pièce où la voiture se trouve — un garage range une voiture dans son sens, et
   *      c'est mieux que le nord ;
   *   4. rien : le marqueur reste face à +y.
   *
   * `undefined` plutôt que `0` au bout : le marqueur garde son défaut, personne n'affirme un cap.
   *
   * La correction `yawOffset` s'AJOUTE au cap ainsi déduit (2, 3 et 4) : un cap mesuré reste une
   * mesure — la voiture qui tourne tourne encore —, mais ni lui ni l'axe d'un garage ne disent de
   * quel côté elle s'est garée. Elle ne touche pas au `yaw` posé à la main, qui fait déjà foi.
   */
  private vehicleYaw(device: HouseDevice, state: DeviceState | undefined, position: Vec3): number | undefined {
    if (device.yaw !== undefined) return device.yaw
    if (state?.kind !== 'vehicle' || !this.house) return undefined
    const base = state.headingDeg !== undefined
      ? this.house.origin.heading - state.headingDeg
      : this.enclosingRoomYaw([position[0], position[1]])
    if (device.yawOffset === undefined) return base
    return (base ?? 0) + device.yawOffset
  }

  /**
   * Axe de la pièce FERMÉE qui contient ce point, s'il y en a une. Les pièces sont essayées du
   * niveau le plus bas au plus haut : une voiture est au rez-de-chaussée, pas dans la chambre qui
   * le surplombe.
   */
  private enclosingRoomYaw(xy: [number, number]): number | undefined {
    const index = this.index
    if (!this.house || !index) return undefined
    const elevation = (levelId: string) => index.levelsById.get(levelId)?.elevation ?? 0
    const rooms = [...index.roomsById.values()].sort((a, b) => elevation(a.levelId) - elevation(b.levelId))
    const room = rooms.find((r) => pointInPolygon(xy, r.polygon))
    return room ? (longestEdgeYawDeg(room.polygon) ?? undefined) : undefined
  }

  /**
   * La position GPS d'un véhicule ET son cap : refaire les marqueurs est ce qui les applique, et une
   * voiture qui se gare tourne parfois sans changer de place au mètre près.
   */
  private vehicleFix(state: DeviceState | undefined): string {
    return state?.kind === 'vehicle' && state.location ? `${state.location.lat},${state.location.lon},${state.headingDeg ?? ''}` : ''
  }

  /**
   * Les appareils à dessiner : ceux de la maison, plus les VÉHICULES qu'elle ne connaît pas.
   *
   * Une voiture n'a pas à être déclarée dans `house.json` pour apparaître : ce qui la met dans la
   * scène est son GPS, pas une ligne de configuration.
   *
   * Un véhicule non déclaré est identifié par son **deviceId de plugin** (`tesla:5YJ…`) et non par
   * un id de maison inventé : c'est l'autre espace de clés que l'app sait déjà résoudre (cf.
   * `useDeviceResolver`), et un id fabriqué de toutes pièces ne résolvait ni le nom, ni le kind, ni
   * les commandes — le panneau affirmait alors « cet appareil n'est lié à aucun plugin ».
   */
  private drawable(): HouseDevice[] {
    const devices = this.house?.devices ?? []
    const known = new Set(devices.map((d) => d.deviceId).filter((id): id is string => !!id))
    const strays: HouseDevice[] = []
    for (const [deviceId, descriptor] of this.descriptors) {
      if (descriptor.kind !== 'vehicle' || known.has(deviceId)) continue
      strays.push({ id: deviceId, deviceId, kind: 'vehicle', meta: {} })
    }
    return [...devices, ...strays]
  }

  private buildMarkers(): void {
    if (!this.house || !this.index || !this.nodes || !this.geometry) return
    for (const m of this.markers.values()) m.dispose()
    this.markers.clear()
    const openings = new Map(this.geometry.levels.flatMap((l) => l.openings.map((o) => [o.openingId, o] as const)))
    // Un appareil sans position EFFECTIVE n'a pas de marqueur. Pour la plupart c'est la `position`
    // du JSON ; pour un véhicule, c'est son GPS projeté sur le terrain (`effectivePosition`).
    for (const d of this.drawable()) {
      const position = this.effectivePosition(d)
      if (!position) continue
      const state = d.deviceId ? this.states[d.deviceId] : undefined
      const yaw = d.position ? d.yaw : this.vehicleYaw(d, state, position)
      const device: PlacedHouseDevice = { ...d, position, ...(yaw === undefined ? {} : { yaw }) }
      const descriptor = device.deviceId ? this.descriptors.get(device.deviceId) : undefined
      const levelId = resolveDeviceLevelId(device, this.index.roomsById)
      const levelNodes = levelId ? this.nodes.levels.get(levelId) : undefined
      const parent = levelNodes ? levelNodes.markers : this.nodes.outdoorMarkers
      const opening = device.openingId ? openings.get(device.openingId) : undefined
      const marker = createMarker(device, {
        materials: this.materials, theme: this.theme, glow: this.look.glow, outdoor: !levelNodes, descriptor, ...(opening ? { opening } : {}),
        addAnimation: (a) => this.loop.addAnimation(a),
        invalidate: () => this.loop.invalidate(),
        onTap: (key) => this.emit('deviceTap', key),
        label: device.name ?? descriptor?.name ?? device.id,
      }, (state) => this.isAtHome(state))
      marker.object.position.set(device.position[0], device.position[1], this.localZ(device, device.position[2]))
      parent.add(marker.object)
      marker.setSelected(this.selectedKey === device.id)
      // le guide (anneau, fil, cône) ne se dessine que sur le PREMIER déplaçable — dix modules d'un
      // champ donneraient dix anneaux pour un seul objet qui bouge — mais TOUS se glissent
      if (this.movableKeys.includes(device.id)) marker.setMoving(true, device.position[2], this.movableKeys[0] === device.id)
      this.markers.set(device.id, marker)
    }
  }

  /** z local au groupe parent : tel quel sous un niveau, décalé du terrain pour un appareil extérieur. */
  private localZ(device: HouseDevice, z: number): number {
    const levelId = resolveDeviceLevelId(device, this.index!.roomsById)
    return levelId && this.nodes!.levels.has(levelId) ? z : z + deviceFloorZ(this.house!, device, this.index!)
  }

  /** Seuls les appareils ont changé (placement) : on refait les marqueurs sans toucher aux murs ni à la caméra. */
  updateDevices(house: House): void {
    if (!this.nodes) { this.load(house); return }
    this.house = house
    this.index = indexHouse(house)
    this.buildMarkers()
    this.updateStates(this.states, true)
    this.applyLevelFocus()
    this.refreshLevelPasses()
    this.invalidateShadows()
    this.loop.invalidate()
  }

  // ---- mode « déplacer » ---------------------------------------------------
  /**
   * Rend déplaçable au doigt un appareil — ou un GROUPE de marqueurs qui bougent ensemble : les
   * modules d'un champ de panneaux, dont on attrape n'importe lequel pour emmener le champ entier.
   * `null` sort du mode. Les événements de glissement nomment le marqueur ATTRAPÉ ; à l'appelant d'en
   * déduire ce que devient le groupe.
   */
  /** Le guide du mode « déplacer » est un décor : le niveau qui le porte a besoin de sa passe. */
  setMovable(key: string | string[] | null): void {
    this.movableKeys = key === null ? [] : Array.isArray(key) ? key : [key]
    this.grabbedKey = null
    for (const m of this.markers.values()) m.setMoving(this.movableKeys.includes(m.key), m.device.position[2], m.key === this.movableKeys[0])
    this.refreshLevelPasses()
    this.drag?.detach()
    this.drag = null
    if (this.movableKeys.length > 0 && !this.deps.headless) {
      this.drag = createDragDetector(this.canvas, {
        hitTest: (ev) => {
          this.grabbedKey = this.movableKeys.find((k) => this.grabs(k, ev)) ?? null
          return this.grabbedKey !== null
        },
        onStart: () => { if (this.grabbedKey) this.startDrag(this.grabbedKey) },
        onMove: (ev) => { if (this.grabbedKey) this.moveDrag(this.grabbedKey, ev) },
        onEnd: (_ev, moved) => { if (this.grabbedKey) this.endDrag(this.grabbedKey, moved) },
      })
    }
    this.loop.invalidate()
  }

  /**
   * Teinte d'une carrosserie MONTRÉE le temps qu'on la choisit (aperçu) : rien n'est écrit, et la
   * maison reprend la main dès que le choix est validé. `null` rend la teinte d'avant.
   */
  previewBodyColor(key: string, color: string | null): void {
    this.markers.get(key)?.previewColor(color)
  }

  /** Déplace un marqueur (aperçu) ; `position` dans le repère maison (z relatif au sol de l'ancre). */
  moveMarker(key: string, position: Vec3): void {
    const marker = this.markers.get(key)
    if (!marker || !this.house || !this.index) return
    marker.object.position.set(position[0], position[1], this.localZ(marker.device, position[2]))
    marker.setGuideHeight(position[2])
    this.invalidateShadows()               // l'appareil déplacé emmène son ombre
    this.loop.invalidate()
  }

  private grabs(key: string, ev: TapEvent): boolean {
    const marker = this.markers.get(key)
    if (!marker || !marker.visibleInScene) return false
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    if (this.raycaster.intersectObjects(marker.pickables, false).length > 0) return true
    const radius = ev.pointerType === 'mouse' ? GRAB_RADIUS_PX.mouse : GRAB_RADIUS_PX.touch
    const near = (p: Vector3) => {
      p.project(this.camera)
      return Math.hypot((p.x - ev.ndc.x) * this.size.width / 2, (p.y - ev.ndc.y) * this.size.height / 2) <= radius
    }
    return near(marker.worldAnchor()) || near(marker.worldPill())
  }

  private startDrag(key: string): void {
    const marker = this.markers.get(key)
    if (!marker) return
    if (this.controls) this.controls.enabled = false
    this.cameraTween?.cancel()
    // plan horizontal à la hauteur de l'appareil : il suit exactement le doigt, sans saut initial
    const anchor = marker.worldAnchor()
    this.dragPlane.setFromNormalAndCoplanarPoint(WORLD_UP, anchor)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    this.dragOffset.copy(hit ? hit.sub(anchor) : new Vector3())
    this.lastDrag = null
  }

  private moveDrag(key: string, ev: TapEvent): void {
    const marker = this.markers.get(key)
    if (!marker) return
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    if (!hit) return
    hit.sub(this.dragOffset)
    const xy: [number, number] = [hit.x, -hit.z]   // monde (x, y, z) ← maison (x, z, -y)
    const roomId = this.roomAt(marker.device, xy)
    this.lastDrag = { xy, roomId }
    this.emit('deviceDrag', key, xy, roomId)
  }

  private endDrag(key: string, moved: boolean): void {
    if (this.controls) this.controls.enabled = true
    if (moved && this.lastDrag) this.emit('deviceDrop', key, this.lastDrag.xy, this.lastDrag.roomId)
    this.lastDrag = null
  }

  /** Pièce du niveau de l'appareil contenant le point, sinon null (extérieur, hors de toute pièce). */
  private roomAt(device: HouseDevice, xy: [number, number]): string | null {
    if (!this.index) return null
    const levelId = resolveDeviceLevelId(device, this.index.roomsById)
    if (!levelId) return null
    return (this.index.roomsByLevel.get(levelId) ?? []).find((r) => pointInPolygon(xy, r.polygon))?.id ?? null
  }

  private isAtHome(state: DeviceState): boolean {
    if (state.kind !== 'vehicle' || !state.location || !this.house) return true
    return geoDistance(this.house.origin, state.location) < HOME_RADIUS_M
  }

  // ---- états --------------------------------------------------------------
  /**
   * Diff par référence : seuls les appareils dont l'objet d'état a changé sont mis à jour — ou dont le
   * SON a changé : une barre de son relaie l'état de la TV (`lib/audioRouting.ts`), elle bouge donc
   * quand c'est la TV qui change.
   */
  updateStates(states: Record<string, DeviceState>, force = false): void {
    const prev = this.states
    this.states = states
    // Un véhicule qui a bougé change de PLACE, pas seulement d'état : son marqueur n'existe
    // peut-être pas encore (il vient de rentrer) ou n'a plus lieu d'être (il est parti). Rare —
    // une lecture toutes les dix minutes — donc refaire les marqueurs coûte moins cher que de
    // maintenir un cas particulier dans la boucle d'états.
    if (!force && this.house) {
      const moved = this.drawable().some((d) => {
        if (d.position || !d.deviceId) return false
        return this.vehicleFix(states[d.deviceId]) !== this.vehicleFix(prev[d.deviceId])
      })
      if (moved) { this.buildMarkers(); this.applyLevelFocus() }
    }
    const routing = soundRouting(this.house?.devices ?? [], states)
    let touched = false
    for (const marker of this.markers.values()) {
      const id = marker.device.deviceId
      if (!id) { if (force) marker.update(undefined); continue }
      const next = states[id]
      const relay = routing.relays.get(id)
      const sound: SoundCue = { emits: emitsSound(id, next, routing), ...(relay && states[relay] ? { relayFrom: states[relay] } : {}) }
      const was = marker.currentSound
      const soundChanged = !was || was.emits !== sound.emits || was.relayFrom !== sound.relayFrom
      if (force || next !== prev[id] || !marker.currentState || soundChanged) {
        marker.update(next, sound)
        touched = true
        // Seuls ces trois-là DÉPLACENT quelque chose qui porte une ombre (un tablier, une voiture) ou
        // en allument une (une lampe de jardin). Un capteur qui publie sa mesure toutes les secondes
        // ne doit pas relancer un relevé d'ombres.
        if (next && (next.kind === 'cover' || next.kind === 'vehicle' || next.kind === 'light')) this.invalidateShadows()
      }
    }
    if (touched) { this.refreshLevelPasses(); this.loop.invalidate() }
  }

  // ---- focus / caméra -----------------------------------------------------
  setOptions(opts: Partial<HouseSceneOptions>): void {
    this.invalidateShadows()
    const before = this.options.quality
    this.options = { ...this.options, ...opts }
    if (this.renderer) this.renderer.shadowMap.enabled = this.options.shadows
    if (this.options.quality !== before) this.applyQuality()
    this.applyLevelFocus()
    this.loop.invalidate()
  }

  focusLevel(levelId: string | null): void {
    this.focusedLevelId = levelId
    this.applyLevelFocus()
    this.loop.invalidate()
  }

  private applyLevelFocus(): void {
    if (!this.nodes || !this.house) return
    const focused = this.focusedLevelId ? this.house.levels.find((l) => l.id === this.focusedLevelId) : null
    for (const [id, nodes] of this.nodes.levels) {
      const level = this.house.levels.find((l) => l.id === id)!
      const above = !!focused && level.elevation > focused.elevation
      const ghost = above && this.options.levelFocusMode === 'ghost'
      nodes.group.visible = !above || ghost
      nodes.markers.visible = !above
      for (const mesh of [...nodes.walls, ...nodes.floors.values(), ...nodes.panes]) {
        mesh.material = ghost ? this.materials.ghost : (mesh.userData.material as Material)
      }
      // pilules : seulement le niveau focalisé (lisibilité) ; l'appareil sélectionné reste visible
      for (const m of this.markers.values()) if (m.object.parent === nodes.markers) m.setPillVisible(focused?.id === id)
    }
    // le toit se voit en vue d'ensemble et depuis le niveau qu'il porte (le toit déclaré comme un
    // niveau, pour ses panneaux) ; depuis un étage, il cacherait les pièces
    if (this.nodes.roof) this.nodes.roof.visible = !focused || this.isRoofLevel(focused)
    for (const m of this.markers.values()) if (m.object.parent === this.nodes.outdoorMarkers) m.setPillVisible(true)
  }

  /** Les nœuds Three d'un niveau (tests, diagnostic). */
  nodesOf(levelId: string): LevelNodes | undefined { return this.nodes?.levels.get(levelId) }

  /** Niveau posé au niveau du toit ou au-dessus : le toit lui appartient, il ne le masque pas. */
  private isRoofLevel(level: Level): boolean {
    const roof = this.geometry?.roof
    return !!roof && level.elevation >= roof.zBase - 1e-3
  }

  /** Le niveau que porte le toit, s'il est déclaré (pour ses panneaux, sa caméra…). */
  private roofLevel(): Level | undefined {
    return this.house?.levels.find((l) => this.isRoofLevel(l))
  }

  resetView(animate = true): void {
    if (!this.house || !this.geometry) return
    const box = boundsToWorldBox(buildingBounds(this.house, resolveDefaults(this.house.defaults), this.geometry.roof))
    box.expandByScalar(2)
    this.flyTo(box, DEFAULT_AZIMUTH, DEFAULT_POLAR, animate, 1.1)
  }

  focusRoom(roomId: string, animate = true): void {
    if (!this.house) return
    const room = this.house.rooms.find((r) => r.id === roomId)
    if (!room) return
    if (this.focusedLevelId !== room.levelId) this.focusLevel(room.levelId)
    const b = roomBounds(this.house, roomId, resolveDefaults(this.house.defaults))
    if (!b) return
    this.highlightRoom(roomId)
    const { azimuth, polar } = this.currentSpherical()
    this.flyTo(boundsToWorldBox(b), azimuth, clamp(polar, (35 * Math.PI) / 180, (60 * Math.PI) / 180), animate, 1.08)
  }

  focusZone(zoneId: string, animate = true): void {
    if (!this.house) return
    const b = zoneBounds(this.house, zoneId)
    if (!b) return
    this.highlightRoom(null)
    const { azimuth, polar } = this.currentSpherical()
    this.flyTo(boundsToWorldBox(b), azimuth, clamp(polar, (35 * Math.PI) / 180, (60 * Math.PI) / 180), animate, 1.05)
  }

  /**
   * Cadre l'appareil lui-même (et non sa pièce) : boîte fixe autour de son ancre, donc la même
   * distance quelle que soit la taille de la pièce. `controls.minDistance` borne le rapproché.
   *
   * Plongée plus forte que pour une pièce (`DEVICE_FOCUS_POLAR`) : de près, un mur extérieur à
   * moins de deux mètres passe devant l'appareil sous 30° au-dessus de l'horizon. L'azimut, lui,
   * est choisi (`roomSideAzimuth`) et non conservé.
   */
  focusDevice(key: string, animate = true): void {
    if (!this.house || !this.index) return
    const found = this.drawable().find((d) => d.id === key)
    const marker = this.markers.get(key)
    // un marqueur existe : l'appareil a donc une place (`buildMarkers` n'en fait pas pour les autres)
    const position = found ? this.effectivePosition(found) : null
    if (!found || !position || !marker) return
    const device: PlacedHouseDevice = { ...found, position }
    const levelId = resolveDeviceLevelId(device, this.index.roomsById)
    if (levelId && this.focusedLevelId !== levelId) this.focusLevel(levelId)
    const size = new Vector3(DEVICE_FOCUS_SIZE_M, DEVICE_FOCUS_SIZE_M, DEVICE_FOCUS_SIZE_M)
    const box = new Box3().setFromCenterAndSize(marker.worldAnchor(), size)
    const { azimuth, polar } = this.currentSpherical()
    const inward = this.roomSideAzimuth(device)
    this.flyTo(box, inward ?? azimuth, clamp(polar, DEVICE_FOCUS_POLAR[0], DEVICE_FOCUS_POLAR[1]), animate, 1.1)
  }

  /**
   * Azimut qui regarde l'appareil DEPUIS le centre de sa pièce. Sans ça, un appareil contre un mur
   * extérieur (lampe, volet, téléviseur : le cas courant) se cadrait derrière ce mur, et l'on ne
   * voyait que sa face et la pelouse. `null` s'il est au milieu de la pièce ou hors pièce : on garde
   * alors l'azimut de l'utilisateur.
   */
  private roomSideAzimuth(device: PlacedHouseDevice): number | null {
    if (!device.roomId || !this.house) return null
    const b = roomBounds(this.house, device.roomId, resolveDefaults(this.house.defaults))
    if (!b) return null
    const c = boundsCenter(b)
    const dx = c[0] - device.position[0], dy = c[1] - device.position[1]
    if (Math.hypot(dx, dy) < 0.5) return null
    return Math.atan2(dx, -dy)   // repère monde : x est, z = -y maison
  }

  focusOutdoor(animate = true): void {
    if (!this.geometry) return
    this.focusLevel(null)
    this.highlightRoom(null)
    this.flyTo(boundsToWorldBox(this.geometry.bounds), DEFAULT_AZIMUTH, (50 * Math.PI) / 180, animate, 1.05)
  }

  /** Cadre un niveau entier (après un changement d'onglet). */
  focusLevelView(levelId: string, animate = true): void {
    if (!this.house || !this.geometry) return
    this.focusLevel(levelId)
    this.highlightRoom(null)
    // le niveau du toit se cadre SUR le toit (il n'a ni pièce ni contour à cadrer autrement) : cadrer
    // le bâti entier le laissait petit et lointain, alors que c'est lui qu'on vient voir
    const level = this.house.levels.find((l) => l.id === levelId)
    const roof = level && this.isRoofLevel(level) ? this.geometry.roof : undefined
    const box = boundsToWorldBox(roof ? roofBounds(roof) : buildingBounds(this.house, resolveDefaults(this.house.defaults)))
    const { azimuth } = this.currentSpherical()
    this.flyTo(box, azimuth, roof ? ROOF_POLAR : (52 * Math.PI) / 180, animate, 1.15)
  }

  private currentSpherical() {
    const target = this.controls?.target ?? new Vector3()
    return sphericalOf(this.camera.position, target)
  }

  private flyTo(box: Box3, azimuth: number, polar: number, animate: boolean, padding: number): void {
    const pose = fitBox(box, this.camera.fov, this.camera.aspect, { azimuth, polar, padding })
    pose.position.y = Math.max(pose.position.y, 0.5)
    this.moveCamera(pose, animate)
  }

  private moveCamera(pose: CameraPose, animate: boolean): void {
    const target = this.controls?.target ?? new Vector3()
    this.cameraTween?.cancel()
    if (!animate || !this.controls) {
      this.camera.position.copy(pose.position)
      target.copy(pose.target)
      this.controls?.update()
      this.loop.invalidate()
      return
    }
    const fromPos = this.camera.position.clone(), fromTarget = target.clone()
    const tw = createTween({
      durationMs: 650, now: this.deps.now?.() ?? performance.now(), easing: easeInOutCubic,
      onUpdate: (k) => {
        this.camera.position.lerpVectors(fromPos, pose.position, k)
        target.lerpVectors(fromTarget, pose.target, k)
        this.controls!.update()
      },
    })
    this.cameraTween = tw
    this.loop.addTween(tw)
  }

  /** Surbrillance d'une pièce : le sol tire vers l'accent (comme un onglet actif). */
  /**
   * La pièce sélectionnée porte un TRAIT d'accent le long de ses murs et un voile léger sur son sol,
   * tous deux NON éclairés : ils ne réagissent pas aux lampes et n'altèrent pas le sol dessous.
   * Auparavant (jusqu'au 2026-09-15) le sol lui-même tirait vers l'accent (`color.lerp` 0,45 et une
   * part émise la nuit) : les flaques colorées des lampes en étaient faussées, et la teinte se
   * perdait sur un parquet sombre ou sous un ciel noir. Le trait est plus clair que le blanc
   * (couleur × 1,6) : la nuit, le bloom en fait un néon, comme la maquette.
   */
  highlightRoom(roomId: string | null): void {
    if (!this.nodes) return
    // les clones de sol reprennent la couleur de leur nature (après un changement de style ou d'heure)
    for (const nodes of this.nodes.levels.values()) {
      for (const mesh of nodes.floors.values()) {
        const m = mesh.userData.material as MeshStandardMaterial
        const base = mesh.userData.baseMaterial as MeshStandardMaterial
        m.color.copy(base.color)
        m.emissive.copy(base.emissive)
      }
    }
    for (const m of this.highlightMeshes) { m.removeFromParent(); m.geometry.dispose(); (m.material as Material).dispose() }
    this.highlightMeshes = []
    const floor = roomId && this.geometry ? this.geometry.levels.flatMap((l) => l.floors).find((f) => f.roomId === roomId) : undefined
    const level = floor ? this.nodes.levels.get(floor.levelId) : undefined
    if (floor && level) {
      const accent = this.theme.primary
      // Le trait est éclairci (un accent sombre, le sarcelle du thème Kasbah, resterait un filet
      // terne) et poussé JUSTE au-dessus de 1 : c'est ce dépassement que le bloom accroche la nuit.
      // Réglé à l'œil avec l'utilisateur : × 1,8 brûlait en blanc, × 1 « ne glow plus assez ».
      // Le voile est léger, il ne teinte qu'à peine.
      // Dessiné PAR-DESSUS les murs (`depthTest: false`, comme le guide du mode déplacer) : en vue
      // oblique, le pied d'un mur cachait le trait qui le longe.
      const ring = new Mesh(
        flatRing(floor.polygon, insetPolygon(floor.polygon, HIGHLIGHT_RING_M), floor.z1 + 0.012),
        new MeshBasicMaterial({ color: accent.clone().lerp(WHITE, 0.2).multiplyScalar(1.15), transparent: true, opacity: 0.92, depthWrite: false, depthTest: false }),
      )
      const fill = new Mesh(
        flatPolygon(floor.polygon, floor.z1 + 0.008),
        new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.1, depthWrite: false }),
      )
      for (const m of [fill, ring]) { m.name = 'highlight'; level.group.add(m); this.highlightMeshes.push(m) }
    }
    this.highlightedRoom = roomId
    this.loop.invalidate()
  }

  // ---- sélection ----------------------------------------------------------
  setSelected(key: string | null): void {
    if (this.selectedKey) this.markers.get(this.selectedKey)?.setSelected(false)
    this.selectedKey = key
    if (key) this.markers.get(key)?.setSelected(true)
    this.applyLevelFocus()
    this.loop.invalidate()
  }

  /** Sélection au point NDC par lancer de rayon : objet d'appareil, sol de pièce, toit, zone. */
  pick(ndc: { x: number; y: number }): { kind: 'device'; key: string } | { kind: 'room'; roomId: string } | { kind: 'level'; levelId: string } | { kind: 'zone'; zoneId: string } | null {
    if (!this.nodes) return null
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera)
    const pickables: Object3D[] = []
    for (const m of this.markers.values()) if (m.visibleInScene) pickables.push(...m.pickables)
    const hitDevice = this.raycaster.intersectObjects(pickables, false)[0]
    if (hitDevice) return { kind: 'device', key: hitDevice.object.userData.key as string }
    const floors: Mesh[] = []
    for (const nodes of this.nodes.levels.values()) if (nodes.group.visible && nodes.markers.visible) floors.push(...nodes.floors.values())
    const hitFloor = this.raycaster.intersectObjects(floors, false)[0]
    // Le toit cache ce qu'il couvre : un tap dessus va au niveau qui le porte, jamais à la pièce
    // qu'on ne voit pas dessous (sans quoi le toit disparaissait au profit de l'étage).
    const roofNode = this.nodes.roof
    const roofLevel = roofNode?.visible ? this.roofLevel() : undefined
    if (roofNode && roofLevel) {
      const hitRoof = this.raycaster.intersectObject(roofNode, false)[0]
      if (hitRoof && (!hitFloor || hitRoof.distance <= hitFloor.distance)) return { kind: 'level', levelId: roofLevel.id }
    }
    if (hitFloor) return { kind: 'room', roomId: hitFloor.object.userData.roomId as string }
    // les zones du jardin ne se sélectionnent qu'en vue d'ensemble / jardin
    if (this.focusedLevelId === null) {
      const hitZone = this.raycaster.intersectObjects([...this.nodes.zones.values()], false)[0]
      if (hitZone) return { kind: 'zone', zoneId: hitZone.object.userData.zoneId as string }
    }
    return null
  }

  private handleTap(ev: TapEvent): void {
    if (this.drag?.active()) return   // fin d'un glissement, pas un tap
    const hit = this.pick(ev.ndc)
    if (!hit) { this.emit('backgroundTap'); return }
    if (hit.kind === 'device') this.emit('deviceTap', hit.key)
    else if (hit.kind === 'room') this.emit('roomTap', hit.roomId)
    else if (hit.kind === 'level') this.emit('levelTap', hit.levelId)
    else this.emit('zoneTap', hit.zoneId)
  }

  // ---- apparence / taille / rendu ----------------------------------------
  /**
   * (Re)construit le ciel et le pose sur `scene.environment` : c'est la seule source de reflets de
   * la scène, et sans elle tout matériau un peu métallique ou lisse rend de l'argile. Il se refait à
   * chaque changement de style ou d'heure — et l'ancien se libère, une carte PMREM tient en mémoire
   * vidéo. Le ciel n'est jamais affiché : le fond du canvas est sa couleur d'horizon, à plat.
   */
  private applySky(): void {
    // la météo grise le ciel du style (nuages) et, quand l'air se voit, noie le lointain dans le fond
    const sky = overcastSky(this.look.sky, this.ambience.cloudiness)
    this.skyEnv?.dispose()
    this.skyEnv = createSkyEnvironment(this.renderer, sky, this.sunDir)
    this.scene.environment = this.skyEnv
    this.scene.environmentIntensity = sky.intensity
    const backdrop = backdropColor(sky)
    this.renderer?.setClearColor(backdrop, 1)
    const far = fogDistance(this.ambience)
    this.scene.fog = far === null ? null : new Fog(backdrop, far * 0.35, far)
  }

  /**
   * Le seul point d'entrée de l'apparence. Les trois axes sont indépendants : on peut changer
   * l'heure sans changer de style, et le thème de l'app sans toucher ni l'un ni l'autre.
   *
   * Changer de STYLE repasse des cartes aux matériaux (donc recompile leurs shaders) ; changer
   * d'HEURE ne fait que muter des couleurs et des intensités. C'est pour cette différence de prix
   * que `applyLook` compare les cartes avant de demander une recompilation.
   */
  /**
   * Redemande un relevé des ombres : après un changement de géométrie, d'appareil ou de soleil. La
   * fenêtre couvre les courses animées (un volet met 400 ms à descendre) sans quoi l'ombre resterait
   * celle d'avant. Une caméra qui tourne n'appelle JAMAIS ceci — c'est tout l'intérêt.
   */
  invalidateShadows(ms = SHADOW_SETTLE_MS): void {
    this.shadowsDirtyUntil = (this.deps.now?.() ?? performance.now()) + ms
  }

  /**
   * Montre ou cache la couche des pilules (DOM). Outil de DIAGNOSTIC du voile de débogage : soixante
   * pilules déplacées à chaque image ont un coût que ni `renderer.info` ni le temps passé dans
   * `render()` ne montrent entièrement — le reste est payé par le style et le compositeur du
   * navigateur. Les éteindre le chiffre, sur la machine qui a le problème.
   */
  /**
   * Marque la couche des étiquettes comme EN MOUVEMENT. C'est ce qui autorise leur promotion en
   * couche de composition (`will-change`, `styles/app.css`) — et seulement à ce moment-là : une
   * promotion permanente sur quarante éléments garde autant de textures vivantes pour rien, et c'est
   * précisément ce que la spécification déconseille. Le drapeau retombe une demi-seconde après la
   * dernière image.
   */
  private markLabelsMoving(): void {
    const layer = this.labelRenderer?.domElement
    if (!layer) return
    if (layer.dataset.moving !== '1') layer.dataset.moving = '1'
    if (this.labelsIdle !== null) clearTimeout(this.labelsIdle)
    this.labelsIdle = setTimeout(() => { layer.dataset.moving = '0'; this.labelsIdle = null }, LABELS_IDLE_MS)
  }

  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible
    if (this.labelRenderer) this.labelRenderer.domElement.style.display = visible ? '' : 'none'
    this.loop.invalidate()
  }

  /** Branche (ou débranche) une sonde autour de chaque image rendue — `stats.js` du voile de débogage. */
  setProbe(probe: FrameProbe | null): void { this.probe = probe }

  /** Relevé pour le voile de débogage (Réglages → Rendu 3D). Lu à la demande, jamais pendant le rendu. */
  debugStats(): SceneDebugStats {
    const info = this.renderer?.info
    let pointShadows = 0
    for (const m of this.markers.values()) m.object.traverse((o) => { if ((o as { isPointLight?: boolean }).isPointLight && (o as { castShadow?: boolean }).castShadow) pointShadows++ })
    return {
      fps: Math.round(this.perf.fps),
      cpuMs: Math.round(this.perf.cpuMs * 10) / 10,
      outsideMs: Math.round(this.perf.outsideMs * 10) / 10,
      calls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
      programs: info?.programs?.length ?? 0,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      passes: this.perf.passes,
      levelPasses: this.levelsNeedingPass.size,
      shadowsRebuilt: this.perf.shadowsRebuilt,
      pointShadows,
      markers: this.markers.size,
      animations: this.loop.animationCount,
      quality: this.quality,
      pixelRatio: this.renderer?.getPixelRatio() ?? 1,
    }
  }

  setAppearance(next: Partial<SceneAppearance>): void {
    if (next.style) this.style = next.style
    if (next.ambience) { this.ambience = next.ambience; this.sunDir = sunDirection(this.ambience) }
    if (next.assets !== undefined) this.assets = next.assets
    if (next.style || next.ambience) this.look = this.style.look(this.ambience)
    this.theme = resolveSceneTheme(next.ui ?? this.theme, this.look.palette, this.ambience)
    this.photoGen++                        // les images d'un style ou d'un réglage quittés n'ont plus preneur
    this.applyMaterials()
    this.applySky()
    this.applyLighting()
    if (this.post) this.post.setLook(this.look.post)
    else if (this.renderer) {
      this.renderer.toneMapping = toneMappingOf(this.look.post)
      this.renderer.toneMappingExposure = this.look.post.exposure
    }
    for (const m of this.markers.values()) m.setTheme(this.theme, this.look.glow)
    this.highlightRoom(this.highlightedRoom)
    this.refreshLevelPasses()              // l'heure change ce qu'une lampe allumée vaut
    this.invalidateShadows()               // le soleil a pu bouger
    this.syncStorm()
    this.loop.invalidate()
  }

  /**
   * Orage : un éclair de temps en temps — deux éclats, un court et un plus long, comme un vrai. Ce
   * n'est PAS une animation de la boucle (qui tournerait à 20 Hz tout l'orage pour rien) : des
   * minuteries qui ne demandent qu'une image par éclat, par l'exposition. Le seul état est la
   * minuterie en cours, arrêtée dès que l'orage passe ou que la scène est détruite.
   */
  private syncStorm(): void {
    const on = !!this.ambience.storm
    if (on && this.stormTimer === null) this.stormStep(FLASH.length)
    if (!on && this.stormTimer !== null) { clearTimeout(this.stormTimer); this.stormTimer = null }
  }

  private stormStep(i: number): void {
    const step = FLASH[i]
    if (!step) {
      this.setExposureFactor(1)
      this.stormTimer = setTimeout(() => this.stormStep(0), FLASH_EVERY_MS[0] + Math.random() * (FLASH_EVERY_MS[1] - FLASH_EVERY_MS[0]))
      return
    }
    this.setExposureFactor(step[0])
    this.stormTimer = setTimeout(() => this.stormStep(i + 1), step[1])
  }

  /** Multiplie l'exposition du style, le temps d'un éclat ; 1 la rend au style. */
  private setExposureFactor(k: number): void {
    const post = { ...this.look.post, exposure: this.look.post.exposure * k }
    if (this.post) this.post.setLook(post)
    else if (this.renderer) this.renderer.toneMappingExposure = post.exposure
    this.loop.invalidate()
  }

  /**
   * Les matériaux, avec les matières en images si le style porte un pack et que l'utilisateur les
   * veut. Les images arrivent APRÈS : en attendant, le procédural tient la place, et chaque rôle
   * chargé repasse par ici avec une carte de plus. Le jeton écarte les arrivées pour un style ou un
   * réglage qu'on a quitté depuis — et une scène détruite, qui l'incrémente en partant.
   */
  private applyMaterials(): void {
    const pack = this.assets ? packById(this.style.assets) : undefined
    const gen = this.photoGen
    const photos = pack
      ? loadPackTextures(pack, rolesOf(this.look.surfaces), () => {
        if (gen !== this.photoGen) return
        this.applyMaterials()
        this.highlightRoom(this.highlightedRoom)   // recopie les couleurs des clones, et redessine
      })
      : undefined
    applyLook(this.materials, this.theme, this.look, photos, { wetness: this.ambience.wetness ?? 0, snow: this.ambience.snow ?? 0 })
    this.syncFloorClones()
  }

  /**
   * Les sols portent un CLONE du matériau de leur nature, pour que la surbrillance d'une pièce ne
   * teinte pas toutes les autres. Un changement de style change les cartes du matériau d'origine :
   * sans cette recopie, un clone garderait la matière du style précédent.
   */
  private syncFloorClones(): void {
    if (!this.nodes) return
    for (const nodes of this.nodes.levels.values()) {
      for (const mesh of nodes.floors.values()) {
        const m = mesh.userData.material as MeshStandardMaterial
        const base = mesh.userData.baseMaterial as MeshStandardMaterial
        if (m.map === base.map && m.roughness === base.roughness) continue
        m.map = base.map; m.normalMap = base.normalMap
        m.roughnessMap = base.roughnessMap; m.metalnessMap = base.metalnessMap
        m.normalScale.copy(base.normalScale)
        m.roughness = base.roughness; m.metalness = base.metalness
        m.emissive.copy(base.emissive)
        m.needsUpdate = true
      }
    }
  }

  /**
   * L'éclairage vient du STYLE, la direction du soleil de l'AMBIANCE. Il n'y a plus de « jour en
   * thème clair, nuit en thème sombre » : la maison a sa propre heure (`core/ambience.ts`), et c'est
   * elle qui décide si ce qui l'éclaire est le soleil ou ses propres lampes.
   */
  private applyLighting(): void {
    const l = this.look.lighting
    this.hemi.color.copy(l.hemiSky)
    this.hemi.groundColor.copy(l.hemiGround)
    this.hemi.intensity = l.hemiIntensity
    this.ambient.intensity = l.ambientIntensity
    this.sun.color.copy(l.sunColor)
    this.sun.intensity = l.sunIntensity
    // Sous un ciel couvert ou une lune basse, une ombre portée franche est un mensonge : on la coupe
    // plutôt que de la laisser trancher une scène qui n'a plus de source ponctuelle.
    this.sun.castShadow = l.shadowOpacity > 0.15
    this.fitSunShadow()
  }

  /** Le budget de rendu : (re)construit la chaîne de post-traitement et le rapport de pixels. */
  private applyQuality(): void {
    this.post?.dispose()
    this.post = null
    const wanted = this.options.quality === 'auto' ? detectQuality(this.renderer ? gpuName(this.renderer) : '') : this.options.quality
    this.quality = wanted
    if (!this.renderer) return
    const pixelRatio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[wanted])
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(this.size.width, this.size.height, false)
    if (wanted === 'low') {
      // Pas de chaîne : le tone mapping revient au renderer, et l'image part droit à l'écran.
      this.renderer.toneMapping = toneMappingOf(this.look.post)
      this.renderer.toneMappingExposure = this.look.post.exposure
      return
    }
    this.post = createPostPipeline({
      renderer: this.renderer, scene: this.scene, camera: this.camera, quality: wanted,
      draw: (target) => { this.renderer!.setRenderTarget(target); this.renderPasses(this.renderer!) },
      // La machine ne suit pas : on descend d'un cran, une seule fois, sans rien demander à personne.
      onDowngrade: (to) => { this.options = { ...this.options, quality: to }; this.applyQuality(); this.loop.invalidate() },
      ...(this.deps.now ? { now: this.deps.now } : {}),
    })
    this.post.setLook(this.look.post)
    this.post.setSize(this.size.width, this.size.height, pixelRatio)
  }

  /**
   * Le panneau flottant couvre le bord droit du canvas : le cadrage (`fitBox`) et le centre de la vue
   * visent la partie LIBRE. `setViewOffset` élargit le tronc de projection vers la droite au lieu de
   * le recentrer, donc tout ce qui se calcule sur le canvas entier (NDC du lancer de rayon, pilules
   * du CSS2DRenderer) reste juste sans rien changer.
   */
  setViewInset(rightPx: number): void {
    this.viewInsetRight = Math.max(0, rightPx)
    this.applyProjection()
    this.loop.invalidate()
  }

  private applyProjection(): void {
    const { width, height } = this.size
    const free = Math.max(1, width - Math.min(this.viewInsetRight, width * 0.6))
    this.camera.aspect = free / height
    if (free < width) this.camera.setViewOffset(free, height, 0, 0, width, height)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
  }

  resize(width: number, height: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) }
    this.applyProjection()
    this.renderer?.setSize(this.size.width, this.size.height, false)
    this.post?.setSize(this.size.width, this.size.height, this.renderer?.getPixelRatio() ?? 1)
    this.labelRenderer?.setSize(this.size.width, this.size.height)
    this.loop.invalidate()
  }

  /** Tourne la vue autour de la cible de `delta` radians (boutons de la vue), sans changer la plongée. */
  orbitBy(delta: number): void {
    const { azimuth, polar, distance } = this.currentSpherical()
    this.moveCamera(this.poseAt(azimuth + delta, polar, distance), true)
  }

  /** Rapproche (`factor` < 1) ou éloigne la caméra, dans les bornes des contrôles. */
  dollyBy(factor: number): void {
    const { azimuth, polar, distance } = this.currentSpherical()
    const lo = this.controls?.minDistance ?? 1, hi = this.controls?.maxDistance ?? Infinity
    this.moveCamera(this.poseAt(azimuth, polar, clamp(distance * factor, lo, hi)), true)
  }

  private poseAt(azimuth: number, polar: number, distance: number): CameraPose {
    const target = (this.controls?.target ?? new Vector3()).clone()
    const position = new Vector3().setFromSpherical(new Spherical(distance, polar, azimuth)).add(target)
    return { position, target }
  }

  private render(interactive = true): void {
    this.probe?.begin()
    const t0 = this.deps.now?.() ?? performance.now()
    // Les matrices monde, UNE fois par image. Three les recalcule au début de CHAQUE `render()` —
    // or une image en compte plusieurs (la passe globale, une par niveau éclairé, celles de
    // l'occlusion ambiante) plus celle du `CSS2DRenderer`, et rien ne bouge entre elles. Sur une
    // maison de trente pièces et quatre-vingts marqueurs, c'était le même arbre reparcouru quatre
    // fois pour le même résultat. `matrixWorldAutoUpdate = false` coupe le recalcul automatique ;
    // c'est nous qui le demandons, ici, avant la première passe.
    this.scene.updateMatrixWorld()
    // Les compteurs de three se remettent à zéro à chaque `render()` : avec plusieurs passes par
    // image, il faut les tenir nous-mêmes pour lire un total d'IMAGE et non de dernière passe.
    if (this.renderer) { this.renderer.info.autoReset = false; this.renderer.info.reset() }
    // Avec une chaîne d'effets, c'est elle qui appelle notre rendu (par `draw`) puis ses passes ;
    // sans elle, on dessine droit à l'écran.
    // Seules les images d'un geste SANS relevé d'ombres disent quelque chose de la machine au garde-fou.
    if (this.post) this.post.render(interactive && t0 > this.shadowsDirtyUntil)
    else if (this.renderer) { this.renderer.setRenderTarget(null); this.renderPasses(this.renderer) }
    this.measure(t0, interactive)
    this.updatePillLod()
    if (this.labelsVisible) { this.labelRenderer?.render(this.scene, this.camera); this.markLabelsMoving() }
    this.probe?.end()
  }

  /**
   * Rendu en PASSES : les lampes d'un niveau n'éclairent que ce niveau.
   *
   * Une lumière ponctuelle ignore la géométrie : le plafonnier du salon éclairait le sas d'entrée
   * en dessous à travers la dalle, et ceux du rez-de-chaussée l'étage par en dessous. Des ombres par
   * lampe (six cartes chacune) sont hors de prix sur tablette. Three ne collecte que les lumières
   * VISIBLES de la scène au moment du `render` : on rend donc
   *   - d'abord tout — site, toit, niveaux — sans aucun marqueur de niveau, donc sans leurs lampes,
   *     sous le seul éclairage global (soleil, ciel) ; c'est cette passe qui refait la carte d'ombre ;
   *   - puis chaque niveau visible SEUL, avec ses marqueurs et donc ses lampes : ses surfaces sont
   *     redessinées éclairées par elles, par-dessus la première passe (même profondeur, pas
   *     d'effacement), et rien d'autre ne les voit.
   * Les murs et sols d'un niveau se dessinent deux fois ; les marqueurs une seule (un halo additif
   * dessiné deux fois doublerait). Reste : dans un même niveau, une lampe éclaire encore à travers
   * une cloison.
   */
  private renderPasses(r: WebGLRenderer): void {
    const nodes = this.nodes
    if (!nodes) { r.render(this.scene, this.camera); return }
    const levels = [...nodes.levels.values()].filter((n) => n.group.visible)
    // Un niveau ne se redessine que s'il a quelque chose à montrer de plus que la passe globale :
    // une lampe allumée, ou un décor. Un niveau fantôme n'a même pas de marqueurs.
    const lit = [...nodes.levels.entries()]
      .filter(([id, n]) => n.group.visible && n.markers.visible && this.levelsNeedingPass.has(id))
      .map(([, n]) => n)
    const roofShown = nodes.roof?.visible ?? false
    // Ce que le JARDIN dessine : son sol et ses zones. Ses appareils, eux, restent visibles dans
    // toutes les passes — leurs lampes portent une ombre et doivent éclairer la façade partout.
    const siteSurfaces = [nodes.ground, nodes.terrain, ...nodes.zones.values()]

    // 1) LA MATIÈRE, tout entière, sous l'éclairage global ET les lampes du jardin (qui portent une
    //    vraie ombre, donc n'entrent pas par les murs). C'est cette passe qui refait la carte d'ombre,
    //    et les appareils y sont VISIBLES : un volet fermé doit barrer le soleil, une voiture poser son
    //    ombre sur l'allée. Ce qui en sort, ce sont les lampes d'INTÉRIEUR et les décors des niveaux —
    //    par leur couche, jamais par leur visibilité (`core/layers.ts`).
    // Les ombres ne se refont qu'après un changement de scène, pas parce que la caméra a tourné :
    // le relevé redessine tout le bâti depuis le soleil, et six faces de plus par lampe de jardin.
    const rebuildShadows = (this.deps.now?.() ?? performance.now()) <= this.shadowsDirtyUntil
    this.perf.shadowsRebuilt = rebuildShadows
    // Un appareil dessiné dans la passe globale PUIS dans celle de son niveau l'est deux fois pour
    // rien : le second passage réécrit le premier, au même endroit, en mieux éclairé. Sur la maison
    // réelle les marqueurs pèsent la moitié des appels de dessin — c'est la moitié qu'on ne paie
    // plus. Ils restent dans la passe globale quand elle relève les OMBRES (il faut alors qu'ils
    // soient là pour les porter) et quand leur niveau n'a pas de passe à lui.
    const duplicated = rebuildShadows ? [] : lit
    for (const n of duplicated) n.markers.visible = false
    this.camera.layers.disable(DECOR_LAYER)
    this.camera.layers.disable(LAMP_LAYER)
    r.autoClear = true
    r.shadowMap.autoUpdate = rebuildShadows
    r.render(this.scene, this.camera)
    r.shadowMap.autoUpdate = false
    r.autoClear = false
    for (const n of duplicated) n.markers.visible = true
    this.camera.layers.enable(DECOR_LAYER)
    this.camera.layers.enable(LAMP_LAYER)
    this.camera.layers.disable(SITE_DECOR_LAYER)   // le jardin a déjà posé ses halos

    // 2) un passage par NIVEAU qui porte des lampes : il est seul à l'écran, ses surfaces se
    //    redessinent éclairées par SES lampes (plus le global et le jardin, toujours là), par-dessus
    //    la première passe — même tampon de profondeur, pas d'effacement. Le sol du jardin, lui, est
    //    retiré : sinon une lampe d'intérieur viendrait le tacher à travers la façade.
    for (const m of siteSurfaces) m.visible = false
    if (nodes.roof) nodes.roof.visible = false
    for (const n of lit) {
      for (const o of levels) o.group.visible = o === n
      r.render(this.scene, this.camera)
    }
    this.perf.passes = 1 + lit.length

    for (const n of levels) n.group.visible = true
    for (const m of siteSurfaces) m.visible = true
    if (nodes.roof) nodes.roof.visible = roofShown
    this.camera.layers.enable(SITE_DECOR_LAYER)
    r.autoClear = true
  }

  /**
   * Recalcule quels niveaux méritent leur passe. Appelé quand un état, un appareil ou l'apparence
   * change — jamais pendant le rendu : la caméra ne change rien à cette réponse.
   */
  private refreshLevelPasses(): void {
    this.levelsNeedingPass.clear()
    if (!this.nodes) return
    for (const [id, n] of this.nodes.levels) {
      let needs = false
      n.markers.traverse((o) => {
        if (needs || !o.visible) return
        const light = o as unknown as { isPointLight?: boolean; intensity?: number }
        if (light.isPointLight) { if ((light.intensity ?? 0) > 0) needs = true; return }
        if (o.layers.mask === 1 << DECOR_LAYER) needs = true
      })
      if (needs) this.levelsNeedingPass.add(id)
    }
  }

  /** Temps passé dans `render()`, temps passé AILLEURS, et cadence. Lu par le voile de débogage. */
  private measure(t0: number, interactive: boolean): void {
    const t1 = this.deps.now?.() ?? performance.now()
    this.perf.cpuMs = this.perf.cpuMs ? this.perf.cpuMs * 0.85 + (t1 - t0) * 0.15 : t1 - t0
    // Ce qui sépare deux images et qu'on n'a pas passé à dessiner : c'est le navigateur, pas nous.
    // Seulement sur les images ENCHAÎNÉES par un geste : entre deux réveils d'animation décorative,
    // l'écart est celui qu'on a nous-mêmes imposé (20 Hz = 50 ms), et le compter serait se mentir.
    if (this.perf.lastStart && interactive && this.perf.wasInteractive) {
      const outside = Math.max(0, t0 - this.perf.lastStart - (t1 - t0))
      this.perf.outsideMs = this.perf.outsideMs ? this.perf.outsideMs * 0.85 + outside * 0.15 : outside
    }
    this.perf.lastStart = t0
    this.perf.wasInteractive = interactive
    this.perf.frames++
    if (!this.perf.since) this.perf.since = t0
    const span = t1 - this.perf.since
    if (span >= 500) {
      this.perf.fps = (this.perf.frames * 1000) / span
      this.perf.frames = 0
      this.perf.since = t1
    }
  }

  /** Le rendu est à la demande : la distance n'est relue que quand quelque chose a bougé. */
  private updatePillLod(): void {
    const layer = this.labelRenderer?.domElement
    if (!layer || !this.controls) return
    const d = this.camera.position.distanceTo(this.controls.target)
    const pxPerM = this.size.height / (2 * d * Math.tan((this.camera.fov * Math.PI) / 360))
    const lod: PillLod = pxPerM >= PILL_LOD_FULL_MIN_PX_PER_M ? 'full' : pxPerM >= PILL_LOD_ICON_MIN_PX_PER_M ? 'icon' : 'dot'
    if (lod === this.pillLod) return
    this.pillLod = lod
    layer.dataset.lod = lod
  }

  setPaused(paused: boolean): void { this.loop.setPaused(paused) }

  dispose(): void {
    this.photoGen++                        // une matière qui arrive après n'a plus de scène à habiller
    this.detachInput?.()
    if (this.labelsIdle !== null) clearTimeout(this.labelsIdle)
    if (this.stormTimer !== null) { clearTimeout(this.stormTimer); this.stormTimer = null }
    this.drag?.detach()
    this.loop.dispose()
    this.controls?.dispose()
    this.clear()
    this.post?.dispose()
    disposeMaterials(this.materials)
    this.skyEnv?.dispose()
    this.renderer?.dispose()
    if (this.labelRenderer) this.labelRenderer.domElement.replaceChildren()
  }
}

function defaultCreateRenderer(canvas: HTMLCanvasElement): WebGLRenderer | null {
  try {
    const r = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    r.setClearColor(0x000000, 0)
    return r
  } catch {
    return null
  }
}
