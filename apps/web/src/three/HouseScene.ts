import {
  AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera, Plane, Raycaster, Scene, type Texture, TOUCH, Vector2, Vector3, VSMShadowMap,
  WebGLRenderer, Box3, type Material, type Mesh, type MeshStandardMaterial, type Object3D,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  boundsCenter, buildingBounds, computeHouseGeometry, deviceFloorZ, geoDistance, indexHouse, longestEdgeYawDeg, pointInPolygon, resolveDefaults, resolveDeviceLevelId, sitePosition,
  roofBounds, roomBounds, zoneBounds,
  type DeviceDescriptor, type DeviceState, type House, type HouseDevice, type HouseGeometry, type HouseIndex, type Level, type PlacedHouseDevice, type Vec3,
} from '@kasbah/shared'
import { applyTheme, createMaterials, disposeMaterials, type MaterialSet } from './builders/materials'
import { createVehicleEnvironment } from './core/environment'
import { buildHouse, type HouseNodes } from './builders/buildHouse'
import { clamp, fitBox, sphericalOf } from './core/cameraFit'
import { boundsToWorldBox } from './core/coords'
import { disposeObject3D } from './core/dispose'
import { createDragDetector, createTapDetector, type DragDetector, type TapEvent } from './core/input'
import { createRenderLoop, type RenderLoop } from './core/renderLoop'
import { defaultSceneTheme, type SceneTheme } from './core/theme'
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
}

export interface HouseSceneDeps {
  createRenderer?: (canvas: HTMLCanvasElement) => WebGLRenderer | null
  createLabelRenderer?: (layer: HTMLElement) => CSS2DRenderer
  requestFrame?: (cb: (now: number) => void) => number
  cancelFrame?: (h: number) => void
  now?: () => number
  theme?: SceneTheme
  labelLayer?: HTMLElement | null
  /** Désactive OrbitControls/tap (tests Node). */
  headless?: boolean
}

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
const WORLD_UP = new Vector3(0, 1, 0)
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
  private nodes: HouseNodes | null = null
  private house: House | null = null
  private index: HouseIndex | null = null
  private geometry: HouseGeometry | null = null
  private options: HouseSceneOptions = { levelFocusMode: 'hide', shadows: true }
  private focusedLevelId: string | null = null
  private pillLod: PillLod | null = null
  private highlightedRoom: string | null = null
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
  /** Ce que reflète une carrosserie. Propre aux véhicules : la maison, elle, n'a pas d'environnement. */
  private vehicleEnv: Texture | null = null
  private descriptors = new Map<string, DeviceDescriptor>()
  private states: Record<string, DeviceState> = {}

  constructor(readonly canvas: HTMLCanvasElement, deps: HouseSceneDeps = {}) {
    this.deps = deps
    this.theme = deps.theme ?? defaultSceneTheme()
    this.materials = createMaterials(this.theme)
    this.camera = new PerspectiveCamera(38, 1, 0.1, 500)
    this.camera.position.set(20, 18, 20)

    const create = deps.createRenderer ?? defaultCreateRenderer
    this.renderer = deps.headless ? null : create(canvas)
    this.supported = deps.headless ? true : this.renderer !== null
    // VSM (Variance Shadow Maps) et non PCFSoftShadowMap : depuis three 0.184 ce dernier est
    // déprécié et retombe sur du PCF DUR (bords crénelés) avec un avertissement en console.
    // VSM floute nativement, piloté par `shadow.radius` / `shadow.blurSamples`.
    if (this.renderer) { this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = VSMShadowMap }
    this.applyVehicleEnvironment()
    this.labelRenderer = deps.labelLayer ? (deps.createLabelRenderer ?? ((el) => new CSS2DRenderer({ element: el })))(deps.labelLayer) : null

    this.hemi = new HemisphereLight(0xffffff, 0x8899aa, this.theme.isDark ? 0.55 : 1.1)
    this.scene.add(this.hemi)
    this.scene.add(new AmbientLight(0xffffff, 0.25))
    this.sun = new DirectionalLight(0xffffff, this.theme.isDark ? 1.1 : 2)
    this.sun.position.set(14, 24, 10)
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
      render: () => this.render(),
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
    this.nodes.terrain.receiveShadow = true
    this.scene.add(this.nodes.root)
    this.fitSunShadow()
    this.buildMarkers()
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
    this.sun.position.set(center.x + r * 0.6, center.y + r * 1.2, center.z + r * 0.4)
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
        materials: this.materials, theme: this.theme, descriptor, ...(opening ? { opening } : {}),
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
    this.loop.invalidate()
  }

  // ---- mode « déplacer » ---------------------------------------------------
  /**
   * Rend déplaçable au doigt un appareil — ou un GROUPE de marqueurs qui bougent ensemble : les
   * modules d'un champ de panneaux, dont on attrape n'importe lequel pour emmener le champ entier.
   * `null` sort du mode. Les événements de glissement nomment le marqueur ATTRAPÉ ; à l'appelant d'en
   * déduire ce que devient le groupe.
   */
  setMovable(key: string | string[] | null): void {
    this.movableKeys = key === null ? [] : Array.isArray(key) ? key : [key]
    this.grabbedKey = null
    for (const m of this.markers.values()) m.setMoving(this.movableKeys.includes(m.key), m.device.position[2], m.key === this.movableKeys[0])
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

  /** Déplace un marqueur (aperçu) ; `position` dans le repère maison (z relatif au sol de l'ancre). */
  moveMarker(key: string, position: Vec3): void {
    const marker = this.markers.get(key)
    if (!marker || !this.house || !this.index) return
    marker.object.position.set(position[0], position[1], this.localZ(marker.device, position[2]))
    marker.setGuideHeight(position[2])
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
      if (force || next !== prev[id] || !marker.currentState || soundChanged) { marker.update(next, sound); touched = true }
    }
    if (touched) this.loop.invalidate()
  }

  // ---- focus / caméra -----------------------------------------------------
  setOptions(opts: Partial<HouseSceneOptions>): void {
    this.options = { ...this.options, ...opts }
    if (this.renderer) this.renderer.shadowMap.enabled = this.options.shadows
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
  highlightRoom(roomId: string | null): void {
    if (!this.nodes) return
    for (const nodes of this.nodes.levels.values()) {
      for (const [id, mesh] of nodes.floors) {
        const m = mesh.userData.material as MeshStandardMaterial
        const base = mesh.userData.baseMaterial as MeshStandardMaterial
        m.color.copy(base.color)
        if (id === roomId) m.color.lerp(this.theme.primary, 0.45)
      }
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

  // ---- thème / taille / rendu --------------------------------------------
  /**
   * (Re)construit le reflet des carrosseries et le pose sur leur matériau. Le dégradé suit le thème,
   * il se refait donc à chaque bascule — et l'ancien se libère, une carte PMREM tient en mémoire GPU.
   */
  private applyVehicleEnvironment(): void {
    this.vehicleEnv?.dispose()
    this.vehicleEnv = createVehicleEnvironment(this.renderer, this.theme)
    this.materials.vehicle.envMap = this.vehicleEnv
    this.materials.vehicle.envMapIntensity = 1
    this.materials.vehicle.needsUpdate = true
  }

  setTheme(theme: SceneTheme): void {
    this.theme = theme
    applyTheme(this.materials, theme)
    this.applyVehicleEnvironment()
    this.hemi.intensity = theme.isDark ? 0.55 : 1.1
    this.sun.intensity = theme.isDark ? 1.1 : 2
    for (const m of this.markers.values()) m.setTheme(theme)
    this.highlightRoom(this.highlightedRoom)
    this.loop.invalidate()
  }

  resize(width: number, height: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) }
    this.camera.aspect = this.size.width / this.size.height
    this.camera.updateProjectionMatrix()
    this.renderer?.setSize(this.size.width, this.size.height, false)
    this.labelRenderer?.setSize(this.size.width, this.size.height)
    this.loop.invalidate()
  }

  private render(): void {
    this.renderer?.render(this.scene, this.camera)
    this.updatePillLod()
    this.labelRenderer?.render(this.scene, this.camera)
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
    this.detachInput?.()
    this.drag?.detach()
    this.loop.dispose()
    this.controls?.dispose()
    this.clear()
    disposeMaterials(this.materials)
    this.vehicleEnv?.dispose()
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
