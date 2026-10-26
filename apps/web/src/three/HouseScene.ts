import {
  AmbientLight, Color, DirectionalLight, DoubleSide, HemisphereLight, MOUSE, OrthographicCamera, PerspectiveCamera, Plane, Raycaster, Scene, Shape, ShapeGeometry, Spherical, type Intersection, type Texture, TOUCH, Vector2, Vector3, VSMShadowMap,
  WebGLRenderer, Box3, BoxGeometry, Fog, Mesh, MeshBasicMaterial, type Material, type MeshPhysicalMaterial, type MeshStandardMaterial, type Object3D,
  Group, SphereGeometry, CylinderGeometry, RingGeometry, Frustum, Matrix4, Sphere, PointLight,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  boundsCenter, buildingBounds, computeHouseGeometry, deviceFloorZ, emptyReliefGrid, extendReliefGrid, isFlatRelief, parseRelief, serializeRelief, terrainHeight, geoDistance, HOME_RADIUS_M, indexHouse, longestEdgeYawDeg, offsetPolygon, pointInPolygon, resolveDefaults, resolveDeviceLevelId, sitePosition,
  roofBounds, roomBounds, zoneBounds, openingCentre, openingGaps, openingLabel, planLength, surfaceAxes, surfaceGaps,
  assignParkings, atRest, mirekToRgb, xyToRgb, parkingGaps, parkingHost, parkingLabel, PARKING_SIDES,
  type DeviceDescriptor, type FinishId, type DeviceState, type House, type HouseDevice, type HouseGeometry, type HouseIndex, type Level, type OpeningRect, type Parking, type ParkingFix, type ParkingSide, type PlacedHouseDevice, type Relief, type ReliefGrid, type Vec2, type Vec3,
} from '@kasbah/shared'
import { applyLook, backdropColor, createMaterials, disposeMaterials, type MaterialSet } from './builders/materials'
import type { SurfaceRole } from './textures/procedural'
import { RoomShapeEditor, type ShapeSelection } from './shape/roomShapeEditor'
import { loadFinishTextures, loadPackTextures, packById, packTexturesSettled, type TexturePack } from './textures/assets'
import { createSkyEnvironment, overcastSky } from './core/sky'
import { DECOR_LAYER, SITE_DECOR_LAYER } from './core/layers'
import { setLevelHeights } from './core/levelLight'
import { setHeightMist } from './core/heightMist'
import { materialOpacity, setLevelFade } from './core/levelFade'
import { roomFocusUniforms, setRoomFocusShape, setRoomFocusStrength } from './core/roomFocus'
import { createPostPipeline, detectQuality, gpuName, PIXEL_RATIO, tiltBlurFactor, toneMappingOf, type EffectiveQuality, type PostPipeline, type RenderQuality } from './core/post'
import { dayFactor, fogRange, sunDirection, type SceneAmbience } from './core/ambience'
import { Bats } from './effects/bats'
import { Disco } from './effects/disco'
import { Parade } from './effects/parade'
import type { Box, Circle } from './effects/roam'
import { Precipitation } from './effects/precipitation'
import { createWaterUniforms, makeWaterAlive, setWaterSun, setWaterTint, setWaterWind, WaterCaustics, type WaterStrength } from './effects/water'
import { defaultAmbience, defaultSceneTheme, rolesOf, styleById, type GlowLook, type PostLook, type RenderStyle, type StyleLook } from './styles'
import { applyTuning, NEUTRAL_TUNING, type SceneTuning } from './styles/tuning'
import { buildHouse, buildLevel, buildRoofMesh, shapeTerrain, type HouseNodes, type LevelNodes } from './builders/buildHouse'
import { ReliefEditor } from './relief/reliefEditor'
import { OutlineEditor } from './relief/outlineEditor'
import { GardenLayer } from './garden/gardenLayer'
import { ReflectionProbe } from './effects/reflection'
import type { Season } from './garden/season'
import { buildParking, parkingGlyphTexture, parkingMaterials, type ParkingMaterials, type ParkingNodes } from './builders/parking'
import { buildGroundOverlay, type GroundShape } from './builders/groundOverlay'
import { extrudeRing, flatPolygon, flatRing, insetPolygon } from './builders/shapes'
import {
  boxRadius, clamp, distanceForHeight, fitBox, fitZoom, ISO_FOV_DEG, ISO_POLAR, ORTHO_BASE_M, snapIsoAzimuth, sphericalOf, visibleHeight,
  type CameraPose, type SceneProjection,
} from './core/cameraFit'
import { boundsToWorldBox, houseToWorld } from './core/coords'
import { disposeObject3D } from './core/dispose'
import { createDragDetector, createTapDetector, type DragDetector, type TapEvent } from './core/input'
import { createRenderLoop, type RenderLoop } from './core/renderLoop'
import { resolveSceneTheme, type SceneTheme, type UiTheme } from './core/theme'
import { createTween, easeInCubic, easeInOutCubic, easeOutCubic, linear, type Tween } from './core/tween'
import { emitsSound, soundRouting } from '../lib/audioRouting'
import { createMarker } from './markers/createMarker'
import type { DeviceMarker, SoundCue } from './markers/DeviceMarker'
import { MowerMarker, VehicleMarker } from './markers/markers'

// Scene controller without Vue. Injectable dependencies (renderer, RAF) → can be instantiated in Node
// for tests without WebGL. The useHouseScene composable is its reactive adapter.

export type LevelFocusMode = 'hide' | 'ghost'

export interface HouseSceneOptions {
  levelFocusMode: LevelFocusMode
  shadows: boolean
  /** Post-processing budget. `auto` measures the machine then corrects itself (`core/post.ts`). */
  quality: RenderQuality
  /** Perspective, free orthographic, or locked isometric (`core/cameraFit.ts`). */
  projection: SceneProjection
}

/**
 * What decides the scene's APPEARANCE, along three independent axes: the render style (the
 * taste), the ambience (the time of day above the house) and the application theme (the
 * markers laid on it). None of the three imposes the other two.
 */
export interface SceneAppearance {
  ui: UiTheme
  style: RenderStyle
  ambience: SceneAmbience
  /** Photo materials instead of the procedural ones, if the style carries a pack (`textures/assets.ts`). */
  assets: boolean
  /** Light tuning bench (`styles/tuning.ts`): multipliers applied on the style's look. */
  tuning: SceneTuning
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
  /** Disables OrbitControls/tap (Node tests). */
  headless?: boolean
}

/** What the debug overlay shows (Settings → 3D rendering → Debug). */
export interface SceneDebugStats {
  /** Frames rendered per second. Rendering being on demand, it is 0 at rest — and that is normal. */
  fps: number
  /**
   * Time spent IN `render()`, moving average (ms). Not pure CPU: when the GPU's command queue
   * is full, the driver blocks on submission and that wait ends up in it.
   */
  cpuMs: number
  /**
   * Time elapsed BETWEEN two frames, minus the time spent drawing. It is what the browser does on
   * its side: style, layout, paint, compositing, presentation on screen. An "outside render" time
   * that swells while rotating points to anything but our drawing.
   */
  outsideMs: number
  /** Draw calls and triangles of ONE frame, all renders included (scene, occlusion, effects). */
  calls: number
  triangles: number
  programs: number
  geometries: number
  textures: number
  /** Was the sun's shadow map redone on the last frame? */
  shadowsRebuilt: boolean
  /** Lamps that cast a cube shadow (six depth renders each). */
  pointShadows: number
  markers: number
  /**
   * Marker animations in progress (a player's wave, a battery's breath). As long as there is
   * one, the loop runs WITHOUT anything being touched — capped at `ANIMATION_HZ` (`core/renderLoop.ts`).
   */
  animations: number
  quality: EffectiveQuality
  pixelRatio: number
}

/**
 * Probe placed around a RENDERED frame. The debug overlay plugs `stats.js` into it: it is the only
 * way to get its graph, since the scene only renders on demand — a `stats.update()` called
 * from a separate loop would count frames that do not exist.
 */
export interface FrameProbe { begin(): void; end(): void }

/** Viewpoints of the relief editor: from a cardinal point, or from straight above. */
export type TerrainView = 'north' | 'east' | 'south' | 'west' | 'top'

/** The two tabs of the terrain editor: the heights, or the shape of the plot. */
export type TerrainTab = 'relief' | 'outline'

/** Outline editing as seen from the panel: selected vertex, draft, history. */
export interface OutlineEditState {
  point: Vec2 | null
  draft: Vec2[]
  canUndo: boolean
  canRedo: boolean
  canRemove: boolean
  pick: { seq: number; by: string }
}

/** Relief editing as seen from the panel: height of the selected dot (cm), draft (`null` = flat). */
export interface ReliefEditState {
  pointCm: number | null
  draft: Relief | null
  canUndo: boolean
  canRedo: boolean
  /** Last dot selected by tap (`seq` increases at each tap) and the pointer that selected it. */
  pick: { seq: number; by: string }
  tab: TerrainTab
  outline: OutlineEditState | null
}

export interface SceneEvents {
  deviceTap: (key: string) => void
  roomTap: (roomId: string) => void
  zoneTap: (zoneId: string) => void
  /** Tap on the roof: the level that carries it (it has neither room nor floor to touch). */
  levelTap: (levelId: string) => void
  /** Tap on a log pin (an incident laid on the terrain): its date, which identifies it. */
  journalTap: (at: number) => void
  backgroundTap: () => void
  /** Drag of the movable device: position on the ground (house reference frame) and hovered room (same level) or null. */
  deviceDrag: (key: string, xy: [number, number], roomId: string | null) => void
  deviceDrop: (key: string, xy: [number, number], roomId: string | null) => void
  /** Tap on an opening's handle (edit mode only). */
  openingTap: (openingId: string) => void
  /**
   * Drag of the SELECTED opening: the finger's point projected onto the FLOOR plane of its
   * level, in the house reference frame. It is the caller that derives a wall and a distance from the corner
   * (`slotFromPoint`) — the scene does not know the admissible places.
   */
  openingDrag: (openingId: string, xy: [number, number]) => void
  openingDrop: (openingId: string) => void
  /**
   * Wall tapped while an opening is armed ("place" mode): the point touched on the structure, in the
   * house reference frame. As for the drag, it is the caller that derives a wall and a distance
   * from the corner — the scene says WHERE THE TAP LANDED, not where the opening is allowed to go.
   */
  placeTap: (xy: [number, number]) => void
  /**
   * FLOOR point touched while a parking space is armed: a room's floor, the
   * terrain or a zone, in the house reference frame. A space is laid flat — there is no wall to aim at,
   * hence no admissibility rule to apply, unlike an opening.
   */
  groundTap: (xy: [number, number], levelId: string | null) => void
  /**
   * The relief editing moved (entry, drag, import); `null` when leaving the mode.
   * `draft` = the draft as it would be written, `null` if it is flat.
   */
  reliefChange: (state: ReliefEditState | null) => void
  /** Tap on a parking space (edit mode only). */
  parkingTap: (parkingId: string) => void
  /**
   * Drag of the SELECTED space: the finger's point projected onto the ground, in the house reference frame.
   * It is the desired center — a space on the ground has no hosting constraint, unlike an
   * opening that must find a wall.
   */
  parkingDrag: (parkingId: string, xy: [number, number]) => void
  parkingDrop: (parkingId: string) => void
  /** Tap on a garden element (edit mode only). */
  gardenTap: (itemId: string) => void
  /** Drag of the SELECTED garden element: its new foot, in the house reference frame. */
  gardenDrag: (itemId: string, xy: [number, number]) => void
  gardenDrop: (itemId: string) => void
  /** Garden element armed: the TERRAIN point touched (a room floor or a roof is not one). */
  gardenPlaceTap: (xy: [number, number]) => void
  /** "Add a room" armed: the floor point touched (room, terrain or zone), where it is born. */
  roomPlaceTap: (xy: [number, number]) => void
  /**
   * The house is being prepared before being shown (see `prepare`): the current stage, with its count
   * when it has one (the materials), then `null` when it is ready.
   */
  prepare: (stage: ScenePrepareStage | null, progress: { done: number; total: number } | null) => void
  /** Shape of a room ("Dimensions" section): a wall pushed by `delta` m since the start of the gesture. */
  shapeWall: (edge: number, delta: number, final: boolean) => void
  /** …a vertex brought to `xy` (house reference frame). */
  shapeCorner: (index: number, xy: [number, number], final: boolean) => void
  /** …the selected handle changed. */
  shapeSelect: (sel: ShapeSelection) => void
}

/** The stages of preparing a house, in order. */
export type ScenePrepareStage = 'materials' | 'shaders' | 'frame'

/**
 * After a PAINTED frame: the callback of one `requestAnimationFrame` comes before the paint of its frame,
 * that of the next one comes after it.
 */
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** Beyond this, the house is shown even if photo materials are still on their way (slow network, missing file). */
const PREPARE_PHOTOS_MS = 10_000
/** Beyond this, the house is shown even if shaders are still compiling (the first frame will finish them). */
const PREPARE_SHADERS_MS = 30_000

/** Emission of a window whose room is fully lit, at night; and its opacity then. */
const WINDOW_GLOW = 0.65
const WINDOW_LIT_OPACITY = 0.6
/** Fog range (m) when the air is clear: beyond everything the scene draws (infinite ground: 400 m). */
const NO_FOG_M = 1e6
/** Share of the upper sky (hemisphere) in the color of the low mist. */
const MIST_SKY_SHARE = 0.35
/** Height (m) of a space's label above the ground, and that of its four dimensions. */
const PARKING_NOTE_LIFT_M = 0.9
const PARKING_COTE_LIFT_M = 0.12
/** Side of the box framed around a selected device: the device up close, its room around it. */
const DEVICE_FOCUS_SIZE_M = 3
/** Heads of the log pins: the UI's severity tints (`lib/journal.ts`), as numbers for Three. */
const JOURNAL_PIN_COLORS: Record<string, number> = { info: 0x8a94a6, warning: 0xd38b22, error: 0xd24a43, fatal: 0xd24a43 }
/** Tilt allowed when framing a device: looking down, to see over the walls. */
const DEVICE_FOCUS_POLAR = [(20 * Math.PI) / 180, (40 * Math.PI) / 180] as const
const DEFAULT_AZIMUTH = -Math.PI / 4     // from the south-east
/** How far a device can be "behind" its wall and still win the tap (a wall light is stuck to it). */
const WALL_PICK_TOLERANCE_M = 0.05
/** Vertical field of the perspective (and the reference field of the orthographic). */
const BASE_FOV_DEG = 38
/** Bounds of the mouse wheel, at that field; a narrower field moves them back accordingly. */
const MIN_DISTANCE_M = 4
const MAX_DISTANCE_M = 120
const DEFAULT_POLAR = (55 * Math.PI) / 180
/** Framing of a roof level: steeper than the others, one comes to look at the slab itself. */
const ROOF_POLAR = (35 * Math.PI) / 180
/** A lightning strike: exposure factor and duration (ms) of each flash — two flashes, the second longer. */
const FLASH: readonly (readonly [number, number])[] = [[2.6, 70], [1, 90], [1.9, 120]]
/** Between two strikes, at random within this range (ms). */
const FLASH_EVERY_MS: readonly [number, number] = [6000, 16000]
/** Ceiling of the volume where it rains, above the house floor (m): above the roofs, below the overview camera. */
const PRECIP_HEIGHT_M = 14
/**
 * Rate of the living water (`effects/water.ts`), in frames per second. A pool swell advances
 * slowly: at 10 Hz the eye does not see the steps, and it is half as many FULL frames to
 * draw as a downpour.
 */
const WATER_HZ = 10
const WORLD_UP = new Vector3(0, 1, 0)
/** Grid step of a relief created in the editor (m): ~900 handles on the plot, enough for a bump. */
const RELIEF_STEP = 2
/** Visible share of the house while shaping the terrain: enough to find one's bearings, not enough to get in the way. */
const RELIEF_HOUSE_OPACITY = 0.5
/** What it takes to test the pool against the camera's field without allocating anything per movement. */
const waterFrustum = new Frustum()
const waterMatrix = new Matrix4()
const waterSphere = new Sphere()
const WHITE = new Color(0xffffff)
/**
 * Handle of an opening in edit mode: a slab that fills its rectangle and overhangs
 * the wall thickness, and a frame that rings it (see `OPENING_RING` for its width).
 */
/**
 * How far an opening's handle OVERHANGS each face of the wall (m). It can thus be grabbed from
 * the inside as from the outside without aiming, and above all its frame at rest, which is subject to
 * depth, stays visible when the facade is seen at an angle: flush with the wall, the outer face
 * hid it (observed on a 30 cm wall, where the handle was just as thick).
 */
const OPENING_HANDLE_PROUD_M = 0.09
/**
 * Visible width of a handle's frame: THIN at rest, thick for the one being adjusted. It is the thickness
 * that carries the difference between the two — a nuance of intensity was not enough to tell them apart, and
 * removing the frame at rest made the other openings impossible to find.
 */
const OPENING_RING = { rest: 0.035, on: 0.075 } as const
/** How far the name of the adjusted opening floats above it (m): clear of the lintel. */
const OPENING_NOTE_LIFT_M = 0.18
/**
 * The file's origin marker (edit mode): ring radius, bar thickness, length
 * of the two axes and of the north arrow — in meters. At the scale of a room, not of a building: a
 * CAD-software trihedron in the middle of a maquette would be out of place.
 */
const ORIGIN_MARK = { ring: 0.24, bar: 0.05, axis: 1.1, north: 0.7 } as const
/**
 * Dimension line of an opening: line thickness, height of the ticks closing it at each
 * end, and how far the number floats above it (m).
 */
const COTE = { bar: 0.035, tick: 0.2, lift: 0.14 } as const

/** Radius (m) that the parading characters keep clear of, by kind of vehicle (`roamObstacles`). */
const ROAM_RADIUS = { vehicle: 2.6, mower: 0.6 } as const
/** How far the framing of an opening follows its dimensions (m): beyond that, the end of the line teaches nothing. */
const OPENING_FOCUS_REACH_M = 2
/** Radius (px) around the anchor or the pill where the press grabs the movable device. */
const GRAB_RADIUS_PX = { touch: 44, mouse: 28 }
/**
 * Level of detail of the pills according to the on-screen SCALE (pixels per meter at the aimed point): up close
 * icon and name, farther the icon alone, in the overview a dot. In pixels per meter rather than in
 * meters of distance: at equal distance, a narrow scene (panel open, tablet in portrait) shows
 * the house smaller, and it is the on-screen density that gets in the way. Set as `data-lod` on the markers'
 * layer; the selected pill always stays whole (CSS).
 * Reference points (scene 600 px tall): device framed at 8.8 m ≈ 100 px/m, room ≈ 55-70, level ≈ 30-40,
 * overview ≈ 20.
 */
type PillLod = 'full' | 'icon' | 'dot'
const PILL_LOD_FULL_MIN_PX_PER_M = 65
const PILL_LOD_ICON_MIN_PX_PER_M = 26
/**
 * Window during which the shadows are redone after a scene change. It covers the longest animated
 * travel (a shutter takes 400 ms): beyond it, nothing that casts a shadow moves anymore.
 */
const SHADOW_SETTLE_MS = 700
/** Calm required before redoing the pool reflection (ms): a gesture in progress pays for none. */
const REFLECTION_SETTLE_MS = 400
/** Height of the reflection probe above the water (m): a swimmer's eye, not water level. */
const REFLECTION_EYE_M = 0.4
/** Minimum frames drawn that redo the shadows after a request (the VSM filters over two passes). */
const SHADOW_MIN_FRAMES = 2
/**
 * The flight of an upper floor being hidden (`liftTo`): how far it rises before disappearing, and in
 * how much time — a little less than the camera flight (650 ms), which it accompanies.
 */
const LEVEL_LIFT_M = 8
const LEVEL_LIFT_MS = 450
/** Margin (m) of the fade threshold above the level that stays: never a boundary laid on a face. */
const LEVEL_FADE_MARGIN_M = 0.03
/**
 * The pills that APPEAR wait for the upper floor to have started clearing: their fade starts after this
 * delay and lasts a little longer than the flight. Those that leave follow the flight (`LEVEL_LIFT_MS`).
 */
const PILL_IN_DELAY_MS = 150
const PILL_IN_MS = 550
/** The room being looked at: duration of the fade of the rest of the house, and slab thickness included under its floor. */
const ROOM_FOCUS_MS = 300
const ROOM_FOCUS_SLAB_M = 0.35
/** Margin (m) between the mask and the room's surfaces: never a boundary laid on a face. */
const ROOM_FOCUS_MARGIN_M = 0.12
/** Delay after which the labels are considered still (and their promotion released). */
const LABELS_IDLE_MS = 500

export class HouseScene {
  readonly scene = new Scene()
  /**
   * The ACTIVE camera. It changes kind with the projection (`setOptions({ projection })`): the
   * two keep the same pose, only the frustum differs. What reads it every frame — raycasting,
   * labels, image chain — does not have to know which of the two it is.
   */
  camera: PerspectiveCamera | OrthographicCamera
  /** The one that carries the reference field of view: even in orthographic, it is what sets the distances. */
  private readonly perspectiveCamera: PerspectiveCamera
  /** Built on the first switch to orthographic, kept afterward (going back and forth is a setting, not an animation). */
  private orthoCamera: OrthographicCamera | null = null
  readonly renderer: WebGLRenderer | null
  readonly labelRenderer: CSS2DRenderer | null
  readonly controls: OrbitControls | null
  readonly loop: RenderLoop
  readonly markers = new Map<string, DeviceMarker>()
  /**
   * The incidents of a device's log, laid on the terrain while the panel shows them:
   * each pin with its head (touchable), its label (visible only when it is ACTIVE)
   * and its date, which identifies it.
   */
  /**
   * Shapes PAINTED on the terrain (a mower's terrain map): the ones received, kept
   * to be repainted when the terrain changes (relief, house reloaded), and their group in the scene.
   */
  private groundShapes: readonly GroundShape[] = []
  private groundOverlay: Group | null = null
  private journal: { group: Group; points: { at: number; anchor: Object3D; head: Mesh; label: CSS2DObject | null }[]; pickables: Object3D[]; active: number | null } | null = null
  readonly supported: boolean

  private materials: MaterialSet
  private theme: SceneTheme
  private style: RenderStyle
  private ambience: SceneAmbience
  private look: StyleLook
  /** Photo materials requested (Settings). They only apply if the style carries a pack. */
  private assets = false
  /** Token of the material loads: a role that arrives for a style that was left is ignored. */
  private photoGen = 0
  /** Token of the preparation in progress: a new load (or the end of the scene) invalidates it. */
  private prepareGen = 0
  private preparing = false
  /**
   * No frame during the preparation. A single frame rendered before `compileAsync` finishes
   * compiles EVERYTHING in one block, on the main thread: 9 s frozen at the first load (cold shader
   * cache, iGPU), the veil included — measured on 2026-09-25.
   */
  private holdFrames = false
  /** Shaders requested AFTER the load (a style, a photo material) are compiling: the old frame stays. */
  private compiling = false
  private compileGen = 0
  private post: PostPipeline | null = null
  private quality: EffectiveQuality = 'high'
  /** The notch the safeguard stepped down to in "auto"; `null` = detection decides. The setting, for its part, stays "auto". */
  private autoQuality: EffectiveQuality | null = null
  /** Timer of the storm in progress (next flash, or flash fading out); `null` = no storm. */
  private stormTimer: ReturnType<typeof setTimeout> | null = null
  /** Rain or snow in progress (`effects/precipitation.ts`), what it takes to remove its animation, and the intensity it was built with. */
  private precip: Precipitation | null = null
  private stopPrecip: (() => void) | null = null
  /** The style's bats (`effects/bats.ts`), and what it takes to remove their animation. */
  private bats: Bats | null = null
  private stopBats: (() => void) | null = null
  /** The style's mirror ball and spotlights (`effects/disco.ts`), and what it takes to remove their animation. */
  private disco: Disco | null = null
  private stopDisco: (() => void) | null = null
  /** The style's characters (`effects/parade.ts`), and what it takes to remove their animation. */
  private parade: Parade | null = null
  /** The garden footprint the characters skirt: when it changes, they are rerouted. */
  private gardenRoamKey = ''
  private stopParade: (() => void) | null = null
  private precipIntensity = 0
  /**
   * The living water (`effects/water.ts`): a time SHARED by the surface and the bottom — crests and
   * caustics beat together —, the strength of each, and what it takes to remove the animation. The two
   * materials are patched once and for all; it is the strength that says whether the water moves. The
   * caustics map only exists with a renderer (not in headless).
   */
  private readonly water = createWaterUniforms()
  private caustics: WaterCaustics | null = null
  /** Frozen reflection of the pool (`effects/reflection.ts`) and when to redo it (0 = up to date). */
  private reflection: ReflectionProbe | null = null
  private reflectionDue = 0
  private reflectionTimer: ReturnType<typeof setTimeout> | null = null
  private readonly waterStrength: { surface: WaterStrength; basin: WaterStrength }
  private stopWater: (() => void) | null = null
  /** Direction the daylight comes from, three world: the ambience's hour AND the house heading. */
  private get sunDir(): Vector3 { return sunDirection(this.ambience, undefined, this.headingDeg) }
  /**
   * The heading of the plan's +y (`origin.heading`): the weather counts its directions from TRUE north, the
   * scene from the top of the plan. Sun, rain and swell subtract it.
   */
  private get headingDeg(): number { return this.house?.origin.heading ?? 0 }
  /**
   * The shadows do NOT depend on the camera: redoing them every frame while orbiting
   * the house means redrawing the whole structure for nothing. They are redone for a short
   * while after a scene change — the time for a shutter's travel to finish.
   */
  private shadowsDirtyUntil = 0
  /** Drawn frames that still redo the shadows, whatever the elapsed time (`invalidateShadows`). */
  private shadowFramesPending = 0
  private perf = { fps: 0, cpuMs: 0, outsideMs: 0, lastStart: 0, wasInteractive: false, frames: 0, since: 0, shadowsRebuilt: false }
  private probe: FrameProbe | null = null
  private labelsVisible = true
  private labelsIdle: ReturnType<typeof setTimeout> | null = null
  private nodes: HouseNodes | null = null
  private house: House | null = null
  private index: HouseIndex | null = null
  private geometry: HouseGeometry | null = null
  private options: HouseSceneOptions = { levelFocusMode: 'hide', shadows: true, quality: 'auto', projection: 'perspective' }
  private focusedLevelId: string | null = null
  private pillLod: PillLod | null = null
  private highlightedRoom: string | null = null
  /** The line and the veil laid on the selected room (`highlightRoom`), in its level's group. */
  private highlightMeshes: Mesh[] = []
  private selectedKey: string | null = null
  private listeners: { [K in keyof SceneEvents]: Set<SceneEvents[K]> } = {
    deviceTap: new Set(), roomTap: new Set(), zoneTap: new Set(), levelTap: new Set(), backgroundTap: new Set(),
    deviceDrag: new Set(), deviceDrop: new Set(), journalTap: new Set(),
    openingTap: new Set(), openingDrag: new Set(), openingDrop: new Set(), placeTap: new Set(),
    parkingTap: new Set(), parkingDrag: new Set(), parkingDrop: new Set(), groundTap: new Set(), reliefChange: new Set(), prepare: new Set(),
    gardenTap: new Set(), gardenDrag: new Set(), gardenDrop: new Set(), gardenPlaceTap: new Set(), roomPlaceTap: new Set(),
    shapeWall: new Set(), shapeCorner: new Set(), shapeSelect: new Set(),
  }
  private detachInput: (() => void) | null = null
  /** Removes the wheel relay set on the labels layer (`forwardWheelFromLabels`). */
  private detachWheel: (() => void) | null = null
  private movableKeys: string[] = []
  /** Marker actually grabbed among the movable ones (the modules of an array move together). */
  private grabbedKey: string | null = null
  private drag: DragDetector | null = null
  private readonly dragPlane = new Plane()
  private readonly dragOffset = new Vector3()
  private lastDrag: { xy: [number, number]; roomId: string | null } | null = null
  /**
   * "Adjust the openings" mode: one handle per opening, alive only in this mode —
   * outside edit mode the scene is exactly the one from before. Only the SELECTED one can be dragged, just as
   * only one device is moved at a time.
   */
  private editingOpenings = false
  private selectedOpeningId: string | null = null
  /** Room where a wall tap is awaited to place a new opening there ("place" mode). */
  private placingOpening: { roomId: string; type: string } | null = null
  /** Heading cone while placing a roof window / skylight. */
  private placingYawGuide: Mesh | null = null
  /** Openings whose leaf is carried by a cover (`dressedOpenings`), as the walls were built. */
  private dressed: ReadonlySet<string> = new Set<string>()
  private openingHandles = new Map<string, { group: Group; fill: Mesh; ring: Mesh; ringOn: Mesh; rect: OpeningRect }>()
  /** Five materials for all the handles: selection is only a material swap. */
  private openingMats: {
    fill: MeshBasicMaterial; fillOn: MeshBasicMaterial
    ring: MeshBasicMaterial; ringOn: MeshBasicMaterial
    /** What TURNS OFF a frame: an invisible material, never `Object3D.visible` (see `styleOpeningHandles`). */
    off: MeshBasicMaterial
  } | null = null
  private openingDragger: DragDetector | null = null
  /** The file's origin marker (`buildOriginMark`), alive with edit mode. */
  private originMark: { group: Group; labels: CSS2DObject[] } | null = null
  /** Name and dimensions of the adjusted opening (`refreshOpeningNotes`), and the label group that carries them. */
  private openingNotes: {
    name: CSS2DObject
    /** Wall: [right, left]. Surface: front, back, left, right. */
    gaps: CSS2DObject[]
    parent: Group
    /** The dimension lines: one line and two ticks each. */
    cotes: Group
    lines: { line: Mesh; a: Mesh; b: Mesh }[]
    host: 'wall' | 'surface'
  } | null = null
  /** Last finger position not yet reported, and the frame where it will be (0 = none pending). */
  private pendingOpeningXY: [number, number] | null = null
  private openingFrame = 0
  /**
   * Parking spaces: their ground drawing ALWAYS lives (it is a marking, not a handle),
   * but only edit mode makes them touchable and draggable — like the openings.
   */
  private editingParkings = false
  private selectedParkingId: string | null = null
  /** A space is ARMED: the next ground tap says where it is placed ("place" mode). */
  private placingParking = false
  /** A room is ARMED: the next ground tap says where it is born. */
  private placingRoom = false
  private parkingNodes = new Map<string, ParkingNodes>()
  private parkingMats: ParkingMaterials | null = null
  /** The "P" of the marking: one texture for all the spaces, redone with the theme. */
  private parkingGlyph: Texture | null = null
  private parkingDragger: DragDetector | null = null
  private pendingParkingXY: [number, number] | null = null
  private parkingFrame = 0
  /** Name and four dimensions of the adjusted space, in the DOM: kept from one frame to the next (`refreshParkingNotes`). */
  private parkingNotes: { name: CSS2DObject; sides: Record<ParkingSide, CSS2DObject>; parent: Group } | null = null
  /**
   * Where each vehicle placed by its GPS PARKS, when it is at rest near a compatible space
   * (`assignParkings`). Recomputed with the markers — it is what replaces the reading's point.
   */
  private parkingFixes = new Map<string, ParkingFix>()
  /** Trees, bushes, stones: a layer kept from one house to the next, laid again on each new site. */
  private garden = new GardenLayer()
  /** Garden season (foliage, flowers, fruit), resolved by the caller (`auto` follows the date). */
  private season: Season = 'summer'
  private editingGarden = false
  private selectedGardenId: string | null = null
  private placingGarden = false
  private gardenDragger: DragDetector | null = null
  private pendingGardenXY: [number, number] | null = null
  private gardenFrame = 0
  /**
   * Relief being edited (draft), `null` outside the mode. It survives a reload of the
   * house; the editor, for its part, lives and dies with the scene's nodes.
   */
  private reliefGrid: ReliefGrid | null = null
  private reliefEditor: ReliefEditor | null = null
  private reliefFrame = 0
  /** The mode is requested; it opens as soon as a house is loaded. */
  private reliefWanted = false
  /**
   * Outline being edited (draft), `null` outside the mode; like the relief, it survives a
   * reload of the house, and its editor lives and dies with the nodes.
   */
  private outlineDraft: Vec2[] | null = null
  private outlineEditor: OutlineEditor | null = null
  private terrainTab: TerrainTab = 'relief'
  /** The outline the terrain is meshed on: another outline requires remeshing it. */
  private meshedOutline = ''
  /** Structure materials faded while shaping the terrain, made full again on exit. */
  private reliefFaded = new Set<Material>()
  private readonly raycaster = new Raycaster()
  private size = { width: 1, height: 1 }
  private cameraTween: { cancel(): void } | null = null
  /** Where each upper floor (and the roof) is in its flight: see `liftTo`. */
  private readonly lifts = new Map<string, { offset: number; shown: boolean; tween: Tween | null }>()
  /** World height above which the levels in flight fade out (`core/levelFade.ts`). */
  private fadeCutY = Infinity
  /** Where the room highlight is heading (`core/roomFocus.ts`): 0 or 1, and the travel in progress. */
  private roomFocusTarget = 0
  private roomFocusTween: Tween | null = null
  /** What each level pill must show, and the fade in progress (`fadePills`). */
  private pillTargets = new WeakMap<DeviceMarker, boolean>()
  private pillFading: [DeviceMarker, boolean][] = []
  private pillTween: Tween | null = null
  private readonly deps: HouseSceneDeps
  private readonly sun: DirectionalLight
  private readonly hemi: HemisphereLight
  /** Lamps that are OFF standing in for the lamps of the hidden levels: see `padLamps`. */
  private readonly lampPadding = new Group()
  private readonly ambient: AmbientLight
  /** Width (px) of the canvas's right edge covered by the floating panel: framing aims at the free part. */
  private viewInsetRight = 0
  /** What a car body reflects. Specific to vehicles: the house, for its part, has no environment. */
  private skyEnv: Texture | null = null
  /** True as long as at least one pill carries a tilt-shift opacity, hence there is something to undo. */
  private pillsFaded = false
  /** Reused every frame by `updatePillFocus`: one vector per marker and per frame, no. */
  private readonly pillFocusAt = new Vector3()
  /** Tuning bench: neutral as long as Settings has not set anything (`styles/tuning.ts`). */
  private tuning: SceneTuning = NEUTRAL_TUNING
  private descriptors = new Map<string, DeviceDescriptor>()
  private states: Record<string, DeviceState> = {}

  constructor(readonly canvas: HTMLCanvasElement, deps: HouseSceneDeps = {}) {
    this.deps = deps
    this.style = deps.style ?? styleById(null)
    this.ambience = deps.ambience ?? defaultAmbience()
    this.look = applyTuning(this.style.look(this.ambience), this.tuning)
    this.theme = deps.theme ?? defaultSceneTheme()
    this.materials = createMaterials(this.theme, this.look)
    this.waterStrength = {
      surface: makeWaterAlive(this.materials.zones.pool, 'surface', this.water),
      basin: makeWaterAlive(this.materials.poolBasin, 'basin', this.water),
    }
    // See `render()`: the world matrices are updated once per frame, not once per render.
    this.scene.matrixWorldAutoUpdate = false
    this.perspectiveCamera = new PerspectiveCamera(BASE_FOV_DEG, 1, 0.1, 500)
    this.camera = this.perspectiveCamera
    this.camera.position.set(20, 18, 20)
    // halos, waves, gauges — of a level and of the garden (`core/layers.ts`)
    for (const l of [DECOR_LAYER, SITE_DECOR_LAYER]) this.camera.layers.enable(l)
    // The raycaster ONLY tests explicit lists (never the tree): opening the decor
    // layer to it therefore makes nothing more touchable, but it is what lets it catch an
    // opening's handle, which lives there to be drawn AFTER its level's walls. Without this line,
    // `Raycaster` only sees layer 0 and the drag never starts (observed).
    this.raycaster.layers.enable(DECOR_LAYER)

    const create = deps.createRenderer ?? defaultCreateRenderer
    this.renderer = deps.headless ? null : create(canvas)
    this.supported = deps.headless ? true : this.renderer !== null
    // VSM (Variance Shadow Maps) and not PCFSoftShadowMap: since three 0.184 the latter is
    // deprecated and falls back to HARD PCF (jagged edges) with a console warning.
    // VSM blurs natively, driven by `shadow.radius` / `shadow.blurSamples`.
    if (this.renderer) { this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = VSMShadowMap }
    if (this.renderer) { this.caustics = new WaterCaustics(this.water); this.water.caustics.value = this.caustics.texture }
    this.applySky()
    this.applyQuality()
    this.labelRenderer = deps.labelLayer ? (deps.createLabelRenderer ?? ((el) => new CSS2DRenderer({ element: el })))(deps.labelLayer) : null

    this.hemi = new HemisphereLight(0xffffff, 0x8899aa, 1)
    this.ambient = new AmbientLight(0xffffff, 0.25)
    this.sun = new DirectionalLight(0xffffff, 2)
    this.scene.add(this.hemi, this.ambient, this.sun, this.lampPadding)
    this.applyLighting()
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0005
    // `normalBias` shifts the tested point along the normal: it is what kills the acne of
    // grazing walls, where `bias` alone detached the shadow from its object (peter-panning).
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
      // distance bounds, tilt, rotation, wheel and fingers depend on the projection: a single place sets them
      this.applyControlLimits()
      this.controls.addEventListener('change', () => { this.loop.invalidate(); this.syncWater() })
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
    this.detachWheel = this.forwardWheelFromLabels(deps.labelLayer ?? null)
  }

  /**
   * The wheel over a pill did not zoom. A pill is clickable, hence
   * `pointer-events: auto` (`styles/app.css`), hence it also receives the wheel — and
   * `OrbitControls`, which listens on the CANVAS, never sees it. On a house with forty devices,
   * the screen is studded with them: zoom became intermittent for no visible reason.
   *
   * The event is therefore passed back to the canvas as is, position included (the zoom aims at the cursor).
   * Only the WHEEL: a drag that starts on a pill remains ambiguous — it may be a press on
   * the pill — whereas a wheel over a label has no other meaning than "zoom".
   */
  private forwardWheelFromLabels(layer: HTMLElement | null): (() => void) | null {
    if (!layer || typeof WheelEvent === 'undefined') return null
    const onWheel = (e: WheelEvent) => {
      if (e.target === layer) return            // the gap between the pills: the canvas already got it
      e.preventDefault()
      this.canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
        clientX: e.clientX, clientY: e.clientY, bubbles: false, cancelable: true,
      }))
    }
    layer.addEventListener('wheel', onWheel, { passive: false })
    return () => layer.removeEventListener('wheel', onWheel)
  }

  // ---- events -------------------------------------------------------------
  on<K extends keyof SceneEvents>(event: K, fn: SceneEvents[K]): () => void {
    this.listeners[event].add(fn)
    return () => this.listeners[event].delete(fn)
  }
  private emit<K extends keyof SceneEvents>(event: K, ...args: Parameters<SceneEvents[K]>) {
    for (const fn of this.listeners[event]) (fn as (...a: Parameters<SceneEvents[K]>) => void)(...args)
  }

  // ---- loading ------------------------------------------------------------
  load(house: House): void {
    const firstLoad = this.house === null
    const turned = this.headingDeg !== house.origin.heading
    this.clear()
    this.house = house
    this.index = indexHouse(house)
    this.geometry = computeHouseGeometry(house)
    this.dressed = this.dressedOpenings()
    this.nodes = buildHouse(this.geometry, this.materials, this.dressed)
    this.meshedOutline = JSON.stringify(this.geometry.terrain.polygon)
    if (this.reliefWanted && !this.reliefGrid) this.reliefGrid = parseRelief(house.site.relief) ?? emptyReliefGrid(house.site.terrain, RELIEF_STEP)
    if (this.reliefWanted && !this.outlineDraft) this.outlineDraft = house.site.terrain.map(([x, y]) => [x, y])
    this.applyReliefDraft()                // a relief being edited takes precedence over the file's
    if (this.reliefGrid) { this.syncReliefFocus(); this.emitRelief() }
    this.invalidateShadows()
    this.nodes.terrain.receiveShadow = true
    this.scene.add(this.nodes.root)
    this.syncPrecipitation()               // the root is new: what falls is set on it again
    this.syncBats()
    this.syncDisco()
    this.syncParade()
    this.applyMist()                       // the layer settles on THIS terrain
    if (turned) this.applySky()            // the sky's sun follows the house heading
    this.fitSunShadow()
    this.buildParkings()                   // the ground marking lives with the terrain, before the markers
    this.buildGroundOverlay()              // the painted map too: the root is new
    this.buildGarden()
    this.buildMarkers()
    this.syncWindowGlow()                  // the glass panes are new: they take the style and the lamps again
    this.buildOpeningHandles()             // the root is new: edit mode lays its handles again
    this.buildOriginMark()                 // …its origin marker…
    this.rebuildShapeEditor()              // …and the shape editor, whose level group is new
    this.refreshOpeningNotes()             // …and its labels, which live in a group thrown away with it
    const c = this.geometry.bounds
    this.controls?.target.set((c.min[0] + c.max[0]) / 2, 0, -(c.min[1] + c.max[1]) / 2)
    this.applyLevelFocus()
    if (firstLoad) this.resetView(false)
    this.syncWater()                       // after the framing: is the pool IN the field of view?
    this.loop.invalidate()
    void this.prepare()
  }

  /** The house is still being prepared (see `prepare`): the loading veil hides it. */
  get preparingHouse(): boolean { return this.preparing }

  /**
   * Prepares the house just built BEFORE it is looked at: the photo materials, then
   * the shaders (`compileAsync`, which compiles in parallel when the driver allows it), then a
   * first frame — it compiles what `compileAsync` does not see: the effect chain and the
   * shadow capture. Without this, everything compiled at the first frame, and each photo material
   * arriving afterward recompiled its material: as many frozen frames at the first gesture. The render is
   * the same; only the MOMENT when these compilations are paid changes, under the loading veil.
   *
   * Only covers the state at load: another style, the rain, a garden lamp turned on later
   * can still request their variant.
   */
  private async prepare(): Promise<void> {
    const gen = ++this.prepareGen
    const step = (stage: ScenePrepareStage | null, progress: { done: number; total: number } | null = null) => {
      if (gen !== this.prepareGen) return
      this.preparing = stage !== null
      this.emit('prepare', stage, progress)
    }
    this.holdFrames = true
    try {
      // the photo materials first: each one that arrives changes its material, hence its shader
      step('materials')
      const pack = this.photoPack()
      if (pack) {
        let timer: ReturnType<typeof setTimeout> | undefined
        const settled = packTexturesSettled(pack, this.photoRoles(), (done, total) => step('materials', { done, total }))
        await Promise.race([settled, new Promise((resolve) => { timer = setTimeout(resolve, PREPARE_PHOTOS_MS) })])
        clearTimeout(timer)
      }
      const r = this.renderer
      if (gen !== this.prepareGen || !r) return
      step('shaders')
      // let the veil PAINT the stage before starting the compilations, which occupy the main thread
      await nextPaint()
      if (gen !== this.prepareGen) return
      this.scene.updateMatrixWorld()
      // the variant the scene really uses: that of the effect chain's target (without
      // tone mapping, linear), or the screen when there is no chain (low quality)
      const previous = r.getRenderTarget()
      r.setRenderTarget(this.post?.sceneTarget ?? null)
      // `compile` starts the compilations without waiting for them (in parallel, when the driver has
      // KHR_parallel_shader_compile); it is `shadersReady` that waits. NOT `compileAsync`: its loop
      // reads each material's program without a guard, and a material destroyed during the wait (the
      // markers are rebuilt when the descriptors arrive) makes it crash silently — the
      // promise never resolved and the veil stayed (observed on 2026-09-25).
      r.compile(this.scene, this.camera)
      r.setRenderTarget(previous)
      await this.shadersReady(r, () => gen === this.prepareGen)
      if (gen !== this.prepareGen) return
      step('frame')
      // let the veil paint the stage, then render the frame that compiles the rest
      await nextPaint()
      if (gen !== this.prepareGen) return
      this.holdFrames = false
      this.render(false)
    } catch {
      // a failed preparation must not leave the house under the veil: we show it as it is
    } finally {
      // the next preparation (a new load) holds the frames itself
      if (gen === this.prepareGen) { this.holdFrames = false; this.loop.invalidate() }
      step(null)
    }
  }

  /**
   * Waits for the programs of the visible materials to be compiled. A material that disappeared or that
   * has no program yet holds nothing back: the first frame will compile it. Capped, so
   * that no unforeseen case leaves the house under the veil.
   */
  private async shadersReady(r: WebGLRenderer, current: () => boolean): Promise<void> {
    const materials = new Set<Material>()
    this.scene.traverseVisible((o) => {
      const m = (o as Mesh).material as Material | Material[] | undefined
      if (!m) return
      for (const one of Array.isArray(m) ? m : [m]) materials.add(one)
    })
    const until = (this.deps.now?.() ?? performance.now()) + PREPARE_SHADERS_MS
    for (;;) {
      if (!current()) return
      let pending = 0
      for (const m of materials) {
        const program = (r.properties.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram
        if (program && !program.isReady()) pending++
      }
      if (pending === 0 || (this.deps.now?.() ?? performance.now()) > until) return
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
  }

  /**
   * The same compilation as `prepare`, for what changes AFTER the load: a style (never seen,
   * or left — three discards the programs nothing uses anymore), a photo material that arrives.
   * Left to the first frame, these shaders compiled on the main thread: 2.5 to 5.5 s
   * frozen on the iGPU for "realistic", the style selection only painting afterward (measured on
   * 2026-09-27). Here, `compile` starts them in parallel and the old frame stays until they
   * are ready. Without `KHR_parallel_shader_compile`, everything is "ready" right away: nothing waits.
   */
  private async compileBeforeShow(): Promise<void> {
    const r = this.renderer
    if (!r || this.holdFrames) return      // a preparation already holds the frames, and will compile everything
    const gen = ++this.compileGen
    this.scene.updateMatrixWorld()
    const previous = r.getRenderTarget()
    r.setRenderTarget(this.post?.sceneTarget ?? null)
    r.compile(this.scene, this.camera)
    r.setRenderTarget(previous)
    this.compiling = true
    try {
      await this.shadersReady(r, () => gen === this.compileGen)
    } finally {
      if (gen === this.compileGen) { this.compiling = false; this.loop.invalidate() }
    }
  }

  private fitSunShadow(): void {
    if (!this.geometry || !this.house) return
    // Frame the shadow map on the STRUCTURE, not on the house bounds (which include the
    // terrain): on a wide plot, the same 2048 map spent most of its texels
    // on empty lawn. The cast shadows stay covered: in the light's
    // frame, the shadow of a box fits exactly in that box's footprint.
    const b = boundsToWorldBox(buildingBounds(this.house, resolveDefaults(this.house.defaults), this.geometry.roof))
    // …and the GARDEN: a tree outside the structure had no shadow, and that of a large tree was cut
    // at the edge of the frame. Same map, more area: the house's shadows lose sharpness.
    const garden = this.garden.worldBounds()
    if (garden) b.union(garden)
    const center = b.getCenter(new Vector3())
    const r = b.getSize(new Vector3()).length() / 2
    // The light comes from where the current hour's sun comes from (`core/ambience.ts`), at a distance
    // that clears the structure — a `DirectionalLight` has no position in the physical sense, only the
    // DIRECTION counts, but the shadow frustum, for its part, does start from this point.
    this.sun.position.copy(center).addScaledVector(this.sunDir, Math.max(r * 1.6, 12))
    this.sun.target.position.copy(center)
    this.scene.add(this.sun.target)
    // Frustum fitted to the eight corners of the structure expressed in the light's frame.
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
    const margin = Math.max(0.5, r * 0.08)      // the VSM blur overflows the frustum: margin
    const cam = this.sun.shadow.camera
    cam.left = minX - margin; cam.right = maxX + margin
    cam.bottom = minY - margin; cam.top = maxY + margin
    cam.near = Math.max(0.1, minD - margin); cam.far = maxD + margin + r
    cam.updateProjectionMatrix()
  }

  clear(): void {
    for (const m of this.markers.values()) m.dispose()
    this.markers.clear()
    this.reliefEditor?.dispose()
    this.reliefEditor = null
    this.outlineEditor?.dispose()
    this.outlineEditor = null
    this.clearOpeningHandles()
    this.clearOpeningNotes()
    this.clearParkings()
    this.clearParkingNotes()
    this.garden.group.removeFromParent()   // kept: its shapes and materials serve the next house
    this.clearOriginMark()
    this.removePrecipitation()
    this.removeBats()
    this.removeDisco()
    this.removeParade()
    // a new house starts out landed: no upper floor is in flight
    for (const s of this.lifts.values()) s.tween?.cancel()
    this.lifts.clear()
    this.fadeCutY = Infinity
    setLevelFade(1e9, 1)
    this.roomFocusTween?.cancel()
    this.roomFocusTween = null
    this.roomFocusTarget = 0
    setRoomFocusStrength(0)
    this.pillTween?.cancel()
    this.pillTween = null
    this.pillFading = []
    this.pillTargets = new WeakMap()
    if (this.nodes) {
      disposeObject3D(this.nodes.root, new Set<Material>(this.materials.all))
      this.nodes = null
    }
    this.house = null
    this.index = null
    this.geometry = null
    this.syncWater()                       // no more house, hence no more pool to animate
    this.highlightedRoom = null
    this.highlightMeshes = []                // freed with the root
  }

  /** Plugin descriptors (marker type, icon). Rebuilds the markers. */
  setDescriptors(descriptors: Record<string, DeviceDescriptor>): void {
    this.descriptors = new Map(Object.entries(descriptors))
    // a device's KIND comes from its descriptor, which sometimes arrives after the house: a garage
    // door recognized at that moment must remove the leaf the structure had drawn
    if (this.house) { this.refreshDressedOpenings(); this.buildMarkers(); this.updateStates(this.states, true); this.applyLevelFocus(); this.loop.invalidate() }
  }

  /**
   * The openings DRESSED by a cover: those whose leaf belongs to a device, which
   * draws it at its dimensions and opens it. The structure then lays none — otherwise a raised garage door
   * left behind it the fixed panel that `details.ts` had drawn.
   *
   * A cover, and it alone: an opening sensor also fits the rectangle of its window,
   * but it does not close it.
   */
  private dressedOpenings(): Set<string> {
    const out = new Set<string>()
    for (const d of this.house?.devices ?? []) {
      if (!d.openingId) continue
      const kind = (d.deviceId ? this.descriptors.get(d.deviceId)?.kind : undefined) ?? d.kind
      if (kind === 'cover') out.add(d.openingId)
    }
    return out
  }

  /** Redoes the levels' walls when this set has changed, and nothing otherwise (the case of every gesture). */
  private refreshDressedOpenings(): void {
    const next = this.dressedOpenings()
    if (next.size === this.dressed.size && [...next].every((id) => this.dressed.has(id))) return
    this.dressed = next
    for (const l of this.geometry?.levels ?? []) this.rebuildLevelNodes(l.levelId)
  }

  /**
   * Where to place a device: its JSON `position`, or — for a VEHICLE, which has none — the one
   * its GPS gives it, provided it is on the terrain. `null` = no marker.
   *
   * A car is not an object of the building: its place is not data one writes, it is
   * a computation that follows the reading. Parked elsewhere, it simply disappears from the scene.
   */
  private effectivePosition(device: HouseDevice): Vec3 | null {
    // A cover linked to an opening FITS its rectangle: its curtain was already drawn there, but its
    // pill stayed on the JSON's `position` — set once by the auto-placement, then frozen
    // while the opening was refined by finger (2.11 m of offset measured on the office shutter). What
    // one sees and what one touches now come from the same point.
    const rect = device.openingId ? this.openingRect(device.openingId) : undefined
    if (rect) return openingCentre(rect)
    if (device.position) return device.position
    const raw = this.gpsPoint(device)
    if (!raw) return null
    // The vehicle at rest near a compatible space PARKS there: the reading says "it is home", the
    // space says where it goes (`computeParkingFixes`). The z stays the reading's — a space does not
    // lift off the ground.
    const fix = this.parkingFixes.get(device.id)
    return fix ? [fix.position[0], fix.position[1], raw[2]] : raw
  }

  /** The READING's point, projected onto the terrain and corrected by the entered offset — before any space. */
  private gpsPoint(device: HouseDevice): Vec3 | null {
    const state = device.deviceId ? this.states[device.deviceId] : undefined
    // a vehicle, or a mower that publishes its position as GPS (Husqvarna): same projection
    if ((state?.kind !== 'vehicle' && state?.kind !== 'mower') || !state.location || !this.house) return null
    return sitePosition(this.house, state.location, device.gpsOffset)
  }

  /**
   * Orientation of a vehicle placed by its GPS, from the surest to the most assumed:
   *   1. the JSON `yaw`, if it was set by hand — the user has decided;
   *   2. the vendor's HEADING (`headingDeg`), when it gives one (Tesla): it is a measurement;
   *   3. the axis of the room where the car is — a garage parks a car along its length, and
   *      it is better than north;
   *   4. nothing: the marker stays facing +y.
   *
   * `undefined` rather than `0` at the end: the marker keeps its default, nobody asserts a heading.
   *
   * The `yawOffset` correction is ADDED to the heading thus derived (2, 3 and 4): a measured heading stays a
   * measurement — the car that turns still turns —, but neither it nor a garage's axis says which
   * way round it was parked. It does not touch the hand-set `yaw`, which is already authoritative.
   */
  private vehicleYaw(device: HouseDevice, state: DeviceState | undefined, position: Vec3): number | undefined {
    if (device.yaw !== undefined) return device.yaw
    // Parked on a space, it is the SPACE that gives the heading, and it takes precedence over everything derived:
    // the direction of a space was set by hand while looking at the scene. The `yawOffset` is not added
    // to it — it corrects a derivation, and there is nothing left to correct.
    const fix = this.parkingFixes.get(device.id)
    if (fix) return fix.yaw
    if (state?.kind !== 'vehicle' || !this.house) return undefined
    const base = state.headingDeg !== undefined
      ? this.house.origin.heading - state.headingDeg
      : this.enclosingRoomYaw([position[0], position[1]])
    if (device.yawOffset === undefined) return base
    return (base ?? 0) + device.yawOffset
  }

  /**
   * Axis of the ENCLOSED room that contains this point, if there is one. The rooms are tried from the
   * lowest level to the highest: a car is on the ground floor, not in the bedroom that
   * overhangs it.
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
   * The GPS position of a vehicle AND its heading: redoing the markers is what applies them, and a
   * car that parks sometimes turns without changing place to the nearest meter.
   */
  private vehicleFix(state: DeviceState | undefined): string {
    if (state?.kind === 'vehicle' && state.location) return `${state.location.lat},${state.location.lon},${state.headingDeg ?? ''},${atRest(state)}`
    // a mower publishes its position every few seconds while mowing: rebuilding at every
    // reading would be too costly, and useless — its marker FOLLOWS the position (`MowerMarker`). What
    // matters here is only whether it enters or leaves the terrain
    // …and whether it PARKS or not: a mower returning to its base must settle on it, and it is the
    // rebuild that applies the space (`computeParkingFixes`)
    if (state?.kind === 'mower' && state.location && this.house) {
      return `${sitePosition(this.house, state.location) ? 'in' : 'out'}:${atRest(state)}`
    }
    return ''
  }

  /**
   * The devices to draw: those of the house, plus the VEHICLES it does not know.
   *
   * A car does not have to be declared in `house.json` to appear: what puts it in the
   * scene is its GPS, not a configuration line.
   *
   * An undeclared vehicle is identified by its **plugin deviceId** (`tesla:5YJ…`) and not by
   * an invented house id: it is the other key space the app already knows how to resolve (see
   * `useDeviceResolver`), and an id made up from scratch resolved neither the name, nor the kind, nor
   * the commands — the panel then claimed "This device is not bound to any plugin".
   */
  private drawable(): HouseDevice[] {
    const devices = this.house?.devices ?? []
    const known = new Set(devices.map((d) => d.deviceId).filter((id): id is string => !!id))
    const strays: HouseDevice[] = []
    for (const [deviceId, descriptor] of this.descriptors) {
      // an undeclared mower appears likewise, if it publishes a GPS (`effectivePosition` decides)
      if ((descriptor.kind !== 'vehicle' && descriptor.kind !== 'mower') || known.has(deviceId)) continue
      strays.push({ id: deviceId, deviceId, kind: descriptor.kind, meta: {} })
    }
    return [...devices, ...strays]
  }

  private buildMarkers(): void {
    if (!this.house || !this.index || !this.nodes || !this.geometry) return
    this.computeParkingFixes()             // where each one parks: the markers depend on it
    for (const m of this.markers.values()) m.dispose()
    this.markers.clear()
    for (const d of this.drawable()) {
      const marker = this.makeMarker(d)
      if (marker) this.markers.set(d.id, marker)
    }
  }

  /**
   * A marker, placed in its level's group. `null` when the device has no EFFECTIVE
   * position: for most it is the JSON `position`; for a vehicle, it is its GPS projected
   * onto the terrain (`effectivePosition`).
   */
  private makeMarker(d: HouseDevice): DeviceMarker | null {
    if (!this.house || !this.index || !this.nodes || !this.geometry) return null
    const position = this.effectivePosition(d)
    if (!position) return null
    const state = d.deviceId ? this.states[d.deviceId] : undefined
    const yaw = d.position ? d.yaw : this.vehicleYaw(d, state, position)
    const device: PlacedHouseDevice = { ...d, position, ...(yaw === undefined ? {} : { yaw }) }
    const descriptor = device.deviceId ? this.descriptors.get(device.deviceId) : undefined
    const linkedFanDesc = descriptor?.kind === 'light'
      ? [...this.descriptors.values()].find((d) => d.kind === 'fan' && d.meta.linkedTo === descriptor.id)
      : undefined
    // A car parked on a garage space is no longer "outdoors": it follows the level of the
    // space (like the marking). Otherwise, in the upper floor view, its DOM pill pokes through the floor and the ray
    // touches it through the floor — it has no written roomId / levelId.
    const levelId = this.markerLevelId(device)
    const levelNodes = levelId ? this.nodes.levels.get(levelId) : undefined
    const parent = levelNodes ? levelNodes.markers : this.nodes.outdoorMarkers
    const opening = device.openingId ? this.openingRect(device.openingId) : undefined
    const house = this.house
    const marker = createMarker(device, {
      materials: this.materials, theme: this.theme, glow: this.look.glow, outdoor: !levelNodes, descriptor,
      ...(linkedFanDesc ? { linkedFan: true, linkedFanId: linkedFanDesc.id, ...(linkedFanDesc.meta.fan ? { linkedFanSpeeds: linkedFanDesc.meta.fan.speeds } : {}) } : {}),
      ...(opening ? { opening } : {}),
      addAnimation: (a) => this.loop.addAnimation(a),
      invalidate: () => this.loop.invalidate(),
      onTap: (key) => this.emit('deviceTap', key),
      label: device.name ?? descriptor?.name ?? device.id,
      toLocal: (p) => { const xyz = sitePosition(house, p, d.gpsOffset); return xyz ? [xyz[0], xyz[1]] : null },
      groundZ: (x, y) => this.localZ(device, device.position[2], [x, y]),
      // A mower FOLLOWS its published position without rebuilding (`MowerMarker`): it is therefore up to the
      // marker, and not the scene, to know that it is back at its base — otherwise it would drift
      // by a few meters at the next reading, even though it is stopped on it.
      parkedAt: (state) => {
        const fix = this.parkingFixes.get(d.id)
        return fix && atRest(state) ? { xy: fix.position, yaw: fix.yaw } : null
      },
    }, (state) => this.isAtHome(state))
    marker.object.position.set(device.position[0], device.position[1], this.localZ(device, device.position[2]))
    parent.add(marker.object)
    marker.setSelected(this.selectedKey === device.id)
    // the guide (ring, wire, cone) is only drawn on the FIRST movable — ten modules of an
    // array would give ten rings for a single object that moves — but ALL of them can be dragged
    if (this.movableKeys.includes(device.id)) marker.setMoving(true, device.position[2], this.movableKeys[0] === device.id)
    return marker
  }

  /** The rectangle of an opening, across all levels (a cover fits it, a handle too). */
  private openingRect(openingId: string): OpeningRect | undefined {
    for (const l of this.geometry?.levels ?? []) {
      const found = l.openings.find((o) => o.openingId === openingId)
      if (found) return found
    }
    return undefined
  }

  /**
   * z local to the parent group: as is under a level, offset by the terrain UNDER `xy` for an outdoor
   * device (the drawn terrain, relief being edited included).
   */
  private localZ(device: HouseDevice, z: number, xy: readonly number[] | undefined = device.position): number {
    const levelId = this.markerLevelId(device)
    if (levelId && this.nodes!.levels.has(levelId)) return z
    if (resolveDeviceLevelId(device, this.index!.roomsById) || !xy) return z + deviceFloorZ(this.house!, device, this.index!)
    return z + this.groundZ(xy[0]!, xy[1]!)
  }

  /** Absolute height of the drawn terrain at (x, y) — relief included, editing draft included. */
  private groundZ(x: number, y: number): number {
    return this.geometry ? terrainHeight(this.geometry.terrain, x, y) : (this.house?.site.elevation ?? 0)
  }

  /**
   * Level that carries the marker: written `levelId` / room, otherwise that of the space where the vehicle
   * is parked (`parkingFixes`). Otherwise a GPS "in the garage" stays parented to `outdoorMarkers`.
   */
  private markerLevelId(device: HouseDevice): string | null {
    const written = resolveDeviceLevelId(device, this.index!.roomsById)
    if (written) return written
    const fix = this.parkingFixes.get(device.id)
    if (!fix || !this.house) return null
    const parking = this.house.site.parkings.find((p) => p.id === fix.parkingId)
    return parking ? this.parkingLevelId(parking) ?? null : null
  }

  /** Level of a space: written field, otherwise host room (`parkingHost`). */
  private parkingLevelId(p: Parking): string | undefined {
    if (p.levelId) return p.levelId
    const host = this.house ? parkingHost(this.house, p) : null
    return host?.kind === 'room' ? this.index?.roomsById.get(host.id)?.levelId : undefined
  }

  /**
   * Only OPENINGS changed (one is being adjusted by finger). The full path (`load`) redoes
   * everything — the geometry of all levels, all markers, the shadow map — and RECENTERS the
   * camera: unbearable at every finger movement. Here: the whole descriptive geometry (it is
   * pure and cheap), but only the MESHES of the touched levels, and only the markers that
   * fit an opening that moved — a shutter cuts its slat to its window's rectangle.
   * Camera, focused level, selection and all the other markers stay in place.
   *
   * (Measurements were taken while writing this path, but on battery hence in power-saving
   * mode: they say nothing about the machine and are not reported here.)
   */
  updateOpenings(house: House): void {
    if (!this.nodes || !this.house || !this.geometry) { this.load(house); return }
    const before = this.house
    const openingsOf = (h: House, levelId: string) => JSON.stringify(h.rooms.filter((r) => r.levelId === levelId).map((r) => r.openings))
    const levels = house.levels.filter((l) => openingsOf(before, l.id) !== openingsOf(house, l.id)).map((l) => l.id)
    const was = new Map(before.rooms.flatMap((r) => r.openings.map((o) => [o.id, JSON.stringify(o)] as const)))
    const moved = new Set(house.rooms.flatMap((r) => r.openings).filter((o) => was.get(o.id) !== JSON.stringify(o)).map((o) => o.id))
    const roofWindowsOf = (h: House) => JSON.stringify(
      h.rooms.flatMap((r) => r.openings.filter((o) => o.type === 'roof-window')),
    )
    const roofDirty = roofWindowsOf(before) !== roofWindowsOf(house)
    this.house = house
    this.index = indexHouse(house)
    this.geometry = computeHouseGeometry(house)
    for (const levelId of levels) this.rebuildLevelNodes(levelId)
    if (roofDirty) this.rebuildRoof()
    const routing = soundRouting(house.devices, this.states)
    for (const d of this.drawable()) {
      if (!d.openingId || !moved.has(d.openingId)) continue
      this.markers.get(d.id)?.dispose()
      this.markers.delete(d.id)
      const marker = this.makeMarker(d)
      if (!marker) continue
      this.markers.set(d.id, marker)
      const deviceId = marker.device.deviceId
      const relay = deviceId ? routing.relays.get(deviceId) : undefined
      const state = deviceId ? this.states[deviceId] : undefined
      marker.update(state, deviceId
        ? { emits: emitsSound(deviceId, state, routing), ...(relay && this.states[relay] ? { relayFrom: this.states[relay] } : {}) }
        : undefined)
      if (marker.linkedFanDeviceId) marker.setCompanionFan(this.states[marker.linkedFanDeviceId])
    }
    if (this.editingOpenings) this.buildOpeningHandles()
    this.refreshOpeningNotes()
    this.highlightRoom(this.highlightedRoom)
    this.syncWindowGlow()                  // the redone levels have new glass panes
    this.applyLevelFocus()
    if (!this.openingDragger?.active()) this.invalidateShadows()
    this.loop.invalidate()
  }

  /** Redoes the roof mesh (Velux holes) without touching the levels or the camera. */
  private rebuildRoof(): void {
    if (!this.nodes) return
    const old = this.nodes.roof
    if (old) {
      old.removeFromParent()
      disposeObject3D(old, new Set<Material>(this.materials.all))
      this.nodes.roof = null
    }
    if (!this.geometry?.roof) return
    const roof = buildRoofMesh(this.geometry.roof, this.materials)
    this.nodes.root.add(roof)
    this.nodes.roof = roof
  }

  /**
   * Redoes the MESHES of a level (walls, floors, glazing, details) from the current geometry.
   * Its markers, for their part, are taken over as is: rebuilding them is precisely what makes them
   * flicker — and what reopened every closed shutter of the house (see `CoverMarker.posed`).
   */
  private rebuildLevelNodes(levelId: string): void {
    const nodes = this.nodes
    const old = nodes?.levels.get(levelId)
    const lg = this.geometry?.levels.find((l) => l.levelId === levelId)
    if (!nodes || !old || !lg) return
    const fresh = buildLevel(lg, this.materials, this.dressed, this.geometry?.facade)
    fresh.group.remove(fresh.markers, fresh.labels)   // the new ones are empty: it is the old ones we keep
    old.markers.removeFromParent()
    old.labels.removeFromParent()
    fresh.group.add(old.markers, old.labels)
    // The selected room's line and the opening handles are rebuilt afterward: they
    // escape here the freeing of the old group. The handles above all: their four materials
    // are SHARED by all levels, and freeing them with this group would leave the handles
    // of the other levels holding a dead material.
    for (const m of this.highlightMeshes) if (m.parent === old.group) m.removeFromParent()
    for (const h of this.openingHandles.values()) if (h.group.parent === old.group) h.group.removeFromParent()
    disposeObject3D(old.group, new Set<Material>(this.materials.all))
    const next: LevelNodes = { ...fresh, markers: old.markers, labels: old.labels }
    nodes.levels.set(levelId, next)
    nodes.root.add(next.group)
  }

  /** Only the devices changed (placement): we redo the markers without touching the walls or the camera. */
  updateDevices(house: House): void {
    if (!this.nodes) { this.load(house); return }
    this.house = house
    this.index = indexHouse(house)
    this.refreshDressedOpenings()          // linking (or unlinking) a cover removes (or restores) the structure's leaf
    this.buildMarkers()
    this.updateStates(this.states, true)
    this.applyLevelFocus()
    this.invalidateShadows()
    this.loop.invalidate()
  }

  // ---- "move" mode ---------------------------------------------------------
  /**
   * Makes a device movable by finger — or a GROUP of markers that move together: the
   * modules of a panel array, any of which can be grabbed to carry the whole array.
   * `null` leaves the mode. The drag events name the GRABBED marker; it is up to the caller to
   * derive what becomes of the group.
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

  // ---- "adjust the openings" mode ------------------------------------------
  /**
   * Enters (or leaves) edit mode: a handle appears on EVERY opening — doors, passages and
   * garage doors included, which have no object in the scene and so offered nothing to
   * grab. They live and die with the mode.
   */
  setEditingOpenings(on: boolean): void {
    if (this.editingOpenings === on) return
    this.editingOpenings = on
    if (!on) this.setSelectedOpening(null)
    this.buildOpeningHandles()
    this.buildOriginMark()
    this.refreshOpeningNotes()
    this.applyLevelFocus()                 // the handles of a hidden level have no business showing
    this.loop.invalidate()
  }

  /**
   * The opening being adjusted: it stands out from the others, and it is the ONLY one that can be dragged —
   * just as only one device is moved at a time (`setMovable`).
   */
  setSelectedOpening(id: string | null): void {
    this.selectedOpeningId = id
    this.styleOpeningHandles()
    this.refreshOpeningNotes()
    this.openingDragger?.detach()
    this.openingDragger = null
    if (id && this.editingOpenings && !this.deps.headless) {
      this.openingDragger = createDragDetector(this.canvas, {
        hitTest: (ev) => this.grabsOpening(id, ev),
        onStart: () => this.startOpeningDrag(id),
        onMove: (ev) => this.moveOpeningDrag(id, ev),
        onEnd: (_ev, moved) => this.endOpeningDrag(id, moved),
      })
    }
    this.loop.invalidate()
  }

  /**
   * Arms (or disarms) placing an opening in a room: the next tap on the structure of its
   * level reports the touched point (`placeTap`) instead of changing the selection. For a
   * surface opening (roof / floor), a heading cone is shown at the center of the room.
   */
  setPlacingOpening(armed: { roomId: string; type: string } | null): void {
    this.placingOpening = armed
    this.clearPlacingYawGuide()
    if (armed && (armed.type === 'roof-window' || armed.type === 'skylight')) {
      this.showPlacingYawGuide(armed.roomId || null, armed.type === 'roof-window' ? 180 : 0)
    }
  }

  private clearPlacingYawGuide(): void {
    if (!this.placingYawGuide) return
    this.placingYawGuide.geometry.dispose()
    ;(this.placingYawGuide.material as MeshBasicMaterial).dispose()
    this.placingYawGuide.parent?.remove(this.placingYawGuide)
    this.placingYawGuide = null
    this.loop.invalidate()
  }

  private showPlacingYawGuide(roomId: string | null, yawDeg: number): void {
    if (!this.nodes) return
    let cx = 0, cy = 0, z = 0.02
    let parent: Group | undefined
    if (roomId) {
      const room = this.house?.rooms.find((r) => r.id === roomId)
      const level = room ? this.nodes.levels.get(room.levelId) : undefined
      if (!room || !level) return
      for (const [x, y] of room.polygon) { cx += x; cy += y }
      cx /= room.polygon.length
      cy /= room.polygon.length
      parent = level.group
    } else {
      const outline = this.geometry?.roof?.outline
      if (!outline?.length) return
      for (const [x, y] of outline) { cx += x; cy += y }
      cx /= outline.length
      cy /= outline.length
      const roofLvl = this.roofLevel()
      parent = roofLvl ? this.nodes.levels.get(roofLvl.id)?.group : undefined
      if (!parent) return
      // above the roof slab, in the roof level's frame (local z)
      const elev = roofLvl?.elevation ?? 0
      z = (this.geometry?.roof?.zBase ?? elev) - elev + 0.05
    }
    const shape = new Shape()
    shape.moveTo(0, 0.18)
    shape.lineTo(-0.42, 1.35)
    shape.quadraticCurveTo(0, 1.6, 0.42, 1.35)
    shape.lineTo(0, 0.18)
    const color = this.theme.primary
    const mesh = new Mesh(
      new ShapeGeometry(shape, 12),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false, side: DoubleSide }),
    )
    mesh.renderOrder = 999
    mesh.rotation.z = (yawDeg * Math.PI) / 180
    // Same convention as the existing code: (x, 0.02, −y) in the level group.
    mesh.position.set(cx, z, -cy)
    parent.add(mesh)
    this.placingYawGuide = mesh
    this.loop.invalidate()
  }

  /**
   * Point of the structure under the finger, in the house reference frame. Depending on the armed kind: walls+floors (wall),
   * floors only (skylight), roof (roof window).
   */
  private buildingPoint(roomId: string, type: string | undefined, ndc: { x: number; y: number }): [number, number] | null {
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera)
    // Roof window: we aim at the roof mesh, room or not (placed from the Roof tab).
    if (type === 'roof-window') {
      if (!this.nodes?.roof) return null
      const hit = this.raycaster.intersectObject(this.nodes.roof, false)[0]
      return hit ? [hit.point.x, -hit.point.z] : null
    }
    const levelId = this.house?.rooms.find((r) => r.id === roomId)?.levelId
    const level = levelId ? this.nodes?.levels.get(levelId) : undefined
    if (!level) return null
    const targets: Object3D[] = []
    if (type === 'skylight') {
      const floor = level.floors.get(roomId)
      if (floor) targets.push(floor)
      else targets.push(...level.floors.values())
    } else {
      targets.push(...level.walls, ...level.floors.values())
    }
    if (targets.length === 0) return null
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    return hit ? [hit.point.x, -hit.point.z] : null
  }

  /**
   * Frames an opening: the same 3 m box as a device, seen FROM inside its room (the
   * `roomSideAzimuth` computation for a device against a wall) — otherwise one looks at the window
   * from the lawn, through the facade.
   */
  focusOpening(openingId: string, animate = true): void {
    const rect = this.openingRect(openingId)
    if (!rect || !this.house) return
    // Roof window: frame from the Roof tab (otherwise the roof disappears and one thinks it is on the floor).
    if (rect.host === 'roof') {
      const roofLvl = this.roofLevel()
      if (roofLvl && this.focusedLevelId !== roofLvl.id) this.focusLevel(roofLvl.id)
    } else if (this.focusedLevelId !== rect.levelId) {
      this.focusLevel(rect.levelId)
    }
    const elevation = this.geometry?.levels.find((l) => l.levelId === rect.levelId)?.elevation ?? 0
    const centre = openingCentre(rect)
    const cx = centre[0], cy = centre[1]
    const z = elevation + centre[2]
    // Frame the opening AND ITS DIMENSIONS, not just the opening: a fixed box around the opening
    // left the right-hand dimension out of the image (or under the search field) as soon as the gap on
    // that side exceeded a meter and a half. We bound the reach — on a ten-meter wall, the end of
    // the dimension is of no interest anymore and backing up that far would show nothing of the opening.
    const room = this.house.rooms.find((r) => r.id === rect.roomId)
    const opening = room?.openings.find((o) => o.id === openingId)
    const box = new Box3()
    if (rect.host === 'wall') {
      const gaps = room && opening ? openingGaps(room, opening) : { left: 0, right: 0 }
      for (const t of [-Math.min(gaps.right, OPENING_FOCUS_REACH_M), rect.width + Math.min(gaps.left, OPENING_FOCUS_REACH_M)]) {
        box.expandByPoint(houseToWorld([rect.origin[0] + rect.u[0] * t, rect.origin[1] + rect.u[1] * t, z]))
      }
    } else {
      box.expandByPoint(houseToWorld([cx, cy, z]))
    }
    box.expandByScalar(DEVICE_FOCUS_SIZE_M / 2)     // the opening's height, the wall thickness, and some air
    const b = roomBounds(this.house, rect.roomId, resolveDefaults(this.house.defaults))
    const c = b ? boundsCenter(b) : null
    const { azimuth, polar } = this.currentSpherical()
    const inward = c && Math.hypot(c[0] - cx, c[1] - cy) > 0.5 ? Math.atan2(c[0] - cx, -(c[1] - cy)) : null
    this.flyTo(box, inward ?? azimuth, clamp(polar, DEVICE_FOCUS_POLAR[0], DEVICE_FOCUS_POLAR[1]), animate, 1.1)
  }

  // ---- parking spaces ----------------------------------------------------

  /**
   * Who PARKS where, for all vehicles at once (`assignParkings`, shared and tested without a scene).
   *
   * Recomputed with the markers, because it is their construction that applies it: a car
   * that came home since the last reading had no marker, a car that left no longer has one, and
   * a car that parks changes place without changing state.
   *
   * A device that has a written `position` is not a candidate: its place is authoritative (same rule as
   * everywhere else), and a parking space only moves what comes from a GPS.
   */
  private computeParkingFixes(): void {
    const parkings = this.house?.site.parkings ?? []
    if (!parkings.length) { this.parkingFixes = new Map(); return }
    const candidates = []
    for (const d of this.drawable()) {
      if (d.position) continue
      const state = d.deviceId ? this.states[d.deviceId] : undefined
      const kind = state?.kind ?? d.kind
      const point = this.gpsPoint(d)
      if (!kind || !point) continue
      candidates.push({
        key: d.id, kind, ...(d.deviceId ? { deviceId: d.deviceId } : {}),
        point: [point[0], point[1]] as Vec2, atRest: atRest(state),
      })
    }
    this.parkingFixes = assignParkings(parkings, candidates)
  }

  /**
   * The MARKING of the spaces, which lives permanently — it is not an edit handle but
   * paint on the ground (see `builders/parking.ts` for the two drawings). Edit mode only adds
   * the touchable veil and the frame, by a simple material swap (`styleParkingHandles`).
   *
   * Where to lay it: in the MARKERS of the level of the room that carries it (a garage), on
   * `DECOR_LAYER` — a translucent decoration, outside the occlusion capture, hidden with its level. Outdoors,
   * it is ground like any other: in the site group, with the terrain.
   */
  private buildParkings(): void {
    this.clearParkings()
    if (!this.house || !this.nodes || !this.index) return
    const parkings = this.house.site.parkings
    if (!parkings.length) return
    const mats = parkingMaterials(this.theme.primary)
    this.parkingMats = mats
    this.parkingGlyph = parkingGlyphTexture(mats.paint.color)
    for (const p of parkings) {
      const { parent, z, levelled } = this.parkingParent(p)
      const gaps = p.id === this.selectedParkingId ? this.parkingGaps(p) : undefined
      const nodes = buildParking(p, z, mats, this.parkingGlyph, gaps ?? undefined)
      if (levelled) nodes.group.traverse((n) => n.layers.set(DECOR_LAYER))
      parent.add(nodes.group)
      // same stale-matrix pitfall as the handles: the ray reads `matrixWorld`
      nodes.group.updateWorldMatrix(true, true)
      this.parkingNodes.set(p.id, nodes)
    }
    this.styleParkingHandles()
    this.loop.invalidate()
  }

  /**
   * The group that carries a space, and its LOCAL z: the markers of its LEVEL, or the site.
   *
   * It is `levelId` that decides, not the point: a space is laid ON a level (the garage, the roof
   * for a drone pad) or on the terrain, and that is the choice made when placing it. A
   * space written without a level falls back on the room that contains it — those from before the field do
   * not move.
   */
  private parkingParent(p: Parking): { parent: Group; z: number; levelled: boolean } {
    const site = this.nodes!.site
    const levelId = this.parkingLevelId(p)
    const levelNodes = levelId ? this.nodes!.levels.get(levelId) : undefined
    return levelNodes
      ? { parent: levelNodes.markers, z: 0, levelled: true }
      : { parent: site, z: this.groundZ(p.center[0], p.center[1]), levelled: false }
  }

  /** The four dimensions of a space within its host, `null` if it is laid on nothing known. */
  private parkingGaps(p: Parking): Record<ParkingSide, number | null> | null {
    const host = this.house ? parkingHost(this.house, p) : null
    return host ? parkingGaps(host.polygon, p) : null
  }

  private clearParkings(): void {
    for (const n of this.parkingNodes.values()) disposeObject3D(n.group)
    this.parkingNodes.clear()
    if (this.parkingMats) for (const m of Object.values(this.parkingMats)) m.dispose()
    this.parkingMats = null
    this.parkingGlyph?.dispose()
    this.parkingGlyph = null
  }

  /**
   * Three states, like the opening handles: outside edit mode nothing of the adjustment shows (the
   * marking alone); in edit mode each space carries a thin frame; the one being adjusted carries a thick
   * frame, drawn over the walls, and a tinted veil. Nothing is built or destroyed —
   * only MATERIALS change.
   */
  private styleParkingHandles(): void {
    const mats = this.parkingMats
    if (!mats) return
    for (const [id, n] of this.parkingNodes) {
      // The SELECTED space shows even outside edit mode: we arrive here from the Robots view, which
      // arms the placement of a base without asking anything of Settings, and a space just placed
      // must be seen and dragged. The others only have their frame in edit mode.
      const on = id === this.selectedParkingId
      n.fill.material = on ? mats.fillOn : mats.off
      n.ring.material = this.editingParkings && !on ? mats.ring : mats.off
      n.ringOn.material = on ? mats.ringOn : mats.off
      // the direction cone lives with the frame: it only has a reason to exist while placing
      n.cone.material = on ? mats.ringOn : this.editingParkings ? mats.ring : mats.off
    }
    this.loop.invalidate()
  }

  /**
   * "Place a space" mode: the next tap selects nothing, it reports the touched FLOOR
   * point (`groundTap`). Tapped outside any floor, it is a cancellation, as for an opening.
   */
  setPlacingParking(on: boolean): void {
    if (this.placingParking === on) return
    this.placingParking = on
    this.loop.invalidate()
  }

  /** "Place a room" mode: the next tap reports the touched floor point (`roomPlaceTap`). */
  setPlacingRoom(on: boolean): void {
    if (this.placingRoom === on) return
    this.placingRoom = on
    this.loop.invalidate()
  }

  /**
   * The floor point under the finger, AND the level of that floor: room floor, roof slab, terrain or
   * zone — the first one hit. `levelId: null` = the terrain was touched, hence the garden.
   *
   * It is what gives its LEVEL to a space being placed: it goes in the garage by tapping the garage
   * floor, on the roof by tapping the roof, in the garden by tapping the lawn. Nothing to choose
   * in a menu — the touched surface already says it all.
   */
  private groundPoint(ndc: { x: number; y: number }): { xy: [number, number]; levelId: string | null } | null {
    if (!this.nodes) return null
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera)
    const floorLevel = new Map<Object3D, string>()
    const targets: Object3D[] = [this.nodes.terrain, ...this.nodes.zones.values()]
    for (const [levelId, level] of this.nodes.levels) {
      if (!level.group.visible) continue
      for (const floor of level.floors.values()) { targets.push(floor); floorLevel.set(floor, levelId) }
    }
    const roof = this.nodes.roof
    const roofLevel = roof?.visible ? this.roofLevel() : undefined
    if (roof && roofLevel) { targets.push(roof); floorLevel.set(roof, roofLevel.id) }
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return null
    return { xy: [hit.point.x, -hit.point.z], levelId: floorLevel.get(hit.object) ?? null }   // world (x, y, z) → house (x, z, -y)
  }

  /** "Adjust the spaces" mode: armed from Settings, like the openings one. */
  setEditingParkings(on: boolean): void {
    if (this.editingParkings === on) return
    this.editingParkings = on
    if (!on) this.setSelectedParking(null)
    else this.styleParkingHandles()
  }

  /**
   * The space being adjusted. As for an opening, it is the selection that arms the drag: only one
   * space moves at a time, and it can only be grabbed by itself.
   */
  setSelectedParking(id: string | null): void {
    this.selectedParkingId = id
    this.buildParkings()                   // the dimension lines are born and die with the selection
    this.refreshParkingNotes()
    this.parkingDragger?.detach()
    this.parkingDragger = null
    if (id && !this.deps.headless) {
      this.parkingDragger = createDragDetector(this.canvas, {
        hitTest: (ev) => this.grabsParking(id, ev),
        onStart: () => this.startParkingDrag(id),
        onMove: (ev) => this.moveParkingDrag(id, ev),
        onEnd: (_ev, moved) => this.endParkingDrag(id, moved),
      })
    }
  }

  /**
   * Only SPACES changed (one is being adjusted by finger). Neither the geometry nor the levels depend
   * on them: we redo the marking, recompute who parks where, and only rebuild the
   * markers whose space changed — that is what makes the car follow during the gesture without
   * redoing the forty other markers every frame.
   */
  updateParkings(house: House): void {
    if (!this.nodes || !this.house) { this.load(house); return }
    const before = this.parkingFixes
    this.house = house
    this.index = indexHouse(house)
    this.buildParkings()
    this.computeParkingFixes()
    for (const key of new Set([...before.keys(), ...this.parkingFixes.keys()])) {
      if (JSON.stringify(before.get(key) ?? null) === JSON.stringify(this.parkingFixes.get(key) ?? null)) continue
      const device = this.drawable().find((d) => d.id === key)
      this.markers.get(key)?.dispose()
      this.markers.delete(key)
      const marker = device ? this.makeMarker(device) : null
      if (marker) this.markers.set(key, marker)
    }
    this.updateStates(this.states, true)
    this.applyLevelFocus()
    this.refreshParkingNotes()
    this.loop.invalidate()
  }

  /**
   * Only the TERRAIN changed — relief or outline (it was just saved from the editor). The
   * full path (`load`) would recenter the camera; here, the terrain takes its z values again (or is remeshed
   * on its new outline) and what sits on it follows.
   */
  updateRelief(house: House): void {
    if (!this.nodes || !this.house) { this.load(house); return }
    this.house = house
    this.index = indexHouse(house)
    this.geometry = computeHouseGeometry(house)
    if (this.reliefGrid) this.applyReliefDraft()
    else this.shapeTerrainNow()
    this.afterTerrainChange()
    this.fitSunShadow()                    // the house bounds follow the saved relief
    this.emitRelief()
  }

  // ---- garden (trees, bushes, stones) ---------------------------------------
  private buildGarden(): void {
    if (!this.nodes || !this.house) return
    this.nodes.site.add(this.garden.group)
    this.garden.setAccent(this.theme.primary)
    this.garden.build(this.house.site.garden, (x, y) => this.groundZ(x, y), this.season, this.look.garden)
    this.fitSunShadow()                    // the shadow frame follows the garden
    this.markReflection()                  // the pool sees the trees
    // the characters skirt the garden from their path onward: a changed garden (editing, season, or
    // simply built after them at load) reroutes them
    const key = JSON.stringify(this.garden.footprints().map((c) => [c.x, c.y, c.r].map((v) => Math.round(v * 10))))
    if (key !== this.gardenRoamKey) {
      this.gardenRoamKey = key
      if (this.parade) { this.removeParade(); this.syncParade() }
      if (this.bats) { this.removeBats(); this.syncBats() }
    }
  }

  /**
   * The pool reflection needs redoing. Not right away: a finger drag, a slider,
   * a relief being shaped request one per frame; we wait for things to calm down, then one frame.
   */
  private markReflection(): void {
    if (this.deps.headless || !this.renderer) return
    this.reflectionDue = (this.deps.now?.() ?? performance.now()) + REFLECTION_SETTLE_MS
    if (this.reflectionTimer !== null) clearTimeout(this.reflectionTimer)
    this.reflectionTimer = setTimeout(() => { this.reflectionTimer = null; this.loop.invalidate() }, REFLECTION_SETTLE_MS + 20)
  }

  /** Redoes the probe above the (first) pool, if it is due. No pool = no cost. */
  private updateReflection(r: WebGLRenderer, now: number): void {
    if (!this.reflectionDue || now < this.reflectionDue || !this.nodes || !this.geometry) return
    this.reflectionDue = 0
    const pool = this.geometry.zones.find((z) => z.kind === 'pool')
    const mesh = pool ? this.nodes.zones.get(pool.zoneId) : undefined
    if (!mesh) return
    const box = new Box3().setFromObject(mesh)
    const at = box.getCenter(new Vector3()).setY(box.max.y + REFLECTION_EYE_M)
    this.reflection ??= new ReflectionProbe()
    this.reflection.update(r, this.scene, at, [mesh], this.skyEnv)
    const water = this.materials.zones.pool
    if (water.envMap !== this.reflection.texture) { water.envMap = this.reflection.texture; water.needsUpdate = true }
  }

  /** Only the GARDEN changed: the elements are laid again, nothing else is rebuilt. */
  updateGarden(house: House): void {
    if (!this.nodes || !this.house) { this.load(house); return }
    this.house = house
    this.index = indexHouse(house)
    this.buildGarden()
    if (this.selectedGardenId && !house.site.garden.some((g) => g.id === this.selectedGardenId)) this.setSelectedGarden(null)
    this.invalidateShadows()
    this.loop.invalidate()
  }

  setSeason(season: Season): void {
    if (this.season === season) return
    this.season = season
    this.buildGarden()
    this.invalidateShadows()
    this.loop.invalidate()
  }

  /** Edit mode: the garden elements become touchable. */
  setEditingGarden(on: boolean): void {
    if (this.editingGarden === on) return
    this.editingGarden = on
    if (!on) this.setSelectedGarden(null)
  }

  /** Armed element: the next tap reports the terrain point (`gardenPlaceTap`). */
  setPlacingGarden(on: boolean): void {
    this.placingGarden = on
    this.loop.invalidate()
  }

  /** The adjusted element: ring at its foot, and it alone can be dragged, grabbed by itself. */
  setSelectedGarden(id: string | null): void {
    this.selectedGardenId = id
    this.garden.setSelected(id)
    this.gardenDragger?.detach()
    this.gardenDragger = null
    if (id && !this.deps.headless) {
      this.gardenDragger = createDragDetector(this.canvas, {
        hitTest: (ev) => this.grabsGarden(id, ev),
        onStart: () => this.startGardenDrag(id),
        onMove: (ev) => this.moveGardenDrag(id, ev),
        onEnd: (_ev, moved) => this.endGardenDrag(id, moved),
      })
    }
    this.loop.invalidate()
  }

  /** Frames a garden element, seen from where it was being looked at. */
  focusGarden(id: string, animate = true): void {
    const box = this.garden.boxOf(id)
    if (!box) return
    box.expandByScalar(DEVICE_FOCUS_SIZE_M / 2)
    const { azimuth, polar } = this.currentSpherical()
    this.flyTo(box, azimuth, clamp(polar, DEVICE_FOCUS_POLAR[0], DEVICE_FOCUS_POLAR[1]), animate, 1.1)
  }

  private grabsGarden(id: string, ev: TapEvent): boolean {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    return this.raycaster.intersectObjects(this.garden.pickables(), false).some((h) => this.garden.idOf(h) === id)
  }

  private startGardenDrag(id: string): void {
    const foot = this.garden.footOf(id)
    if (!foot) return
    if (this.controls) this.controls.enabled = false
    this.cameraTween?.cancel()
    // horizontal plane at the FOOT, finger–foot offset preserved (same rule as a space)
    const world = this.garden.group.localToWorld(foot.clone())
    this.dragPlane.setFromNormalAndCoplanarPoint(WORLD_UP, world)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    this.dragOffset.copy(hit ? hit.sub(world) : new Vector3())
  }

  private moveGardenDrag(id: string, ev: TapEvent): void {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    if (!hit) return
    hit.sub(this.dragOffset)
    this.pendingGardenXY = [hit.x, -hit.z]          // world (x, y, z) ← house (x, z, -y)
    if (this.gardenFrame !== 0) return
    this.gardenFrame = requestAnimationFrame(() => {
      this.gardenFrame = 0
      this.flushGardenDrag(id)
    })
  }

  private flushGardenDrag(id: string): void {
    const xy = this.pendingGardenXY
    this.pendingGardenXY = null
    if (xy) this.emit('gardenDrag', id, xy)
  }

  private endGardenDrag(id: string, moved: boolean): void {
    if (this.controls) this.controls.enabled = true
    if (this.gardenFrame !== 0) { cancelAnimationFrame(this.gardenFrame); this.gardenFrame = 0 }
    this.flushGardenDrag(id)
    if (moved) this.emit('gardenDrop', id)
    this.invalidateShadows()
  }

  // ---- "shape the terrain" mode ---------------------------------------------
  /**
   * Enters (or leaves) relief editing. On entering, the draft starts from the saved relief (or
   * from a flat grid at the `RELIEF_STEP` step); on leaving, the terrain goes back to the
   * file's — saving is the panel's business, before leaving.
   */
  setEditingRelief(on: boolean): void {
    this.reliefWanted = on
    if (on === (this.reliefGrid !== null)) return
    if (on) {
      if (!this.house) return              // the house is not there: `load` will open the mode
      this.reliefGrid = parseRelief(this.house.site.relief) ?? emptyReliefGrid(this.house.site.terrain, RELIEF_STEP)
      this.outlineDraft = this.house.site.terrain.map(([x, y]) => [x, y])
    } else {
      this.reliefGrid = null
      this.outlineDraft = null
      this.reliefEditor?.dispose()
      this.reliefEditor = null
      this.outlineEditor?.dispose()
      this.outlineEditor = null
      if (this.house) this.geometry = computeHouseGeometry(this.house)
    }
    if (!this.nodes || !this.geometry) return
    if (on) this.applyReliefDraft()
    else this.shapeTerrainNow()
    this.syncReliefFocus()
    this.afterTerrainChange()
    this.emitRelief()
  }

  /**
   * We are shaping the TERRAIN: the house fades (all the materials of the levels and of the roof, through
   * `levelFade`'s dithered opacity — no transparency sorting, no recompilation) and the
   * pills disappear. Everything comes back on leaving the mode.
   */
  private syncReliefFocus(): void {
    for (const m of this.reliefFaded) materialOpacity(m).value = 1
    this.reliefFaded.clear()
    const on = this.reliefGrid !== null
    if (on && this.nodes) {
      const fade = (root: Object3D) => root.traverse((o) => {
        const mat = (o as Mesh).material as Material | Material[] | undefined
        for (const m of mat ? (Array.isArray(mat) ? mat : [mat]) : []) { materialOpacity(m).value = RELIEF_HOUSE_OPACITY; this.reliefFaded.add(m) }
      })
      for (const level of this.nodes.levels.values()) fade(level.group)
      if (this.nodes.roof) fade(this.nodes.roof)
    }
    if (this.labelRenderer) this.labelRenderer.domElement.style.visibility = on ? 'hidden' : ''
    this.invalidateShadows()
    this.loop.invalidate()
  }

  /** Replaces the draft (IGN import); `null` = flat terrain. The replacement can be undone like a gesture. */
  setReliefDraft(relief: Relief | null): void {
    if (!this.reliefGrid || !this.house) return
    this.reliefGrid = parseRelief(relief ?? undefined) ?? emptyReliefGrid(this.house.site.terrain, RELIEF_STEP)
    this.reliefEditor?.setGrid(this.reliefGrid)
    this.applyReliefDraft()
    this.afterTerrainChange()
    this.emitRelief()
  }

  /** Selects the neighboring dot in a screen direction (keyboard arrows). */
  stepReliefSelection(sx: number, sy: number): void {
    if (this.reliefEditor?.stepSelection(sx, sy)) this.emitRelief()
  }

  /** Undoes (or redoes) the last relief change. */
  undoRelief(): void { if (this.reliefEditor?.undo()) this.afterReliefTravel() }
  redoRelief(): void { if (this.reliefEditor?.redo()) this.afterReliefTravel() }
  private afterReliefTravel(): void {
    this.reliefGrid = this.reliefEditor!.grid            // the history returns another grid object
    this.applyReliefDraft()
    this.afterTerrainChange()
    this.emitRelief()
  }

  /** The selected dot takes the height entered in the panel (cm). */
  setReliefPoint(cm: number): void {
    if (this.reliefEditor?.setSelectedCm(cm)) this.onReliefChanged(true)
  }

  /** The draft as it is written into the house; `null` if it is flat (the field is removed). */
  reliefDraft(): Relief | null {
    return this.reliefGrid && !isFlatRelief(this.reliefGrid) ? serializeRelief(this.reliefGrid) : null
  }

  /**
   * Applies the draft to the geometry and to the meshes, and (re)creates the editor if the root is
   * new. Without a draft, nothing: the geometry is already the file's.
   */
  private applyReliefDraft(): void {
    const drafted = this.reliefGrid
    if (!drafted || !this.nodes || !this.geometry) return
    const polygon = this.outlineDraft ?? this.geometry.terrain.polygon
    // an outline extended beyond the grid enlarges it: its new nodes get a handle
    const grid = extendReliefGrid(drafted, polygon)
    if (grid !== drafted) { this.reliefGrid = grid; this.reliefEditor?.adoptGrid(grid) }
    this.geometry = { ...this.geometry, terrain: { ...this.geometry.terrain, polygon, relief: grid } }
    const reshaped = this.shapeTerrainNow()
    if (!this.outlineEditor) {
      this.outlineEditor = new OutlineEditor({
        canvas: this.canvas,
        camera: this.camera,
        parent: this.nodes.site,
        ground: (x, y) => this.groundZ(x, y),
        setControls: (enabled) => { if (this.controls) this.controls.enabled = enabled; if (!enabled) this.cameraTween?.cancel() },
        invalidate: () => this.loop.invalidate(),
        changed: (final) => this.onOutlineChanged(final),
        selectionChanged: () => this.emitRelief(),
        accent: this.theme.primary,
      }, polygon, !!this.deps.headless)
    } else {
      this.outlineEditor.refresh()
    }
    if (!this.reliefEditor) {
      this.reliefEditor = new ReliefEditor({
        canvas: this.canvas,
        camera: this.camera,
        parent: this.nodes.site,
        terrain: () => this.geometry!.terrain,
        setControls: (enabled) => { if (this.controls) this.controls.enabled = enabled; if (!enabled) this.cameraTween?.cancel() },
        invalidate: () => this.loop.invalidate(),
        changed: (final) => this.onReliefChanged(final),
        selectionChanged: () => this.emitRelief(),
        accent: this.theme.primary,
      }, grid, !!this.deps.headless)
    } else if (reshaped) {
      this.reliefEditor.layout()           // the nodes INSIDE the plot have changed
    } else {
      this.reliefEditor.refresh()
    }
    this.reliefEditor.setEnabled(this.terrainTab === 'relief')
    this.outlineEditor.setEnabled(this.terrainTab === 'outline')
  }

  /** Lays the terrain on `geometry.terrain`, remeshed if its outline is no longer the mesh's; true if it was. */
  private shapeTerrainNow(): boolean {
    if (!this.nodes || !this.geometry) return false
    const key = JSON.stringify(this.geometry.terrain.polygon)
    const reshaped = key !== this.meshedOutline
    shapeTerrain(this.nodes, this.geometry, this.materials, reshaped)
    this.meshedOutline = key
    return reshaped
  }

  /** Switches tab: only the tab's editor shows its handles and takes the taps. */
  setTerrainTab(tab: TerrainTab): void {
    if (this.terrainTab === tab) return
    this.terrainTab = tab
    this.reliefEditor?.setEnabled(tab === 'relief')
    this.outlineEditor?.setEnabled(tab === 'outline')
    this.emitRelief()
  }

  /** The outline moved: during a drag, only the line follows; the end of the gesture remeshes the terrain. */
  private onOutlineChanged(final: boolean): void {
    const e = this.outlineEditor
    if (!e) return
    this.outlineDraft = e.polygon.map(([x, y]) => [x, y])
    if (final) {
      this.applyReliefDraft()
      this.afterTerrainChange()
    }
    this.emitRelief()
  }

  /** Undoes (or redoes) the last outline change. */
  undoOutline(): void { if (this.outlineEditor?.undo()) this.onOutlineChanged(true) }
  redoOutline(): void { if (this.outlineEditor?.redo()) this.onOutlineChanged(true) }

  /** The selected vertex takes the position entered in the panel (m, house reference frame). */
  setOutlinePoint(xy: Vec2): void {
    if (this.outlineEditor?.setSelectedXY(xy)) this.onOutlineChanged(true)
    else this.emitRelief()                 // refused: the panel shows the kept position again
  }

  /** Replaces the outline draft (cadastre import); the replacement can be undone like a gesture. */
  setOutlineDraft(polygon: Vec2[]): void {
    if (!this.outlineEditor) return
    this.outlineEditor.setPolygon(polygon)
    this.onOutlineChanged(true)
  }

  /** Removes the selected vertex. */
  removeOutlinePoint(): void {
    if (this.outlineEditor?.removeSelected()) this.onOutlineChanged(true)
  }

  /** A drag in progress: one terrain update per FRAME; the end of the gesture redoes the rest. */
  private onReliefChanged(final: boolean): void {
    if (final) {
      if (this.reliefFrame !== 0) { cancelAnimationFrame(this.reliefFrame); this.reliefFrame = 0 }
      this.applyReliefDraft()
      this.afterTerrainChange()
      this.emitRelief()
      return
    }
    if (this.reliefFrame !== 0) return
    this.reliefFrame = requestAnimationFrame(() => {
      this.reliefFrame = 0
      if (!this.nodes || !this.geometry) return
      shapeTerrain(this.nodes, this.geometry, this.materials)
      this.reliefEditor?.refresh()
      this.emitRelief()
    })
  }

  /**
   * What sits on the terrain follows it: garden devices, vehicles, log pins,
   * parking spaces; the shadow and the mist are redone on the new surface.
   */
  private afterTerrainChange(): void {
    if (!this.nodes || !this.house) return
    for (const m of this.markers.values()) {
      if (m.object.parent !== this.nodes.outdoorMarkers) continue
      m.object.position.z = this.localZ(m.device, m.device.position[2])
    }
    for (const p of this.journal?.points ?? []) p.anchor.position.z = this.groundZ(p.anchor.position.x, p.anchor.position.y)
    this.buildParkings()
    this.buildGroundOverlay()
    this.buildGarden()
    this.applyMist()
    this.invalidateShadows()
    this.loop.invalidate()
  }

  private emitRelief(): void {
    const e = this.reliefEditor
    const o = this.outlineEditor
    const outline: OutlineEditState | null = o ? { point: o.selectedXY(), draft: o.polygon.map(([x, y]) => [x, y]), canUndo: o.canUndo, canRedo: o.canRedo, canRemove: o.canRemove, pick: o.pick } : null
    this.emit('reliefChange', e ? { pointCm: e.selectedCm(), draft: this.reliefDraft(), canUndo: e.canUndo, canRedo: e.canRedo, pick: e.pick, tab: this.terrainTab, outline } : null)
  }

  /**
   * Frames a space: its box, plus some air around it, seen from where it was being looked at. The LEVEL, for its part, is
   * focused by the store when the space is in a room (`selectParking`) — otherwise one
   * would look at a garage's marking through the roof, and the level tab would say something other
   * than the scene.
   */
  focusParking(parkingId: string, animate = true): void {
    const p = this.house?.site.parkings.find((x) => x.id === parkingId)
    const nodes = this.parkingNodes.get(parkingId)
    if (!p || !nodes) return
    const box = new Box3()
    nodes.group.updateWorldMatrix(true, true)
    box.setFromObject(nodes.group)
    // At least the box of a device: a mower base is 60 cm, and framing it as tightly as possible
    // put the camera under the ground. A large space, for its part, keeps its proportional margin.
    box.expandByScalar(Math.max(DEVICE_FOCUS_SIZE_M / 2, Math.max(...p.size) * 0.35))
    const { azimuth, polar } = this.currentSpherical()
    this.flyTo(box, azimuth, clamp(polar, DEVICE_FOCUS_POLAR[0], DEVICE_FOCUS_POLAR[1]), animate, 1.1)
  }

  private grabsParking(id: string, ev: TapEvent): boolean {
    const nodes = this.parkingNodes.get(id)
    if (!nodes || !shownInScene(nodes.group)) return false
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    return this.raycaster.intersectObject(nodes.fill, false).length > 0
  }

  private startParkingDrag(id: string): void {
    const nodes = this.parkingNodes.get(id)
    if (!nodes) return
    if (this.controls) this.controls.enabled = false
    this.cameraTween?.cancel()
    // Horizontal plane AT THE SPACE'S FLOOR, and finger–center offset preserved: a space grabbed by a
    // corner does not jump under the finger at the first press.
    nodes.group.updateWorldMatrix(true, false)
    const foot = nodes.group.getWorldPosition(new Vector3())
    this.dragPlane.setFromNormalAndCoplanarPoint(WORLD_UP, foot)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    this.dragOffset.copy(hit ? hit.sub(foot) : new Vector3())
  }

  /** One position per FRAME, not one per event (same reason as an opening's drag). */
  private moveParkingDrag(id: string, ev: TapEvent): void {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    if (!hit) return
    hit.sub(this.dragOffset)
    this.pendingParkingXY = [hit.x, -hit.z]         // world (x, y, z) ← house (x, z, -y)
    if (this.parkingFrame !== 0) return
    this.parkingFrame = requestAnimationFrame(() => {
      this.parkingFrame = 0
      this.flushParkingDrag(id)
    })
  }

  private flushParkingDrag(id: string): void {
    const xy = this.pendingParkingXY
    this.pendingParkingXY = null
    if (xy) this.emit('parkingDrag', id, xy)
  }

  private endParkingDrag(id: string, moved: boolean): void {
    if (this.controls) this.controls.enabled = true
    if (this.parkingFrame !== 0) { cancelAnimationFrame(this.parkingFrame); this.parkingFrame = 0 }
    this.flushParkingDrag(id)                       // the last position, the one we keep
    if (moved) this.emit('parkingDrop', id)
    this.invalidateShadows()
  }

  /**
   * What the scene writes on the space being adjusted: its NAME above it, and its FOUR
   * dimensions — what separates it from its host's outline in front, behind and on each side. That is how
   * a garage space is placed with a tape measure, and it is what the panel adjusts.
   *
   * The numbers come from `parkingGaps`, shared with the panel: the same space cannot be
   * dimensioned in two ways. The line of each dimension, for its part, is geometry laid in the
   * space's group (`buildParking`): it turns and slides with it, without lag.
   *
   * The labels are KEPT from one frame to the next: redoing them at every finger movement
   * would make the DOM flicker — that is the lesson of the opening dimensions.
   */
  private refreshParkingNotes(): void {
    const id = this.selectedParkingId
    const p = id ? this.house?.site.parkings.find((x) => x.id === id) : undefined
    if (!p || !this.nodes || typeof document === 'undefined') { this.clearParkingNotes(); return }
    const { parent, z } = this.parkingParent(p)
    if (!this.parkingNotes || this.parkingNotes.parent !== parent) {
      this.clearParkingNotes()
      const name = sceneNote('name')
      const sides = { front: sceneNote('gap'), back: sceneNote('gap'), left: sceneNote('gap'), right: sceneNote('gap') }
      parent.add(name, ...Object.values(sides))
      this.parkingNotes = { name, sides, parent }
    }
    const notes = this.parkingNotes
    const gaps = this.parkingGaps(p)
    const a = (p.yaw * Math.PI) / 180
    const fwd: Vec2 = [-Math.sin(a), Math.cos(a)]
    const right: Vec2 = [Math.cos(a), Math.sin(a)]
    const [width, length] = p.size
    notes.name.element.textContent = parkingLabel(p)
    notes.name.position.set(p.center[0], p.center[1], z + PARKING_NOTE_LIFT_M)
    for (const side of PARKING_SIDES) {
      const d = gaps?.[side] ?? null
      const note = notes.sides[side]
      note.element.textContent = d === null ? '—' : `${d.toFixed(2)} m`
      const dir = side === 'front' ? fwd : side === 'back' ? [-fwd[0], -fwd[1]] as Vec2 : side === 'right' ? right : [-right[0], -right[1]] as Vec2
      const start = (side === 'front' || side === 'back' ? length : width) / 2
      const at = start + (d ?? 0) / 2
      note.position.set(p.center[0] + dir[0] * at, p.center[1] + dir[1] * at, z + PARKING_COTE_LIFT_M)
      note.updateWorldMatrix(true, false)
    }
    notes.name.updateWorldMatrix(true, false)
    this.loop.invalidate()
  }

  private clearParkingNotes(): void {
    if (!this.parkingNotes) return
    // a `CSS2DObject` placed its element in the 2D render layer: removing it from the scene does not
    // remove it (same move as for the opening dimensions)
    for (const note of [this.parkingNotes.name, ...Object.values(this.parkingNotes.sides)]) {
      note.element.remove()
      note.removeFromParent()
    }
    this.parkingNotes = null
    this.loop.invalidate()
  }

  /**
   * One handle per opening, in its level's group: a slab that fills the rectangle —
   * it is what is grabbed, and it overhangs the wall thickness to be grabbed from both sides — and
   * a line that rings it. Both UNLIT, in the language of the room highlight.
   *
   * **Three states to read without hesitation**: nothing, an opening, the one being adjusted. It is
   * the THICKNESS of the frame and its relation to depth that separate them, not a nuance of opacity
   * (tried first, unreadable) nor the presence of the frame (tried next: the eighteen other
   * openings became impossible to find).
   *
   *  - at rest: a THIN, calm frame, and above all a TUBE — a ring extruded through the whole thickness
   *    of the handle, which therefore sticks out of both faces of the wall. That is what lets it be subject
   *    to the depth test: the roof and the facades hide it like any object, whereas
   *    a FLAT frame placed at mid-thickness would be buried in the joinery around it;
   *  - selected: a frame twice as THICK, lightened, flat, and drawn over the walls
   *    (`depthTest: false`, like a room's line) — otherwise the facade hides the handle of the
   *    window one is looking at from the bedroom. It is the only one that goes through.
   *
   * Both frames exist permanently on each handle; selection only turns off
   * MATERIALS. Nothing is built or destroyed when selecting.
   *
   * **They live on `DECOR_LAYER`, in their level's MARKERS group**: outside the occlusion
   * capture (a translucent veil is not an obstacle), touchable (the raycaster opens
   * this layer), and hidden with their level.
   */
  private buildOpeningHandles(): void {
    this.clearOpeningHandles()
    if (!this.editingOpenings || !this.nodes || !this.geometry) return
    const accent = this.theme.primary
    const trait = accent.clone().lerp(WHITE, 0.2).multiplyScalar(1.15)
    const mats = {
      // the veil says "there is something here", the frame says "this is an opening": at rest
      // the veil fades behind the frame, which says the same thing more readably
      fill: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08, depthWrite: false, side: DoubleSide }),
      fillOn: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide }),
      ring: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.62, depthWrite: false, side: DoubleSide }),
      ringOn: new MeshBasicMaterial({ color: trait, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: DoubleSide }),
      // What turns off a frame is ITS MATERIAL and not `Object3D.visible`: that property says
      // "my level is hidden" (`shownInScene`), and it is what decides whether a handle is
      // touchable — turning it off here would make the handle unreachable by finger.
      off: new MeshBasicMaterial({ visible: false }),
    }
    this.openingMats = mats
    for (const level of this.geometry.levels) {
      const parent = this.nodes.levels.get(level.levelId)?.markers
      if (!parent) continue
      for (const o of level.openings) {
        const group = new Group()
        group.name = `opening:${o.openingId}`
        const centre = openingCentre(o)
        group.position.set(centre[0], centre[1], centre[2])
        if (o.host === 'wall') {
          group.rotation.z = Math.atan2(o.u[1], o.u[0])
        } else {
          group.rotation.order = 'ZXY'                    // tilt after the heading (see buildPane)
          group.rotation.z = ((o.yaw ?? 0) * Math.PI) / 180
          group.rotation.x = -((o.slope ?? 0) * Math.PI) / 180
        }
        const thick = o.host === 'wall' ? o.depth + 2 * OPENING_HANDLE_PROUD_M : Math.max(0.08, o.depth)
        const fill = new Mesh(
          o.host === 'wall'
            ? new BoxGeometry(o.width, thick, o.height)
            : new BoxGeometry(o.width, o.height, thick),
          mats.fill,
        )
        fill.userData = { role: 'opening', openingId: o.openingId }
        // Frame: for a WALL, built in XY then stood up (local y → the wall's z). For a SURFACE
        // (floor / roof), it STAYS in XY — the plane of the carrier — without `rotateX`, otherwise it stands
        // up vertically (measured on a skylight).
        const rest = extrudeRing(...frameRect(o.width, o.height, OPENING_RING.rest), -thick / 2, thick / 2)
        const bold = flatRing(...frameRect(o.width, o.height, OPENING_RING.on), o.host === 'wall' ? 0 : thick / 2 + 0.002)
        if (o.host === 'wall') {
          rest.rotateX(Math.PI / 2)
          bold.rotateX(Math.PI / 2)
        }
        const ring = new Mesh(rest, mats.ring)
        const ringOn = new Mesh(bold, mats.ringOn)
        group.add(fill, ring, ringOn)
        group.traverse((n) => n.layers.set(DECOR_LAYER))
        parent.add(group)
        // The `Scene` runs with `matrixWorldAutoUpdate = false`: without this call, the world matrix
        // of a new handle stays IDENTITY until the next frame, the raycaster tests it
        // at the world origin, and a tap goes through it to the room's floor (measured: eleven handles
        // out of eleven, up to twelve meters off). `true` for the children: it is the slab, not the
        // group, that the ray hits. Same move as `focusJournalPoint` and `openingFoot`, which read
        // a world position without waiting for a frame.
        group.updateWorldMatrix(true, true)
        this.openingHandles.set(o.openingId, { group, fill, ring, ringOn, rect: o })
      }
    }
    this.styleOpeningHandles()
  }

  /**
   * What the scene writes on the opening being adjusted: its NAME above it, and its two
   * DIMENSIONS on either side — what separates it from each end of its wall. That is how
   * a house is surveyed with a tape measure, and it is what the user looks at while moving it.
   *
   * The numbers come from `openingGaps` and the name from `openingLabel`, both shared with the
   * panel: the same window cannot be named in two ways nor dimensioned in two ways.
   * The format (`toFixed(2)` and "m") is the panel's, to the centimeter.
   *
   * The labels are laid on SELECTION, not at the first finger movement: appearing at the
   * moment the gesture starts would make them pop up under the hand, and they also serve to reread what
   * the panel's fields have just written.
   *
   * Each number is laid on a real DIMENSION LINE, as on a plan: a line that goes from the edge
   * of the opening to the corner of the wall — exactly the interval the number announces, no more no less,
   * otherwise one does not know whether "0.25 m" is measured to the corner or to the jamb — closed at
   * each end by a vertical tick. It is scene GEOMETRY and not a drawing in the DOM
   * layer: the drawing lives in the level's frame, so it follows the sliding opening without
   * lag, and it hides with its level.
   *
   * It lives with the level's MARKERS, on `DECOR_LAYER` — that is what makes it drawn after the
   * walls (see `buildOpeningHandles`: placed elsewhere, the wall covered it), and it is also a group
   * that SURVIVES the rebuild of a level, like the labels.
   *
   * **The hard case is the short dimension.** The number is DOM, 66 px wide whatever the
   * distance; the interval, for its part, is in meters. No threshold in meters can therefore decide "the
   * number is wider than its dimension". For this reason it is laid ABOVE the line and not
   * on it: it never cuts it, at any scale, and stays in the middle of its interval hence
   * attached to it. At zero, there is no interval: the line disappears and the two ticks
   * merge into one — which is exactly what there is to read, the opening touches the corner.
   */
  private refreshOpeningNotes(): void {
    const id = this.selectedOpeningId
    const rect = id && this.editingOpenings ? this.openingRect(id) : undefined
    const room = rect ? this.house?.rooms.find((r) => r.id === rect.roomId) : undefined
    const opening = room?.openings.find((o) => o.id === id)
    const level = rect ? this.nodes?.levels.get(rect.levelId) : undefined
    if (!rect || !room || !opening || !level || typeof document === 'undefined') { this.clearOpeningNotes(); return }
    const host = rect.host === 'wall' ? 'wall' : 'surface'
    const gapCount = host === 'wall' ? 2 : 4
    if (
      !this.openingNotes
      || this.openingNotes.parent !== level.labels
      || this.openingNotes.cotes.parent !== level.markers
      || this.openingNotes.host !== host
    ) {
      this.clearOpeningNotes()
      const name = sceneNote('name')
      const gaps = Array.from({ length: gapCount }, () => sceneNote('gap'))
      level.labels.add(name, ...gaps)
      const mat = new MeshBasicMaterial({
        color: this.theme.primary.clone().lerp(WHITE, 0.2).multiplyScalar(1.15),
        transparent: true, opacity: 0.9, depthWrite: false, depthTest: false,
      })
      const cotes = new Group()
      cotes.name = 'opening-cotes'
      const lines = Array.from({ length: gapCount }, () => {
        const line = new Mesh(new BoxGeometry(1, COTE.bar, COTE.bar), mat)
        const a = new Mesh(new BoxGeometry(COTE.bar, COTE.bar, COTE.tick), mat)
        const b = new Mesh(new BoxGeometry(COTE.bar, COTE.bar, COTE.tick), mat)
        cotes.add(line, a, b)
        return { line, a, b }
      })
      cotes.traverse((n) => n.layers.set(DECOR_LAYER))
      level.markers.add(cotes)
      this.openingNotes = { name, gaps, parent: level.labels, cotes, lines, host }
    }
    const notes = this.openingNotes
    notes.name.element.textContent = openingLabel(opening)

    if (host === 'wall') {
      const gaps = openingGaps(room, opening)
      const at = (t: number, z: number): [number, number, number] => [
        rect.origin[0] + rect.u[0] * t + (rect.normal[0] * rect.depth) / 2,
        rect.origin[1] + rect.u[1] * t + (rect.normal[1] * rect.depth) / 2,
        z,
      ]
      const mid = rect.origin[2] + rect.height / 2
      notes.name.position.set(...at(rect.width / 2, rect.origin[2] + rect.height + OPENING_NOTE_LIFT_M))
      const [rightNote, leftNote] = notes.gaps
      rightNote!.element.textContent = `${gaps.right.toFixed(2)} m`
      rightNote!.position.set(...at(-gaps.right / 2, mid + COTE.lift))
      leftNote!.element.textContent = `${gaps.left.toFixed(2)} m`
      leftNote!.position.set(...at(rect.width + gaps.left / 2, mid + COTE.lift))
      notes.cotes.position.set(...at(0, 0))
      notes.cotes.rotation.set(0, 0, Math.atan2(rect.u[1], rect.u[0]))
      const spans: [number, number][] = [[-gaps.right, 0], [rect.width, rect.width + gaps.left]]
      notes.lines.forEach((part, i) => {
        const [x0, x1] = spans[i]!
        const length = x1 - x0
        part.line.visible = length > 1e-3
        part.line.scale.set(Math.max(length, 1e-4), 1, 1)
        part.line.rotation.set(0, 0, 0)
        part.line.position.set((x0 + x1) / 2, 0, mid)
        part.a.rotation.set(0, 0, 0)
        part.b.rotation.set(0, 0, 0)
        part.a.position.set(x0, 0, mid)
        part.b.position.set(x1, 0, mid)
      })
    } else {
      // Surface: four dimensions in the plane (like a space), a line along each interval.
      // the footprint seen from the sky (heading and length of the geometric rectangle): the lines start from the edge of the
      // hole of a Velux, not from its length along the slope
      const yaw = rect.yaw ?? opening.yaw ?? 0
      const h = planLength(opening.height, rect.slope)
      const gaps = surfaceGaps(room, { ...opening, yaw, height: h })
      const { fwd, right } = surfaceAxes(yaw)
      const cx = opening.x ?? 0, cy = opening.y ?? 0
      const w = opening.width
      const z = rect.origin[2] + rect.depth / 2
      notes.name.position.set(cx, cy, z + OPENING_NOTE_LIFT_M)
      notes.cotes.position.set(cx, cy, z)
      notes.cotes.rotation.set(0, 0, 0)
      const dirs: { side: ParkingSide; dir: Vec2; half: number }[] = [
        { side: 'front', dir: fwd, half: h / 2 },
        { side: 'back', dir: [-fwd[0], -fwd[1]], half: h / 2 },
        { side: 'right', dir: right, half: w / 2 },
        { side: 'left', dir: [-right[0], -right[1]], half: w / 2 },
      ]
      dirs.forEach(({ side, dir, half }, i) => {
        const d = gaps[side]
        const note = notes.gaps[i]!
        note.element.textContent = d === null ? '—' : `${d.toFixed(2)} m`
        const span = d ?? 0
        const mid = half + span / 2
        note.position.set(cx + dir[0] * mid, cy + dir[1] * mid, z + COTE.lift)
        const part = notes.lines[i]!
        const length = span
        part.line.visible = length > 1e-3
        part.line.scale.set(Math.max(length, 1e-4), 1, 1)
        const ang = Math.atan2(dir[1], dir[0])
        part.line.rotation.set(0, 0, ang)
        part.a.rotation.set(0, 0, ang)
        part.b.rotation.set(0, 0, ang)
        // frame of the dimensions group = center of the opening: edge at `half` along dir, end at half+span
        const x0 = dir[0] * half, y0 = dir[1] * half
        const x1 = dir[0] * (half + span), y1 = dir[1] * (half + span)
        part.line.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0)
        part.a.position.set(x0, y0, 0)
        part.b.position.set(x1, y1, 0)
      })
    }
    for (const note of [notes.name, ...notes.gaps]) note.updateWorldMatrix(true, false)
    notes.cotes.updateWorldMatrix(true, true)
    this.loop.invalidate()
  }

  private clearOpeningNotes(): void {
    if (!this.openingNotes) return
    disposeObject3D(this.openingNotes.cotes)
    for (const note of [this.openingNotes.name, ...this.openingNotes.gaps]) {
      note.element.remove()
      note.removeFromParent()
    }
    this.openingNotes = null
    this.loop.invalidate()
  }

  /**
   * The file's ORIGIN marker, in edit mode only: the local (0, 0, 0) from which
   * all the coordinates of `house.json` are measured — room polygons, device positions,
   * opening `offset`. It is what `house.origin` anchors on the globe.
   *
   * A point alone would not say in which DIRECTION one counts: it therefore carries its two axes, +x and +y,
   * told apart by their length and by a label, plus a shorter arrow toward TRUE NORTH
   * — `heading` is the heading of +y, so north is at (−sin h, cos h) in the local frame. It is what
   * makes it possible to match a survey with the terrain.
   *
   * Everything is drawn ON TOP OF the house (`depthTest: false`): the origin can fall inside a wall,
   * under a slab or far from the building, and a marker one cannot see marks nothing. It is neither
   * touchable (no `role` in `userData`, never presented to `pick`) nor movable: the file's
   * origin is not a setting.
   *
   * It is placed in the markers of the level that carries the file's z = 0, and on `DECOR_LAYER`,
   * like the handles.
   */
  private buildOriginMark(): void {
    this.clearOriginMark()
    if (!this.editingOpenings || !this.nodes || !this.house) return
    const accent = this.theme.primary
    const trait = accent.clone().lerp(WHITE, 0.2).multiplyScalar(1.15)
    const group = new Group()
    group.name = 'origin-mark'
    const mat = (color: Color, opacity: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: DoubleSide })
    // The ring laid flat on the file's (0, 0): it is THE marker, the axes only say
    // in which direction one counts. `RingGeometry` is in the XY plane, which is the FLOOR in local Z-up —
    // like the ring of the move guide (`DeviceMarker.setMoving`).
    const disc = new Mesh(new RingGeometry(ORIGIN_MARK.ring - ORIGIN_MARK.bar, ORIGIN_MARK.ring, 36), mat(trait, 0.95))
    group.add(disc)
    const labels: CSS2DObject[] = []
    const arm = (dir: readonly [number, number], length: number, color: Color, opacity: number, text: string) => {
      const box = new Mesh(new BoxGeometry(length, ORIGIN_MARK.bar, ORIGIN_MARK.bar), mat(color, opacity))
      box.rotation.z = Math.atan2(dir[1], dir[0])
      box.position.set((dir[0] * length) / 2, (dir[1] * length) / 2, 0)
      group.add(box)
      if (typeof document === 'undefined') return
      const label = sceneNote('axis')
      label.element.textContent = text
      label.position.set(dir[0] * (length + ORIGIN_MARK.ring), dir[1] * (length + ORIGIN_MARK.ring), 0)
      group.add(label)
      labels.push(label)
    }
    arm([1, 0], ORIGIN_MARK.axis, trait, 0.95, 'x')
    arm([0, 1], ORIGIN_MARK.axis, trait, 0.95, 'y')
    // North is shorter and paler than the file's axes: it is information about the
    // terrain, not a direction in which anything is counted.
    const h = (this.house.origin.heading * Math.PI) / 180
    arm([-Math.sin(h), Math.cos(h)], ORIGIN_MARK.north, WHITE, 0.55, 'N')
    group.traverse((n) => n.layers.set(DECOR_LAYER))
    // the level whose floor is closest to the file's z = 0; the marker repositions itself in that level's own
    // frame (a level is placed at its elevation) to land exactly on the origin
    const host = [...this.nodes.levels.entries()]
      .sort((a, b) => Math.abs(a[1].elevation) - Math.abs(b[1].elevation))[0]
    if (!host) return
    group.position.z = -host[1].elevation
    host[1].markers.add(group)
    group.updateWorldMatrix(true, true)     // same stale-matrix pitfall as the handles
    this.originMark = { group, labels }
    this.loop.invalidate()
  }

  private clearOriginMark(): void {
    if (!this.originMark) return
    // the axis labels are DOM elements laid by the 2D renderer: the group goes away, they do not
    for (const l of this.originMark.labels) l.element.remove()
    disposeObject3D(this.originMark.group)
    this.originMark = null
  }

  private clearOpeningHandles(): void {
    const keep = new Set<Material>(this.openingMats ? Object.values(this.openingMats) : [])
    for (const h of this.openingHandles.values()) disposeObject3D(h.group, keep)
    this.openingHandles.clear()
    for (const m of keep) m.dispose()
    this.openingMats = null
  }

  private styleOpeningHandles(): void {
    const mats = this.openingMats
    if (!mats) return
    for (const [id, h] of this.openingHandles) {
      const on = id === this.selectedOpeningId
      h.fill.material = on ? mats.fillOn : mats.fill
      h.ring.material = on ? mats.off : mats.ring          // the thin frame fades under the thick one
      h.ringOn.material = on ? mats.ringOn : mats.off
    }
  }

  /** Is the handle under the finger? Hidden with its level, it cannot be grabbed. */
  private grabsOpening(id: string, ev: TapEvent): boolean {
    const handle = this.openingHandles.get(id)
    if (!handle || !shownInScene(handle.group)) return false
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    return this.raycaster.intersectObject(handle.fill, false).length > 0
  }

  private startOpeningDrag(id: string): void {
    const handle = this.openingHandles.get(id)
    if (!handle) return
    if (this.controls) this.controls.enabled = false
    this.cameraTween?.cancel()
    // HORIZONTAL plane at the level's floor: what is reported is the finger's point on that floor, and it is up
    // to the caller to look there for the nearest admissible place. The initial finger–opening offset
    // is preserved (as for a device): without it, the opening would jump at the first press, the
    // handle being at sill height and the plane at its feet. The two drags share plane and
    // offset: a device and an opening are never moved at the same time.
    const foot = this.openingFoot(handle.group, handle.rect.levelId)
    this.dragPlane.setFromNormalAndCoplanarPoint(WORLD_UP, foot)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    this.dragOffset.copy(hit ? hit.sub(foot) : new Vector3())
  }

  /**
   * ONE position per frame, not one per event. The pointer emits several per frame, and
   * each one rebuilds a level's walls: all that work ended up in the trash before
   * being seen. We keep the last position and report it on the next frame.
   */
  private moveOpeningDrag(id: string, ev: TapEvent): void {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    if (!hit) return
    hit.sub(this.dragOffset)
    this.pendingOpeningXY = [hit.x, -hit.z]         // world (x, y, z) ← house (x, z, -y)
    if (this.openingFrame !== 0) return
    this.openingFrame = requestAnimationFrame(() => {
      this.openingFrame = 0
      this.flushOpeningDrag(id)
    })
  }

  private flushOpeningDrag(id: string): void {
    const xy = this.pendingOpeningXY
    this.pendingOpeningXY = null
    if (xy) this.emit('openingDrag', id, xy)
  }

  private endOpeningDrag(id: string, moved: boolean): void {
    if (this.controls) this.controls.enabled = true
    if (this.openingFrame !== 0) { cancelAnimationFrame(this.openingFrame); this.openingFrame = 0 }
    this.flushOpeningDrag(id)                       // the last position, the one we keep
    if (moved) this.emit('openingDrop', id)
    this.invalidateShadows()                        // the gesture is over: the shadows take over again
  }

  /** The foot of the opening in the world: its horizontal middle, brought down to its level's floor. */
  private openingFoot(group: Group, levelId: string): Vector3 {
    group.updateWorldMatrix(true, false)
    const p = group.getWorldPosition(new Vector3())
    p.y = this.nodes?.levels.get(levelId)?.elevation ?? 0
    return p
  }

  /**
   * Tint of a car body SHOWN while it is being chosen (preview): nothing is written, and the
   * house takes over again as soon as the choice is confirmed. `null` restores the previous tint.
   */
  previewBodyColor(key: string, color: string | null): void {
    this.markers.get(key)?.previewColor(color)
  }

  /**
   * Lays the INCIDENTS of a device's log on the terrain: one pin per point (thin stem,
   * head tinted by severity, larger for a serious error), projected like the device
   * itself (`sitePosition`, with its `gpsOffset`) — a point outside the terrain is not drawn.
   * `null` removes everything. That is how a fault is LOCATED: "No loop signal" has a place.
   */
  setJournalPoints(key: string | null, points: readonly { at: number; lat: number; lon: number; severity: string; label?: string }[]): void {
    if (this.journal) {
      // the labels are DOM elements the 2D renderer laid: removing the group from the scene
      // does not remove them, they would stay in the void (observed) — same move as `DeviceMarker.dispose`
      for (const p of this.journal.points) p.label?.element.remove()
      this.journal.group.removeFromParent()
      disposeObject3D(this.journal.group)
      this.journal = null
    }
    if (!key || !this.house || !this.index || !this.nodes || points.length === 0) { this.loop.invalidate(); return }
    const device = this.house.devices.find((d) => d.id === key || d.deviceId === key)
    const group = new Group()
    group.name = `journal:${key}`
    const anchors: { at: number; anchor: Object3D; head: Mesh; label: CSS2DObject | null }[] = []
    const pickables: Object3D[] = []
    const stem = new CylinderGeometry(0.025, 0.025, 0.7, 8)
    stem.rotateX(Math.PI / 2)                      // the cylinder axis is Y in Three, the stem rises along Z
    const head = new SphereGeometry(0.16, 16, 12)
    const bigHead = new SphereGeometry(0.22, 16, 12)
    const stemMat = new MeshBasicMaterial({ color: 0xf2f3f5 })
    for (const p of points) {
      const xyz = sitePosition(this.house, p, device?.gpsOffset)
      if (!xyz) continue
      const pin = new Group()
      pin.position.set(xyz[0], xyz[1], this.groundZ(xyz[0], xyz[1]))
      const rod = new Mesh(stem, stemMat)
      rod.position.z = 0.35
      const top = new Mesh(p.severity === 'fatal' ? bigHead : head, new MeshBasicMaterial({ color: JOURNAL_PIN_COLORS[p.severity] ?? JOURNAL_PIN_COLORS.info }))
      top.position.z = 0.7
      // the head is touchable: it is through it that the incident is read from the scene
      top.userData = { role: 'journal', at: p.at }
      pickables.push(top)
      pin.add(rod, top)
      // the label (vendor text and code) only appears on the ACTIVE pin: nineteen
      // open labels would cover one another
      let label: CSS2DObject | null = null
      if (typeof document !== 'undefined') {
        const el = document.createElement('div')
        el.className = 'journal-pin'
        el.textContent = p.label ?? ''
        label = new CSS2DObject(el)
        label.position.z = 1.0
        label.visible = false
        pin.add(label)
      }
      group.add(pin)
      anchors.push({ at: p.at, anchor: pin, head: top, label })
    }
    this.nodes.outdoorMarkers.add(group)
    this.journal = { group, points: anchors, pickables, active: null }
    this.loop.invalidate()
  }

  /**
   * Paints shapes on the terrain (house reference frame, meters): a mower's terrain map —
   * zones, obstacles, wires —, which hugs the relief. Empty list = nothing. Kept, they repaint
   * themselves when the terrain changes.
   */
  setGroundOverlay(shapes: readonly GroundShape[]): void {
    this.groundShapes = shapes
    this.buildGroundOverlay()
  }

  private buildGroundOverlay(): void {
    if (this.groundOverlay) {
      this.groundOverlay.removeFromParent()
      disposeObject3D(this.groundOverlay)
      this.groundOverlay = null
    }
    if (this.nodes && this.geometry && this.groundShapes.length) {
      this.groundOverlay = buildGroundOverlay(this.groundShapes, this.geometry.terrain)
      this.nodes.site.add(this.groundOverlay)
    }
    this.loop.invalidate()
  }

  /**
   * The ACTIVE pin: that of the row selected in the panel, or the one just touched.
   * Enlarged head, visible label; `null` turns everything off. That is how the incident is read from the
   * scene without having to find its row.
   */
  setActiveJournalPoint(at: number | null): void {
    if (!this.journal) return
    this.journal.active = at
    for (const p of this.journal.points) {
      const active = p.at === at
      p.head.scale.setScalar(active ? 1.6 : 1)
      if (p.label) p.label.visible = active
    }
    this.loop.invalidate()
  }

  /** Frames the camera on a log incident (same 3 m box as on a device). */
  focusJournalPoint(at: number, animate = true): void {
    const hit = this.journal?.points.find((p) => p.at === at)
    if (!hit) return
    this.setActiveJournalPoint(at)
    hit.anchor.updateWorldMatrix(true, false)
    const center = new Vector3()
    hit.anchor.getWorldPosition(center)
    const size = new Vector3(DEVICE_FOCUS_SIZE_M, DEVICE_FOCUS_SIZE_M, DEVICE_FOCUS_SIZE_M)
    const { azimuth, polar } = this.currentSpherical()
    this.flyTo(new Box3().setFromCenterAndSize(center, size), azimuth, clamp(polar, DEVICE_FOCUS_POLAR[0], DEVICE_FOCUS_POLAR[1]), animate, 1.1)
  }

  /** Moves a marker (preview); `position` in the house reference frame (z relative to the anchor's floor). */
  moveMarker(key: string, position: Vec3): void {
    const marker = this.markers.get(key)
    if (!marker || !this.house || !this.index) return
    marker.object.position.set(position[0], position[1], this.localZ(marker.device, position[2], position))
    marker.setGuideHeight(position[2])
    this.invalidateShadows()               // the moved device takes its shadow along
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
    // horizontal plane at the device's height: it follows the finger exactly, without an initial jump
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
    const xy: [number, number] = [hit.x, -hit.z]   // world (x, y, z) ← house (x, z, -y)
    const roomId = this.roomAt(marker.device, xy)
    this.lastDrag = { xy, roomId }
    this.emit('deviceDrag', key, xy, roomId)
  }

  private endDrag(key: string, moved: boolean): void {
    if (this.controls) this.controls.enabled = true
    if (moved && this.lastDrag) this.emit('deviceDrop', key, this.lastDrag.xy, this.lastDrag.roomId)
    this.lastDrag = null
  }

  /** Room of the device's level containing the point, otherwise null (outdoors, outside any room). */
  private roomAt(device: HouseDevice, xy: [number, number]): string | null {
    if (!this.index) return null
    const levelId = this.markerLevelId(device)
    if (!levelId) return null
    return (this.index.roomsByLevel.get(levelId) ?? []).find((r) => pointInPolygon(xy, r.polygon))?.id ?? null
  }

  private isAtHome(state: DeviceState): boolean {
    if (state.kind !== 'vehicle' || !state.location || !this.house) return true
    return geoDistance(this.house.origin, state.location) < HOME_RADIUS_M
  }

  // ---- states -------------------------------------------------------------
  /**
   * Diff by reference: only the devices whose state object changed are updated — or whose
   * SOUND changed: a soundbar relays the TV's state (`lib/audioRouting.ts`), so it moves
   * when it is the TV that changes.
   */
  updateStates(states: Record<string, DeviceState>, force = false): void {
    const prev = this.states
    this.states = states
    // A vehicle that moved changes PLACE, not just state: its marker may
    // not exist yet (it just came home) or no longer have a reason to (it left). Rare —
    // one reading every ten minutes — so redoing the markers costs less than
    // maintaining a special case in the state loop.
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
      const fanId = marker.linkedFanDeviceId
      const fanNext = fanId ? states[fanId] : undefined
      const fanChanged = !!fanId && fanNext !== prev[fanId]
      if (force || next !== prev[id] || !marker.currentState || soundChanged || fanChanged) {
        marker.update(next, sound)
        if (fanId) marker.setCompanionFan(fanNext)
        touched = true
        // Only these three MOVE something that casts a shadow (a curtain, a car) or
        // light one (a garden lamp). A sensor that publishes its measurement every second
        // must not restart a shadow capture.
        if (next && (next.kind === 'cover' || next.kind === 'vehicle' || next.kind === 'light')) this.invalidateShadows()
      }
    }
    if (touched) this.syncWindowGlow()
  }

  // ---- focus / camera -----------------------------------------------------
  setOptions(opts: Partial<HouseSceneOptions>): void {
    this.invalidateShadows()
    const before = this.options.quality
    const projectionBefore = this.options.projection
    this.options = { ...this.options, ...opts }
    if (this.renderer) this.renderer.shadowMap.enabled = this.options.shadows
    if (this.options.quality !== before) { this.autoQuality = null; this.applyQuality() }   // an explicit choice starts from detection again
    if (this.options.projection !== projectionBefore) this.applyProjectionMode()
    this.applyLevelFocus()
    this.loop.invalidate()
  }

  /**
   * Changes projection. The pose does NOT move: it is the frustum that changes. The orthographic zoom
   * is chosen to show the same world height at the aimed point, and going back to perspective
   * finds again the distance that showed that height — otherwise the house would jump by a factor of ten at the
   * moment the box is ticked.
   */
  private applyProjectionMode(): void {
    const mode = this.options.projection
    const target = this.controls?.target ?? new Vector3()
    // the world height shown at the aimed point, read BEFORE any change: it is what holds
    const height = this.camera instanceof OrthographicCamera
      ? ORTHO_BASE_M / this.camera.zoom
      : visibleHeight(this.camera.position.distanceTo(target), this.perspectiveCamera.fov)
    // the isometric view is a NARROW-field perspective; the orthographic relates to the base field
    this.perspectiveCamera.fov = mode === 'iso' ? ISO_FOV_DEG : BASE_FOV_DEG
    this.applyControlLimits()
    if (mode === 'ortho') {
      const ortho = (this.orthoCamera ??= new OrthographicCamera(-1, 1, 1, -1, 0.1, 500))
      ortho.zoom = ORTHO_BASE_M / height
      this.swapCamera(ortho)
    } else {
      const lo = this.controls?.minDistance ?? 1, hi = this.controls?.maxDistance ?? Infinity
      const distance = clamp(distanceForHeight(height, this.perspectiveCamera.fov), lo, hi)
      this.swapCamera(this.perspectiveCamera)
      this.applyProjection()                 // the field may have changed without changing camera
      const { azimuth, polar } = this.currentSpherical()
      this.camera.position.copy(this.poseAt(azimuth, polar, distance).position)
    }
    // the isometric view is not content with a frustum: it imposes its angles, and the view complies
    if (mode === 'iso') {
      const { azimuth, distance } = this.currentSpherical()
      this.moveCamera(this.poseAt(snapIsoAzimuth(azimuth, DEFAULT_AZIMUTH), ISO_POLAR, distance), true)
    }
    this.controls?.update()
  }

  /** Swaps the active camera, handing it pose, layers and framing; the image chain follows it. */
  private swapCamera(next: PerspectiveCamera | OrthographicCamera): void {
    const from = this.camera
    if (next === from) return
    next.position.copy(from.position)
    next.quaternion.copy(from.quaternion)
    next.layers.mask = from.layers.mask
    this.camera = next
    if (this.controls) this.controls.object = next
    this.applyProjection()
    // the ambient occlusion holds a reference to the camera: the chain is redone with the new one
    this.applyQuality()
  }

  /**
   * What the controls allow, depending on the projection. In orthographic the wheel no longer changes
   * the distance but the ZOOM: the bounds of one translate into the other. In isometric, free
   * rotation is cut — finger and left button pan the view, and the view buttons
   * rotate by quarter turns (`orbitBy`).
   */
  private applyControlLimits(): void {
    const c = this.controls
    if (!c) return
    const fov = this.perspectiveCamera.fov
    // the narrow field of the isometric view moves the camera back accordingly: the wheel bounds follow
    const k = Math.tan((BASE_FOV_DEG * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360)
    c.minDistance = MIN_DISTANCE_M * k
    c.maxDistance = MAX_DISTANCE_M * k
    c.minZoom = ORTHO_BASE_M / visibleHeight(c.maxDistance, fov)
    c.maxZoom = ORTHO_BASE_M / visibleHeight(c.minDistance, fov)
    const iso = this.options.projection === 'iso'
    c.enableRotate = !iso
    c.minPolarAngle = iso ? ISO_POLAR : 0
    c.maxPolarAngle = iso ? ISO_POLAR : Math.PI / 2 - 0.08
    c.touches = { ONE: iso ? TOUCH.PAN : TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }
    c.mouseButtons = { LEFT: iso ? MOUSE.PAN : MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
  }

  focusLevel(levelId: string | null): void {
    this.focusedLevelId = levelId
    this.applyLevelFocus()
    // a hidden level no longer casts a shadow (and a level shown again casts one again): without a recapture,
    // the hidden upper floor kept darkening the one being looked at
    this.invalidateShadows()
    this.loop.invalidate()
  }

  private applyLevelFocus(): void {
    if (!this.nodes || !this.house) return
    const focused = this.focusedLevelId ? this.house.levels.find((l) => l.id === this.focusedLevelId) : null
    const pills: [DeviceMarker, boolean][] = []
    for (const [id, nodes] of this.nodes.levels) {
      const level = this.house.levels.find((l) => l.id === id)!
      const above = !!focused && level.elevation > focused.elevation
      const ghost = above && this.options.levelFocusMode === 'ghost'
      this.liftTo(`level:${id}`, () => this.nodes?.levels.get(id)?.group, level.elevation, !above || ghost, this.topBelow(level.elevation))
      // …and with them the opening handles and the dimensions. An upper floor that FLIES OFF keeps its own
      // during the flight (its pills rise and fade with it): it is its group, hidden on
      // arrival, that removes them. The ghost, for its part, stays in place without its markers.
      nodes.markers.visible = !ghost
      for (const mesh of [...nodes.walls, ...nodes.floors.values(), ...nodes.panes]) {
        mesh.material = ghost ? this.materials.ghost : (mesh.userData.material as Material)
      }
      // pills: only the focused level (readability); the selected device stays visible
      for (const m of this.markers.values()) if (m.object.parent === nodes.markers) pills.push([m, focused?.id === id])
    }
    this.fadePills(pills)
    // the roof shows in the overview and from the level it carries (the roof declared as a
    // level, for its panels); from an upper floor, it would hide the rooms
    if (this.nodes.roof) this.liftTo('roof', () => this.nodes?.roof ?? undefined, 0, !focused || this.isRoofLevel(focused), this.topBelow(this.geometry?.roof?.zBase ?? 0))
    // garden: pills visible — except a GPS stuck UNDER the focused floor (same XY as a
    // room of that floor, lower). A car without a space thus ended up poking through the upper floor.
    for (const m of this.markers.values()) {
      if (m.object.parent !== this.nodes.outdoorMarkers) continue
      m.setPillVisible(!focused || !this.coveredByFocusedFloor(m))
    }
    this.padLamps()
  }

  /**
   * Shows or hides an upper floor (or the roof) by making it FLY OFF: it rises while accelerating then
   * disappears; it comes back down and lands on returning. A displacement, and not a TRANSPARENT fade:
   * no material becomes transparent, no program changes. `get` rereads the object every frame — a
   * level rebuilt mid-flight (adjusting an opening) resumes the travel where it is.
   * Without a renderer (tests), the switch is immediate, as before.
   *
   * It fades out at the same time as it rises (`core/levelFade.ts`): everything above
   * `fadeCutY` — the top of the level that stays — loses pixels as the upper floor rises.
   */
  private liftTo(key: string, get: () => Object3D | undefined, baseZ: number, shown: boolean, fadeCutY: number): void {
    let s = this.lifts.get(key)
    if (!s) { s = { offset: shown ? 0 : LEVEL_LIFT_M, shown, tween: null }; this.lifts.set(key, s) }
    const state = s
    const apply = () => {
      const o = get()
      if (!o) return
      o.position.z = baseZ + state.offset
      o.visible = state.shown || state.tween !== null
    }
    if (state.shown === shown) { if (!state.tween) apply(); return }
    state.shown = shown
    state.tween?.cancel()
    state.tween = null
    const to = shown ? 0 : LEVEL_LIFT_M
    if (!this.renderer) { state.offset = to; apply(); return }
    const from = state.offset
    // the shadow map follows the upper floor during the whole flight, and is redone once it has landed
    this.invalidateShadows(LEVEL_LIFT_MS + SHADOW_SETTLE_MS)
    // several upper floors leave together (ground floor from "All"): the lowest threshold
    this.fadeCutY = Math.min(this.fadeCutY, fadeCutY)
    const tw = createTween({
      durationMs: LEVEL_LIFT_MS, now: this.deps.now?.() ?? performance.now(),
      easing: shown ? easeOutCubic : easeInCubic,
      onUpdate: (k) => {
        state.offset = from + (to - from) * k
        setLevelFade(this.fadeCutY, 1 - state.offset / LEVEL_LIFT_M)
        apply()
      },
      onDone: () => {
        state.tween = null
        apply()
        this.padLamps()
        this.invalidateShadows()             // the upper floor has just been hidden (or landed): its shadow follows
        // nothing in flight anymore: the fade lifts, the image becomes the one from before again, pixel for pixel
        if ([...this.lifts.values()].every((l) => !l.tween)) { this.fadeCutY = Infinity; setLevelFade(1e9, 1) }
      },
    })
    state.tween = tw
    apply()
    this.loop.addTween(tw)
  }

  /**
   * Shows or hides the levels' pills WITH A FADE, in step with the upper floors' flight: those that
   * appear start from 0, those that leave fade (and rise with their upper floor) then are
   * hidden. Previously they switched all at once — the ground floor pills popped up
   * while the upper floor, still there, flew off without its own. A new pill (markers redone)
   * is set without a fade: it has never been seen.
   */
  private fadePills(wanted: readonly [DeviceMarker, boolean][]): void {
    const changes: [DeviceMarker, boolean][] = []
    for (const [m, want] of wanted) {
      const was = this.pillTargets.get(m)
      this.pillTargets.set(m, want)
      if (was === undefined || !this.renderer) { m.setPillFade(1); m.setPillVisible(want); continue }
      if (was !== want) changes.push([m, want])
    }
    if (changes.length === 0) return
    // a fade in progress ends at once: its pills take their final state
    this.finishPillFade()
    for (const [m, want] of changes) if (want) { m.setPillFade(0); m.setPillVisible(true) }
    this.pillFading = changes
    // a single travel, in time: the exit ends with the flight, the entry starts after a delay
    const total = Math.max(LEVEL_LIFT_MS, PILL_IN_DELAY_MS + PILL_IN_MS)
    const phase = (ms: number, from: number, len: number) => easeInOutCubic(Math.min(1, Math.max(0, (ms - from) / len)))
    const tw = createTween({
      durationMs: total, now: this.deps.now?.() ?? performance.now(), easing: linear,
      onUpdate: (t) => {
        const ms = t * total
        const out = 1 - phase(ms, 0, LEVEL_LIFT_MS), into = phase(ms, PILL_IN_DELAY_MS, PILL_IN_MS)
        for (const [m, want] of changes) m.setPillFade(want ? into : out)
      },
      onDone: () => this.finishPillFade(),
    })
    this.pillTween = tw
    this.loop.addTween(tw)
  }

  private finishPillFade(): void {
    this.pillTween?.cancel()
    this.pillTween = null
    for (const [m, want] of this.pillFading) { m.setPillFade(1); if (!want) m.setPillVisible(false) }
    this.pillFading = []
  }

  /** The top (house z, hence world height) of the highest level placed below `z`: where the upper floor flying off begins. */
  private topBelow(z: number): number {
    let top = -Infinity
    for (const l of this.nodes?.levels.values() ?? []) if (l.elevation < z - 1e-3) top = Math.max(top, l.elevation + l.height)
    // the threshold passes JUST above the top of its walls: placed right on it, it flipped
    // each pixel of those faces to one side or the other — a grain that flickered during the flight
    return (Number.isFinite(top) ? Math.min(top, z) : z) + LEVEL_FADE_MARGIN_M
  }

  /**
   * Keeps the number of point lights the render sees CONSTANT. Three compiles one program
   * per number of lights: hiding the upper floor removed its lamps, and the first visit to the
   * ground floor recompiled every material — 2.2 s of frozen frame on the iGPU (measured on
   * 2026-09-24). A lamp that is off, placed outside any level, takes the place of each hidden
   * lamp; the shader computes nothing for it (`core/levelLight.ts`).
   */
  private padLamps(): void {
    if (!this.nodes) return
    let all = 0, shown = 0
    for (const n of this.nodes.levels.values()) {
      n.markers.traverse((o) => { if ((o as PointLight).isPointLight) all++ })
      if (n.group.visible && n.markers.visible) n.markers.traverseVisible((o) => { if ((o as PointLight).isPointLight) shown++ })
    }
    const pad = this.lampPadding
    while (pad.children.length < all - shown) pad.add(new PointLight(0, 0))
    while (pad.children.length > all - shown) pad.remove(pad.children[pad.children.length - 1]!)
  }

  /**
   * Outdoor marker hidden by the floor of the upper level being looked at: lower than that level,
   * and its XY falls inside a room of that level (garage under a bedroom, etc.).
   */
  private coveredByFocusedFloor(m: DeviceMarker): boolean {
    if (!this.focusedLevelId || !this.house || !this.index) return false
    const focused = this.house.levels.find((l) => l.id === this.focusedLevelId)
    if (!focused) return false
    // absolute Z-up altitude: sum of the local z values up to the house root
    let absZ = 0
    for (let o: Object3D | null = m.object; o && o !== this.nodes!.root; o = o.parent) absZ += o.position.z
    if (absZ >= focused.elevation - 0.05) return false
    const rooms = this.index.roomsByLevel.get(focused.id) ?? []
    const xy: Vec2 = [m.object.position.x, m.object.position.y]
    return rooms.some((r) => pointInPolygon(xy, r.polygon))
  }

  /** The Three nodes of a level (tests, diagnostics). */
  nodesOf(levelId: string): LevelNodes | undefined { return this.nodes?.levels.get(levelId) }

  /** Level placed at the roof's height or above: the roof belongs to it, it does not hide it. */
  private isRoofLevel(level: Level): boolean {
    const roof = this.geometry?.roof
    return !!roof && level.elevation >= roof.zBase - 1e-3
  }

  /** The level the roof carries, if it is declared (for its panels, its camera…). */
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
   * Frames the device itself (and not its room): a fixed box around its anchor, hence the same
   * distance whatever the size of the room. `controls.minDistance` bounds the close-up.
   *
   * Steeper tilt than for a room (`DEVICE_FOCUS_POLAR`): up close, an exterior wall less than
   * two meters away passes in front of the device below 30° above the horizon. The azimuth, for its part,
   * is chosen (`roomSideAzimuth`) and not preserved.
   */
  focusDevice(key: string, animate = true): void {
    if (!this.house || !this.index) return
    const found = this.drawable().find((d) => d.id === key)
    const marker = this.markers.get(key)
    // a marker exists: the device therefore has a place (`buildMarkers` makes none for the others)
    const position = found ? this.effectivePosition(found) : null
    if (!found || !position || !marker) return
    const device: PlacedHouseDevice = { ...found, position }
    const levelId = this.markerLevelId(device)
    if (levelId && this.focusedLevelId !== levelId) this.focusLevel(levelId)
    const size = new Vector3(DEVICE_FOCUS_SIZE_M, DEVICE_FOCUS_SIZE_M, DEVICE_FOCUS_SIZE_M)
    const box = new Box3().setFromCenterAndSize(marker.worldAnchor(), size)
    const { azimuth, polar } = this.currentSpherical()
    const inward = this.roomSideAzimuth(device)
    this.flyTo(box, inward ?? azimuth, clamp(polar, DEVICE_FOCUS_POLAR[0], DEVICE_FOCUS_POLAR[1]), animate, 1.1)
  }

  /**
   * Azimuth that looks at the device FROM the center of its room. Without this, a device against an exterior
   * wall (lamp, shutter, TV: the common case) was framed from behind that wall, and one only
   * saw its back and the lawn. `null` if it is in the middle of the room or outside any room: we then keep
   * the user's azimuth.
   */
  private roomSideAzimuth(device: PlacedHouseDevice): number | null {
    if (!device.roomId || !this.house) return null
    const b = roomBounds(this.house, device.roomId, resolveDefaults(this.house.defaults))
    if (!b) return null
    const c = boundsCenter(b)
    const dx = c[0] - device.position[0], dy = c[1] - device.position[1]
    if (Math.hypot(dx, dy) < 0.5) return null
    return Math.atan2(dx, -dy)   // world frame: x east, z = house -y
  }

  focusOutdoor(animate = true): void {
    if (!this.geometry) return
    this.focusLevel(null)
    this.highlightRoom(null)
    this.flyTo(boundsToWorldBox(this.geometry.bounds), DEFAULT_AZIMUTH, (50 * Math.PI) / 180, animate, 1.05)
  }

  /**
   * Looks at the plot FROM a cardinal point (the true one, `origin.heading` included), almost
   * horizontally: it is in profile that a slope or a bank is judged. `top`: from straight above, to aim at a
   * point in the plane.
   */
  viewTerrainFrom(side: TerrainView, animate = true): void {
    if (!this.geometry || !this.house) return
    if (side === 'top') { this.flyTo(boundsToWorldBox(this.geometry.bounds), this.currentSpherical().azimuth, 0.01, animate, 1.0); return }
    const h = (this.house.origin.heading * Math.PI) / 180
    const north: Vec2 = [-Math.sin(h), Math.cos(h)]      // north in the house reference frame (+y is rotated by the heading)
    const turn = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }[side]
    const d: Vec2 = [north[0] * Math.cos(turn) - north[1] * Math.sin(turn), north[0] * Math.sin(turn) + north[1] * Math.cos(turn)]
    // camera on side `d`: in world (x, z = −y), three azimuth = atan2(x, z)
    this.flyTo(boundsToWorldBox(this.geometry.bounds), Math.atan2(d[0], -d[1]), Math.PI / 2 - 0.12, animate, 1.0)
  }

  /** Frames a whole level (after a tab change). */
  focusLevelView(levelId: string, animate = true): void {
    if (!this.house || !this.geometry) return
    this.focusLevel(levelId)
    this.highlightRoom(null)
    // the roof level is framed ON the roof (it has neither room nor outline to frame otherwise): framing
    // the whole structure left it small and distant, whereas it is what one came to see
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

  /**
   * The POSE is the same in both projections — it is the reference field of view that
   * computes it, even when the camera no longer has one. The orthographic adds its zoom: both then
   * frame the same thing, and switching from one to the other moves nothing. The isometric, for its part, brings
   * the requested angle back onto its rails before framing.
   */
  private flyTo(box: Box3, azimuth: number, polar: number, animate: boolean, padding: number): void {
    const iso = this.options.projection === 'iso'
    const aim = iso ? snapIsoAzimuth(azimuth, DEFAULT_AZIMUTH) : azimuth
    const dive = iso ? ISO_POLAR : polar
    const aspect = this.viewAspect
    const pose = fitBox(box, this.perspectiveCamera.fov, aspect, { azimuth: aim, polar: dive, padding })
    pose.position.y = Math.max(pose.position.y, 0.5)
    if (this.camera instanceof OrthographicCamera) pose.zoom = fitZoom(boxRadius(box), aspect, ORTHO_BASE_M, padding)
    this.moveCamera(pose, animate)
  }

  private moveCamera(pose: CameraPose, animate: boolean): void {
    const target = this.controls?.target ?? new Vector3()
    const ortho = this.camera instanceof OrthographicCamera ? this.camera : null
    const fromZoom = ortho?.zoom ?? 1
    const toZoom = pose.zoom ?? fromZoom
    const setZoom = (z: number) => { if (ortho) { ortho.zoom = z; ortho.updateProjectionMatrix() } }
    this.cameraTween?.cancel()
    if (!animate || !this.controls) {
      this.camera.position.copy(pose.position)
      target.copy(pose.target)
      setZoom(toZoom)
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
        setZoom(fromZoom + (toZoom - fromZoom) * k)
        this.controls!.update()
      },
    })
    this.cameraTween = tw
    this.loop.addTween(tw)
  }

  /** Highlight of a room: the floor leans toward the accent (like an active tab). */
  /**
   * The selected room carries an accent LINE along its walls and a light veil on its floor,
   * both UNLIT: they do not react to the lamps and do not alter the floor beneath.
   * Previously (until 2026-09-15) the floor itself leaned toward the accent (`color.lerp` 0.45 and an
   * emitted share at night): the colored pools of the lamps were skewed by it, and the tint got
   * lost on a dark parquet or under a black sky. The line is lighter than white
   * (color × 1.6): at night, the bloom turns it into a neon, like the maquette.
   */
  highlightRoom(roomId: string | null): void {
    if (!this.nodes) return
    // the floor clones take back the color of their kind (after a change of style or hour)
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
      // The line is lightened (a dark accent, the Kasbah theme's teal, would stay a dull
      // thread) and pushed JUST above 1: it is this overshoot that the bloom catches at night.
      // Tuned by eye with the user: × 1.8 burned to white, × 1 "doesn't glow enough anymore".
      // The veil is light, it barely tints.
      // Drawn ON TOP OF the walls (`ringThrough`, like the guide of the move mode): in an oblique
      // view, the foot of a wall hid the line that runs along it.
      // These five numbers are the ones the tuning bench (`styles/tuning.ts`) puts under sliders.
      const tn = this.tuning
      const ring = new Mesh(
        flatRing(floor.polygon, insetPolygon(floor.polygon, tn.ringWidth), floor.z1 + 0.012),
        new MeshBasicMaterial({ color: accent.clone().lerp(WHITE, tn.ringWhite).multiplyScalar(tn.ringBoost), transparent: true, opacity: tn.ringOpacity, depthWrite: false, depthTest: !tn.ringThrough }),
      )
      const fill = new Mesh(
        flatPolygon(floor.polygon, floor.z1 + 0.008),
        new MeshBasicMaterial({ color: accent, transparent: true, opacity: tn.fillOpacity, depthWrite: false }),
      )
      for (const m of [fill, ring]) { m.name = 'highlight'; level.group.add(m); this.highlightMeshes.push(m) }
      // …and the rest of the house fades behind it (`core/roomFocus.ts`): its outline widened
      // by an exterior wall (its walls stay whole), from under its slab to the top of its walls. The
      // boundary falls in the VOID, beyond the wall: placed right on its outer face, it
      // flipped each pixel to one side or the other — a grain that flickered at the slightest gesture.
      const wall = this.house ? resolveDefaults(this.house.defaults).exteriorWallThickness : 0.3
      setRoomFocusShape(offsetPolygon(floor.polygon, wall + ROOM_FOCUS_MARGIN_M), level.elevation - ROOM_FOCUS_SLAB_M, level.elevation + level.height + ROOM_FOCUS_MARGIN_M)
    }
    this.fadeRoomFocus(floor && level ? 1 : 0)
    this.highlightedRoom = roomId
    this.loop.invalidate()
  }

  /** Brings a room's highlight to `to` (0 = none) in `ROOM_FOCUS_MS`, without replaying if it is already heading there. */
  private fadeRoomFocus(to: number): void {
    if (this.roomFocusTarget === to) return
    this.roomFocusTarget = to
    this.roomFocusTween?.cancel()
    this.roomFocusTween = null
    const from = roomFocusUniforms.kasbahFocus.value
    if (!this.renderer) { setRoomFocusStrength(to); return }
    const tw = createTween({
      durationMs: ROOM_FOCUS_MS, now: this.deps.now?.() ?? performance.now(), easing: easeInOutCubic,
      onUpdate: (k) => setRoomFocusStrength(from + (to - from) * k),
      onDone: () => { this.roomFocusTween = null },
    })
    this.roomFocusTween = tw
    this.loop.addTween(tw)
  }

  /**
   * The windows of a room with a lamp on light up, seen from outside: the room's glass
   * (one clone per room, `buildLevel`) emits the color of its lamps, pushed above 1
   * so that the bloom catches it, and becomes more opaque — a glass at 30 % would only emit 30 %.
   * Only at night (`theme.night`): in broad daylight, a lit window does not show.
   * Only changes a color and an opacity: no program variant.
   */
  private syncWindowGlow(): void {
    if (!this.nodes || !this.house) return
    const lit = new Map<string, { color: Color; weight: number; k: number }>()
    for (const d of this.house.devices) {
      const s = d.deviceId && d.roomId ? this.states[d.deviceId] : undefined
      if (!s || s.kind !== 'light' || !s.available || !s.on) continue
      const k = (s.brightness ?? 100) / 100
      const { r, g, b } = s.color ? xyToRgb(s.color.x, s.color.y) : mirekToRgb(s.colorTempMirek ?? 366)
      const room = lit.get(d.roomId!) ?? { color: new Color(0, 0, 0), weight: 0, k: 0 }
      room.color.r += r * k; room.color.g += g * k; room.color.b += b * k
      room.weight += k
      room.k = Math.max(room.k, k)
      lit.set(d.roomId!, room)
    }
    const night = this.theme.night
    for (const nodes of this.nodes.levels.values()) {
      for (const pane of nodes.panes) {
        const m = pane.userData.material as MeshPhysicalMaterial
        const base = pane.userData.baseMaterial as MeshPhysicalMaterial
        m.color.copy(base.color)
        m.roughness = base.roughness
        m.metalness = base.metalness
        m.emissive.copy(base.emissive)
        m.opacity = base.opacity
        const room = lit.get(pane.userData.roomId as string)
        const w = room && room.weight > 0 ? room.k * night : 0
        if (w <= 0) continue
        m.emissive.add(room!.color.clone().multiplyScalar((WINDOW_GLOW * w) / room!.weight))
        m.opacity += (WINDOW_LIT_OPACITY - m.opacity) * w
      }
    }
    this.loop.invalidate()
  }

  // ---- selection ----------------------------------------------------------
  setSelected(key: string | null): void {
    if (this.selectedKey) this.markers.get(this.selectedKey)?.setSelected(false)
    this.selectedKey = key
    if (key) this.markers.get(key)?.setSelected(true)
    this.applyLevelFocus()
    this.loop.invalidate()
  }

  /** Selection at the NDC point by raycasting: device object, room floor, roof, zone. */
  pick(ndc: { x: number; y: number }): { kind: 'device'; key: string } | { kind: 'room'; roomId: string } | { kind: 'level'; levelId: string } | { kind: 'zone'; zoneId: string } | { kind: 'journal'; at: number } | { kind: 'opening'; openingId: string } | { kind: 'parking'; parkingId: string } | { kind: 'garden'; itemId: string } | null {
    if (!this.nodes) return null
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera)
    // An opening handle or a space only wins over the structure if the structure does not HIDE it:
    // without this guard, a tap on the upper floor's floor went through and grabbed the window or the space of the
    // ground floor right below. The distance of the structure hit first is only computed when needed.
    let front: number | undefined
    const hidden = (d: number) => d > (front ??= this.nearestBuiltHit()) + WALL_PICK_TOLERANCE_M
    // In edit mode, a tree takes precedence over everything else: it is the only moment it is touched.
    if (this.editingGarden) {
      const hitItem = this.raycaster.intersectObjects(this.garden.pickables(), false)[0]
      const itemId = hitItem ? this.garden.idOf(hitItem) : null
      if (itemId) return { kind: 'garden', itemId }
    }
    // In edit mode, a space takes precedence over the floor that carries it — but AFTER the devices: the
    // car parked on it stays what is touched first, it is what one comes to control.
    if (this.editingParkings) {
      const fills: Mesh[] = []
      for (const n of this.parkingNodes.values()) if (shownInScene(n.group)) fills.push(n.fill)
      const pickables: Object3D[] = []
      for (const m of this.markers.values()) if (m.visibleInScene) pickables.push(...m.pickables)
      const hitParking = this.raycaster.intersectObjects(fills, false)[0]
      const hitOnIt = this.raycaster.intersectObjects(pickables, false)[0]
      if (hitParking && !hidden(hitParking.distance) && (!hitOnIt || hitParking.distance < hitOnIt.distance)) {
        return { kind: 'parking', parkingId: hitParking.object.userData.parkingId as string }
      }
    }
    // In edit mode, an opening's handle takes precedence BEFORE the device: it is what one comes
    // looking for, and a shutter's curtain covers precisely its window.
    if (this.editingOpenings) {
      const fills: Mesh[] = []
      for (const h of this.openingHandles.values()) if (shownInScene(h.group)) fills.push(h.fill)
      const hitHandle = this.raycaster.intersectObjects(fills, false)[0]
      if (hitHandle && !hidden(hitHandle.distance)) return { kind: 'opening', openingId: hitHandle.object.userData.openingId as string }
    }
    // a log pin first: small, laid on the ground, it would lose against the room's floor
    if (this.journal) {
      const hitPin = this.raycaster.intersectObjects(this.journal.pickables, false)[0]
      if (hitPin) return { kind: 'journal', at: hitPin.object.userData.at as number }
    }
    const pickables: Object3D[] = []
    for (const m of this.markers.values()) if (m.visibleInScene) pickables.push(...m.pickables)
    const hitDevice = this.raycaster.intersectObjects(pickables, false)[0]
    const floors: Mesh[] = []
    const walls: Mesh[] = []
    for (const nodes of this.nodes.levels.values()) {
      if (nodes.group.visible && nodes.markers.visible) { floors.push(...nodes.floors.values()); walls.push(...nodes.walls) }
    }
    const hitFloor = this.raycaster.intersectObjects(floors, false)[0]
    // A wall STOPS the ray: without it, the tap on a partition went through and landed on the floor of
    // the neighboring room. It selects the room whose face is seen (`roomOfWallHit`).
    const hitWall = this.raycaster.intersectObjects(walls, false)[0]
    // The roof hides what it covers: a tap on it goes to the level that carries it, never to the room
    // that cannot be seen below (otherwise the roof disappeared in favor of the upper floor).
    const roofNode = this.nodes.roof
    const roofLevel = roofNode?.visible ? this.roofLevel() : undefined
    const hitRoof = roofNode && roofLevel ? this.raycaster.intersectObject(roofNode, false)[0] : undefined
    // A device UNDER a floor (car in the garage under the bedroom) is farther than the floor:
    // it is only taken if it is the closest — otherwise one touches the floor one sees.
    const deviceWins = !!hitDevice
      && (!hitFloor || hitDevice.distance <= hitFloor.distance)
      && (!hitRoof || hitDevice.distance <= hitRoof.distance)
      // a wall light, a wall-mounted TV are IN FRONT OF their wall: the margin does not make them lose against it
      && (!hitWall || hitDevice.distance <= hitWall.distance + WALL_PICK_TOLERANCE_M)
    if (deviceWins) return { kind: 'device', key: hitDevice!.object.userData.key as string }
    if (hitRoof && (!hitFloor || hitRoof.distance <= hitFloor.distance) && (!hitWall || hitRoof.distance <= hitWall.distance)) return { kind: 'level', levelId: roofLevel!.id }
    if (hitWall && (!hitFloor || hitWall.distance < hitFloor.distance)) {
      const roomId = this.roomOfWallHit(hitWall)
      return roomId ? { kind: 'room', roomId } : null
    }
    if (hitFloor) return { kind: 'room', roomId: hitFloor.object.userData.roomId as string }
    // the garden zones can only be selected in the overview / garden
    if (this.focusedLevelId === null) {
      const hitZone = this.raycaster.intersectObjects([...this.nodes.zones.values()], false)[0]
      if (hitZone) return { kind: 'zone', zoneId: hitZone.object.userData.zoneId as string }
    }
    return null
  }

  /**
   * Distance of the first BUILT element under the current ray: floor or wall of a shown level, visible
   * roof. `Infinity` if the ray hits nothing built. Same filters as selecting a room.
   */
  private nearestBuiltHit(): number {
    if (!this.nodes) return Infinity
    const built: Object3D[] = []
    for (const nodes of this.nodes.levels.values()) {
      if (nodes.group.visible && nodes.markers.visible) built.push(...nodes.floors.values(), ...nodes.walls)
    }
    if (this.nodes.roof?.visible) built.push(this.nodes.roof)
    return this.raycaster.intersectObjects(built, false)[0]?.distance ?? Infinity
  }

  /**
   * The room of a touched wall: the one IN FRONT OF the seen face (a partition separates two rooms, we want
   * the one being looked at), otherwise the one BEHIND (the facade seen from the garden opens the room it
   * closes). The top of a wall has no vertical face: it is the camera side that counts.
   */
  private roomOfWallHit(hit: Intersection): string | null {
    if (!this.nodes || !this.index) return null
    const levelId = [...this.nodes.levels].find(([, n]) => n.walls.includes(hit.object as Mesh))?.[0]
    const rooms = levelId ? this.index.roomsByLevel.get(levelId) ?? [] : []
    const toHouse = this.nodes.root.matrixWorld.clone().invert()
    const p = hit.point.clone().applyMatrix4(toHouse)
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(toHouse) : new Vector3()
    if (Math.hypot(n.x, n.y) < 0.5) n.copy(this.raycaster.ray.direction).transformDirection(toHouse).negate()
    const h = new Vector2(n.x, n.y).normalize()
    const roomAt = (d: number) => rooms.find((r) => pointInPolygon([p.x + h.x * d, p.y + h.y * d], r.polygon))?.id
    // in front, barely set off; behind, beyond the wall thickness (a facade is ~0.4 m)
    let roomId = roomAt(0.1)
    for (let d = 0.1; !roomId && d <= 1; d += 0.1) roomId = roomAt(-d)
    return roomId ?? null
  }

  private handleTap(ev: TapEvent): void {
    if (this.shapeEditor?.active()) return
    // the handles of a room's shape take the tap that touches them; elsewhere, it carries on
    if (this.shapeEditor?.tap(ev)) return
    if (this.drag?.active() || this.openingDragger?.active() || this.parkingDragger?.active() || this.gardenDragger?.active() || this.reliefEditor?.active() || this.outlineEditor?.active()) return   // end of a drag, not a tap
    // shaping the terrain: a tap selects a dot, it opens neither a room nor a device
    if (this.reliefGrid) { (this.terrainTab === 'outline' ? this.outlineEditor : this.reliefEditor)?.tap(ev); return }
    // An armed opening takes the tap BEFORE any selection: one came to designate a wall, not
    // to open the room or the device in front of it. Tapped beside the structure, it is a background tap
    // — the caller reads it as a cancellation, as everywhere else in the view.
    if (this.placingOpening) {
      const xy = this.buildingPoint(this.placingOpening.roomId, this.placingOpening.type, ev.ndc)
      if (xy) this.emit('placeTap', xy)
      else this.emit('backgroundTap')
      return
    }
    // An armed room: any floor gives the point (a new level has no floor yet)
    if (this.placingRoom) {
      const hit = this.groundPoint(ev.ndc)
      if (hit) this.emit('roomPlaceTap', hit.xy)
      else this.emit('backgroundTap')
      return
    }
    // An armed space takes the tap the same way, but on the FLOOR: that is where it is placed.
    if (this.placingParking) {
      const hit = this.groundPoint(ev.ndc)
      if (hit) this.emit('groundTap', hit.xy, hit.levelId)
      else this.emit('backgroundTap')
      return
    }
    // An armed garden element: only the TERRAIN (lawn, zones) accepts it, not a floor.
    if (this.placingGarden) {
      const hit = this.groundPoint(ev.ndc)
      if (hit && hit.levelId === null) this.emit('gardenPlaceTap', hit.xy)
      else this.emit('backgroundTap')
      return
    }
    const hit = this.pick(ev.ndc)
    if (!hit) { this.emit('backgroundTap'); return }
    if (hit.kind === 'device') this.emit('deviceTap', hit.key)
    else if (hit.kind === 'garden') this.emit('gardenTap', hit.itemId)
    else if (hit.kind === 'parking') this.emit('parkingTap', hit.parkingId)
    else if (hit.kind === 'opening') this.emit('openingTap', hit.openingId)
    else if (hit.kind === 'journal') this.emit('journalTap', hit.at)
    else if (hit.kind === 'room') this.emit('roomTap', hit.roomId)
    else if (hit.kind === 'level') this.emit('levelTap', hit.levelId)
    else this.emit('zoneTap', hit.zoneId)
  }

  // ---- appearance / size / render ----------------------------------------
  /**
   * (Re)builds the sky and sets it on `scene.environment`: it is the only source of reflections in
   * the scene, and without it any slightly metallic or smooth material renders as clay. It is redone at
   * every change of style or hour — and the old one is freed, a PMREM map holds video
   * memory. The sky is never displayed: the canvas background is its horizon color, flat.
   */
  private applySky(): void {
    // the weather grays the style's sky (clouds) and, when the air is visible, drowns the distance in the background
    const sky = overcastSky(this.look.sky, this.ambience.cloudiness)
    this.skyEnv?.dispose()
    this.skyEnv = createSkyEnvironment(this.renderer, sky, this.sunDir)
    this.scene.environment = this.skyEnv
    this.scene.environmentIntensity = sky.intensity
    const backdrop = backdropColor(sky)
    this.renderer?.setClearColor(backdrop, 1)
    // The fog is ALWAYS set, pushed back out of sight when the air is clear: three compiles one
    // program with and one without, and making it appear (visibility below 5 km) recompiled every
    // material — 2.1 s of frozen frame measured on the visibility slider in Settings (2026-09-25).
    const fog = this.scene.fog instanceof Fog ? this.scene.fog : (this.scene.fog = new Fog(backdrop, NO_FOG_M, NO_FOG_M))
    fog.color.copy(backdrop)
    this.updateFogRange()
    this.applyMist()
  }

  /** The fog's bounds follow the camera distance (`fogRange`): reread at every frame, they are only uniforms. */
  private updateFogRange(): void {
    const fog = this.scene.fog
    if (!(fog instanceof Fog)) return
    const range = fogRange(this.ambience, this.controls ? this.camera.position.distanceTo(this.controls.target) : 0)
    fog.near = range?.near ?? NO_FOG_M
    fog.far = range?.far ?? NO_FOG_M
  }

  /**
   * The low mist of dawn and night (`core/heightMist.ts`), laid on the terrain. Its color
   * is the sky's horizon, lightened toward the sky that lights it from above (the moon, the dawn): a
   * layer a little lighter than the background, which reads against it.
   */
  private applyMist(): void {
    const sky = new Color().copy(this.look.lighting.hemiSky).multiplyScalar(this.look.lighting.hemiIntensity * MIST_SKY_SHARE)
    const color = backdropColor(overcastSky(this.look.sky, this.ambience.cloudiness)).lerp(sky, 0.5)
    setHeightMist(this.ambience, color, this.geometry?.terrain.z ?? 0)
  }

  /**
   * The single entry point for the appearance. The three axes are independent: the
   * hour can be changed without changing style, and the app theme without touching either one.
   *
   * Changing STYLE hands maps to the materials again (hence recompiles their shaders); changing
   * the HOUR only mutates colors and intensities. It is because of this difference in cost
   * that `applyLook` compares the maps before requesting a recompilation.
   */
  /**
   * Requests a shadow recapture again: after a change of geometry, device or sun. The
   * window covers the animated travels (a shutter takes 400 ms to come down), otherwise the shadow would stay
   * the old one. A rotating camera NEVER calls this — that is the whole point.
   */
  invalidateShadows(ms = SHADOW_SETTLE_MS): void {
    this.shadowsDirtyUntil = (this.deps.now?.() ?? performance.now()) + ms
    // …and, however long the wait lasts, the NEXT frames drawn: a time window alone
    // expired during the loading veil (no frame, shaders compiling) — the upper floor
    // hidden in the meantime left its shadow on the ground floor.
    this.shadowFramesPending = SHADOW_MIN_FRAMES
  }

  /**
   * Shows or hides the pills layer (DOM). A DIAGNOSTIC tool of the debug overlay: sixty
   * pills moved every frame have a cost that neither `renderer.info` nor the time spent in
   * `render()` fully shows — the rest is paid by the browser's style and compositor.
   * Turning them off puts a figure on it, on the machine that has the problem.
   */
  /**
   * Marks the labels layer as MOVING. That is what allows their promotion to a
   * compositing layer (`will-change`, `styles/app.css`) — and only at that moment: a
   * permanent promotion on forty elements keeps as many textures alive for nothing, and that is
   * precisely what the specification advises against. The flag drops half a second after the
   * last frame.
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

  /** Plugs (or unplugs) a probe around each rendered frame — the debug overlay's `stats.js`. */
  setProbe(probe: FrameProbe | null): void { this.probe = probe }

  /** Readout for the debug overlay (Settings → 3D rendering). Read on demand, never during the render. */
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
    if (next.ambience) this.ambience = next.ambience
    if (next.assets !== undefined) this.assets = next.assets
    if (next.tuning) this.tuning = next.tuning
    if (next.style || next.ambience || next.tuning) this.look = applyTuning(this.style.look(this.ambience), this.tuning)
    this.theme = resolveSceneTheme(next.ui ?? this.theme, this.look.palette, this.ambience)
    this.photoGen++                        // the images of a style or setting that was left have no taker anymore
    this.applyMaterials()
    this.applySky()
    this.applyLighting()
    if (this.post) this.post.setLook(this.look.post)
    else if (this.renderer) {
      this.renderer.toneMapping = toneMappingOf(this.look.post)
      this.renderer.toneMappingExposure = this.look.post.exposure
    }
    for (const m of this.markers.values()) m.setTheme(this.theme, this.look.glow)
    this.buildOpeningHandles()             // the handles are tinted with the accent, which just changed
    this.buildParkings()                   // the ground marking follows the theme, like the rest
    this.buildGarden()                     // the accent ring follows the theme, the garden the style's palette
    this.buildOriginMark()                 // the origin marker too
    this.highlightRoom(this.highlightedRoom)
    this.syncWindowGlow()                  // the style's glass, and the hour that says whether it is night
    this.invalidateShadows()               // the sun may have moved
    this.syncStorm()
    this.syncPrecipitation()
    this.syncBats()
    this.syncDisco()
    this.syncParade()
    this.syncWater()                       // the style says whether the water moves, the hour what the bottom receives
    this.loop.invalidate()
    void this.compileBeforeShow()
  }

  /**
   * The tuning bench, while a slider is being dragged. `setAppearance` would redo the materials, the
   * sky, the shadows and the textures at every frame of the drag — yet a bench multiplier
   * touches ONLY the image chain, the lamps' halo and the room's line. It is the same look
   * recomputed, but only what depends on it is reapplied.
   */
  setTuning(tuning: SceneTuning): void {
    this.tuning = tuning
    this.look = applyTuning(this.style.look(this.ambience), this.tuning)
    if (this.post) this.post.setLook(this.look.post)
    else if (this.renderer) {
      this.renderer.toneMapping = toneMappingOf(this.look.post)
      this.renderer.toneMappingExposure = this.look.post.exposure
    }
    for (const m of this.markers.values()) m.setTheme(this.theme, this.look.glow)
    this.highlightRoom(this.highlightedRoom)
    this.loop.invalidate()
  }

  /** What the image chain REALLY applies, tuning included: enough to derive a default from it. */
  tunedLook(): { post: PostLook; glow: GlowLook } {
    return { post: this.look.post, glow: this.look.glow }
  }

  /**
   * Storm: a lightning strike from time to time — two flashes, a short one and a longer one, like a real one. It
   * is NOT a loop animation (which would run at 20 Hz for the whole storm for nothing): timers
   * that only request one frame per flash, through the exposure. The only state is the
   * current timer, stopped as soon as the storm passes or the scene is destroyed.
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

  /** Multiplies the style's exposure for the duration of a flash; 1 gives it back to the style. */
  private setExposureFactor(k: number): void {
    const post = { ...this.look.post, exposure: this.look.post.exposure * k }
    if (this.post) this.post.setLook(post)
    else if (this.renderer) this.renderer.toneMappingExposure = post.exposure
    this.loop.invalidate()
  }

  /**
   * Rain or snow according to the ambience — the only weather effect that runs the loop (at 20 Hz, like
   * every decorative animation). Cut in LOW quality: on a tablet already struggling, a downpour
   * of two thousand streaks is not what it is asked to do. The wind comes from the ambience too; without
   * real weather, a west breeze.
   */
  private syncPrecipitation(): void {
    const p = this.ambience.precipitation
    if (!p || this.quality === 'low' || !this.nodes || !this.geometry) { this.removePrecipitation(); return }
    const params = { kind: p.kind, intensity: p.intensity, windKmh: this.ambience.windKmh ?? 10, windDirDeg: (this.ambience.windDirDeg ?? 250) - this.headingDeg }
    // same kind and similar intensity: we adjust without rebuilding; otherwise we start over (the number
    // of particles is fixed at creation)
    if (this.precip && this.precip.kind === p.kind && this.precip.object.parent === this.nodes.root && Math.abs(this.precipIntensity - p.intensity) < 0.25) {
      this.precip.setParams(params)
      return
    }
    this.removePrecipitation()
    const b = this.geometry.bounds
    this.precip = new Precipitation({ min: [b.min[0], b.min[1]], max: [b.max[0], b.max[1]], height: PRECIP_HEIGHT_M }, params)
    this.precipIntensity = p.intensity
    this.nodes.root.add(this.precip.object)
    const effect = this.precip
    this.stopPrecip = this.loop.addAnimation({ step: (_now, dtS) => { if (this.precip !== effect) return false; effect.step(dtS); return true } })
  }

  /**
   * The style's bats: one more decorative animation (20 Hz), cut in low quality
   * like the rain. Same number: we keep the swarm in flight; otherwise we redo it.
   */
  private syncBats(): void {
    const n = this.look.bats?.count ?? 0
    if (n <= 0 || this.quality === 'low' || !this.nodes || !this.geometry) { this.removeBats(); return }
    if (this.bats && this.bats.count === n && this.bats.object.parent === this.nodes.root) { this.bats.setColor(this.look.bats!.color); return }
    this.removeBats()
    const b = this.geometry.bounds
    const built = this.house ? buildingBounds(this.house, resolveDefaults(this.house.defaults), this.geometry.roof) : b
    const bats = new Bats({
      terrain: this.geometry.terrain.polygon,
      building: { min: [built.min[0], built.min[1]], max: [built.max[0], built.max[1]] },
      pools: this.poolBoxes(),
      statics: this.roamStatics(),
      around: () => this.roamObstacles(),
      roofZ: b.max[2],
    }, n, this.look.bats!.color)
    this.bats = bats
    this.nodes.root.add(bats.object)
    this.stopBats = this.loop.addAnimation({ step: (_now, dtS) => { if (this.bats !== bats) return false; bats.step(dtS); return true } })
  }

  private removeBats(): void {
    this.stopBats?.()
    this.stopBats = null
    this.bats?.dispose()
    this.bats = null
  }

  /**
   * The style's mirror ball and spotlights (`effects/disco.ts`): same regime as the
   * bats (20 Hz, cut in low quality). Same number of spotlights: we keep the party going.
   */
  private syncDisco(): void {
    const n = this.look.disco?.spots ?? 0
    if (n <= 0 || this.quality === 'low' || !this.nodes || !this.geometry) { this.removeDisco(); return }
    if (this.disco && this.disco.spotCount === n && this.disco.object.parent === this.nodes.root) { this.disco.setColors(this.look.disco!.colors); return }
    this.removeDisco()
    const b = this.geometry.bounds
    const disco = new Disco({ min: [b.min[0], b.min[1]], max: [b.max[0], b.max[1]], roofZ: b.max[2] }, n, this.look.disco!.colors)
    this.disco = disco
    this.nodes.root.add(disco.object)
    this.stopDisco = this.loop.addAnimation({ step: (_now, dtS) => { if (this.disco !== disco) return false; disco.step(dtS); return true } })
  }

  private removeDisco(): void {
    this.stopDisco?.()
    this.stopDisco = null
    this.disco?.dispose()
    this.disco = null
  }

  /**
   * The style's characters (`effects/parade.ts`): same regime as the bats (20 Hz,
   * cut in low quality). Same kind: we keep the parade in progress; otherwise we redo it.
   */
  private syncParade(): void {
    const kind = this.look.parade?.kind
    if (!kind || this.quality === 'low' || !this.nodes || !this.geometry || !this.house) { this.removeParade(); return }
    if (this.parade && this.parade.kind === kind && this.parade.object.parent === this.nodes.root) return
    this.removeParade()
    const built = buildingBounds(this.house, resolveDefaults(this.house.defaults), this.geometry.roof)
    const parade = new Parade(kind, {
      terrain: this.geometry.terrain.polygon,
      building: { min: [built.min[0], built.min[1]], max: [built.max[0], built.max[1]] },
      pools: this.poolBoxes(),
      statics: this.roamStatics(),
      around: () => this.roamObstacles(),
      roofZ: built.max[2],
      groundZ: (x, y) => this.groundZ(x, y),
    })
    this.parade = parade
    this.nodes.root.add(parade.object)
    this.stopParade = this.loop.addAnimation({ step: (_now, dtS) => { if (this.parade !== parade) return false; parade.step(dtS); return true } })
  }

  /** The pools, as boxes: what parades around the house skirts them (`effects/roam.ts`). */
  private poolBoxes(): Box[] {
    return (this.geometry?.zones ?? []).filter((z) => z.kind === 'pool').map((z) => {
      const xs = z.polygon.map((p) => p[0]), ys = z.polygon.map((p) => p[1])
      return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] }
    })
  }

  /**
   * What the characters skirt from their path onward: the garden, and the cars and the mower where
   * they are parked at that moment (not the trees: the sleigh and the X-wings fly over them). A
   * car parked against the house, avoided only on the way, made the swerve and the
   * house fight each other: a skeleton jumped by 11 m (measured on the demo house).
   */
  private roamStatics(): { x: number; y: number; r: number; tall: boolean }[] {
    return [...this.garden.footprints(), ...this.roamObstacles().map((c) => ({ ...c, tall: false }))]
  }

  /**
   * What the characters and the bats steer clear of ON THE WAY: the cars and the mower
   * where they are NOW (read again at every step, 20 Hz). The garden, being fixed, is skirted from the
   * path onward (`statics`).
   */
  private roamObstacles(): Circle[] {
    const out: Circle[] = []
    for (const m of this.markers.values()) {
      const r = m instanceof VehicleMarker ? ROAM_RADIUS.vehicle : m instanceof MowerMarker ? ROAM_RADIUS.mower : 0
      if (r && m.object.parent === this.nodes?.outdoorMarkers) out.push({ x: m.object.position.x, y: m.object.position.y, r })
    }
    return out
  }

  private removeParade(): void {
    this.stopParade?.()
    this.stopParade = null
    this.parade?.dispose()
    this.parade = null
  }

  private removePrecipitation(): void {
    this.stopPrecip?.()
    this.stopPrecip = null
    this.precip?.dispose()
    this.precip = null
  }

  /**
   * The water that moves (`effects/water.ts`). The shader only costs the pool's pixels; what
   * costs is the LOOP — animated water redraws the whole scene, ten times per second. Hence
   * three conditions, in this order of cheapness: the style wants living water (the maquette does not),
   * the quality is not low (same rule as the rain), and a pool is IN THE FIELD OF VIEW. The
   * last point is reevaluated at every camera movement: a house seen from the street side does not
   * pay for the garden pool.
   *
   * The bottom's caustics follow the daylight: a basin that lights up by itself at midnight fools
   * nobody. The swell, for its part, ripples under the moon too.
   */
  private syncWater(): void {
    const flow = this.look.surfaces.zones.pool.flow ?? 1
    this.waterStrength.surface.value = flow
    setWaterTint(this.water, this.theme.zones.pool)
    setWaterSun(this.water, this.sunDir)
    setWaterWind(this.water, this.ambience.windKmh ?? 10, (this.ambience.windDirDeg ?? 250) - this.headingDeg)   // without weather, the rain's breeze
    this.waterStrength.basin.value = flow * (0.25 + 0.75 * dayFactor(this.ambience))
    const wanted = flow > 0 && this.quality !== 'low' && this.poolInView()
    if (wanted === (this.stopWater !== null)) return
    if (!wanted) { this.stopWater?.(); this.stopWater = null; return }
    this.stopWater = this.loop.addAnimation({
      hz: WATER_HZ,
      step: (_now, dtS) => { this.water.time.value += dtS; return true },
    })
  }

  /** Is a pool inside the view frustum? Without a pool, the answer is no. */
  private poolInView(): boolean {
    if (!this.nodes || !this.geometry) return false
    this.camera.updateMatrixWorld()
    waterFrustum.setFromProjectionMatrix(waterMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse))
    // The root hangs at the scene's origin, and `matrixWorldAutoUpdate` is off (the world
    // matrices are only redone per frame): its LOCAL matrix is therefore its world matrix, and it is the
    // only one that separates a zone mesh from the world frame.
    this.nodes.root.updateMatrix()
    for (const z of this.geometry.zones) {
      if (z.kind !== 'pool') continue
      const mesh = this.nodes.zones.get(z.zoneId)
      if (!mesh) continue
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
      const sphere = mesh.geometry.boundingSphere
      if (!sphere) continue
      if (waterFrustum.intersectsSphere(waterSphere.copy(sphere).applyMatrix4(this.nodes.root.matrix))) return true
    }
    return false
  }

  /**
   * The materials, with the photo materials if the style carries a pack and the user wants
   * them. The images arrive AFTERWARD: meanwhile, the procedural holds the place, and each loaded role
   * comes back through here with one more map. The token discards arrivals for a style or a
   * setting that has been left since — and a destroyed scene, which increments it on leaving.
   */
  private applyMaterials(): void {
    const pack = this.photoPack()
    const gen = this.photoGen
    const photos = pack
      ? loadPackTextures(pack, this.photoRoles(), () => {
        if (gen !== this.photoGen) return
        this.applyMaterials()
        this.highlightRoom(this.highlightedRoom)   // copies the clones' colors again, and redraws
        void this.compileBeforeShow()              // one more map = another program
      })
      : undefined
    // the house finishes: only the styles that carry an image pack interpret them
    const honor = !!this.style.assets
    const finishPhotos = honor && pack
      ? loadFinishTextures(this.usedFinishes(), () => {
        if (gen !== this.photoGen) return
        this.applyMaterials()
        this.highlightRoom(this.highlightedRoom)
        void this.compileBeforeShow()
      })
      : undefined
    this.materials.finishMode = { honor, ...(finishPhotos ? { photos: finishPhotos } : {}) }
    applyLook(this.materials, this.theme, this.look, photos, { wetness: this.ambience.wetness ?? 0, snow: this.ambience.snow ?? 0 })
    this.syncFloorClones()
  }

  /** The finishes used by the loaded house (floors, room walls, facade). */
  private usedFinishes(): FinishId[] {
    const g = this.geometry
    if (!g) return []
    const out = new Set<FinishId>()
    for (const l of g.levels) {
      for (const f of l.floors) if (f.finish) out.add(f.finish.id)
      for (const f of Object.values(l.wallFinishes ?? {})) out.add(f.id)
    }
    if (g.facade) out.add(g.facade.id)
    return [...out]
  }

  // ---- shape of a room (edit mode, "Dimensions" section) ------------------------------------------
  private shapeEditor: RoomShapeEditor | null = null
  private shapeRoomId: string | null = null
  private shapeLast: [number, number][] = []

  /** Opens (or closes, `null`) the shape editor on a room. */
  setShapeEditing(roomId: string | null): void {
    if (roomId === this.shapeRoomId && (this.shapeEditor || !roomId)) return
    this.shapeRoomId = roomId
    if (!roomId) this.shapeLast = []
    this.rebuildShapeEditor()
  }

  /** The shape to show (dimensions, m, house reference frame) — the one the store just computed. */
  setShapeOutline(points: readonly [number, number][]): void {
    this.shapeLast = points.map(([x, y]) => [x, y])
    this.shapeEditor?.setShape(this.shapeLast)
  }

  /** Selects a handle from the panel (a side in the list). */
  setShapeSelection(sel: ShapeSelection): void { this.shapeEditor?.setSelection(sel) }

  private rebuildShapeEditor(): void {
    const sel = this.shapeEditor?.selection ?? null
    this.shapeEditor?.dispose()
    this.shapeEditor = null
    const room = this.shapeRoomId ? this.index?.roomsById.get(this.shapeRoomId) : undefined
    const level = room ? this.nodes?.levels.get(room.levelId) : undefined
    if (!room || !level) return
    this.shapeEditor = new RoomShapeEditor({
      canvas: this.canvas,
      camera: this.camera,
      parent: level.markers,
      labels: level.labels,
      note: () => sceneNote('gap'),
      setControls: (enabled) => { if (this.controls) this.controls.enabled = enabled; if (!enabled) this.cameraTween?.cancel() },
      invalidate: () => this.loop.invalidate(),
      wall: (edge, delta, final) => this.emit('shapeWall', edge, delta, final),
      corner: (index, xy, final) => this.emit('shapeCorner', index, xy, final),
      select: (s) => this.emit('shapeSelect', s),
      accent: this.theme.primary,
    }, !!this.deps.headless)
    this.shapeEditor.selection = sel
    this.shapeEditor.setShape(this.shapeLast)
  }

  /**
   * Only the STRUCTURE changed — finishes (floor, walls, facade) or shape of the rooms (dimensions, openings
   * readjusted, level footprints): the level meshes are redone, the roof if its footprint
   * moved, the terrain clipped under the floors, and the markers (an auto-placed device follows the
   * center of its room). Neither camera nor preparation veil: it is the path of every click of the
   * finish picker and of every pushed wall.
   */
  updateBuilding(house: House): void {
    if (!this.nodes || !this.house) { this.load(house); return }
    const devicesMoved = JSON.stringify(this.house.devices) !== JSON.stringify(house.devices)
    const before = this.geometry
    this.house = house
    this.index = indexHouse(house)
    this.geometry = computeHouseGeometry(house)
    // only the levels whose geometry changed (a pushed wall only touches its own); all of them if the facade changed
    const levelKey = (l: HouseGeometry['levels'][number]) => JSON.stringify([l.walls, l.floors, l.openings, l.wallFinishes ?? null])
    const was = new Map(before?.levels.map((l) => [l.levelId, levelKey(l)]))
    const facadeChanged = JSON.stringify(before?.facade ?? null) !== JSON.stringify(this.geometry.facade ?? null)
    for (const l of this.geometry.levels) if (facadeChanged || was.get(l.levelId) !== levelKey(l)) this.rebuildLevelNodes(l.levelId)
    if (JSON.stringify(before?.roof) !== JSON.stringify(this.geometry.roof)) this.rebuildRoof()
    if (JSON.stringify(before?.terrain.footprints) !== JSON.stringify(this.geometry.terrain.footprints)) this.shapeTerrainNow()
    if (devicesMoved) { this.buildMarkers(); this.updateStates(this.states, true) }
    this.applyMaterials()                  // the photos of a finish that was just chosen
    if (this.editingOpenings) this.buildOpeningHandles()
    this.refreshOpeningNotes()
    this.highlightRoom(this.highlightedRoom)
    this.syncWindowGlow()                  // the redone levels have new glass panes
    this.applyLevelFocus()
    this.invalidateShadows()
    this.loop.invalidate()
  }

  /** The style's pack of photo materials, if the user wants them. */
  private photoPack(): TexturePack | undefined {
    return this.assets ? packById(this.style.assets) : undefined
  }

  /** The roles to dress with photos. `poolTile` is in no look (the basin imposes it in `applyLook`): it is loaded anyway. */
  private photoRoles(): SurfaceRole[] {
    return [...rolesOf(this.look.surfaces), 'poolTile']
  }

  /**
   * The floors carry a CLONE of the material of their kind, so that the highlight of one room does not
   * tint all the others. A style change changes the maps of the original material:
   * without this copy, a clone would keep the previous style's material.
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
   * The lighting comes from the STYLE, the sun's direction from the AMBIENCE. There is no longer "day in
   * light theme, night in dark theme": the house has its own hour (`core/ambience.ts`), and it is
   * that hour that decides whether what lights it is the sun or its own lamps.
   */
  private applyLighting(): void {
    const l = this.look.lighting
    this.hemi.color.copy(l.hemiSky)
    this.hemi.groundColor.copy(l.hemiGround)
    this.hemi.intensity = l.hemiIntensity
    this.ambient.intensity = l.ambientIntensity
    this.sun.color.copy(l.sunColor)
    this.sun.intensity = l.sunIntensity
    // Under an overcast sky or a low moon, a crisp cast shadow is a lie: we cut it
    // rather than let it slice a scene that no longer has a point source.
    this.sun.castShadow = l.shadowOpacity > 0.15
    this.fitSunShadow()
  }

  /** The render budget: (re)builds the post-processing chain and the pixel ratio. */
  private applyQuality(): void {
    this.post?.dispose()
    this.post = null
    const auto = this.options.quality === 'auto'
    const wanted = this.options.quality === 'auto' ? (this.autoQuality ?? detectQuality(this.renderer ? gpuName(this.renderer) : '')) : this.options.quality
    this.quality = wanted
    this.syncPrecipitation()               // low quality cuts the rain
    this.syncBats()                        // …and the bats
    this.syncDisco()                       // …and the mirror ball
    this.syncParade()                      // …and the parade
    this.syncWater()                       // …and freezes the water
    if (!this.renderer) return
    const pixelRatio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[wanted])
    this.renderer.setPixelRatio(pixelRatio)
    this.renderer.setSize(this.size.width, this.size.height, false)
    if (wanted === 'low') {
      // No chain: tone mapping goes back to the renderer, and the image goes straight to the screen.
      this.renderer.toneMapping = toneMappingOf(this.look.post)
      this.renderer.toneMappingExposure = this.look.post.exposure
      return
    }
    this.post = createPostPipeline({
      renderer: this.renderer, scene: this.scene, camera: this.camera, quality: wanted,
      draw: (target) => { this.renderer!.setRenderTarget(target); this.renderScene(this.renderer!) },
      // The machine cannot keep up: we step down a notch, without asking anyone — in "auto"
      // only. A chosen quality is a choice: the safeguard overrode it (measured on 2026-09-27,
      // "high" forced on the iGPU dropped back to "medium" after 13 s).
      ...(auto ? { onDowngrade: (to: EffectiveQuality) => { this.autoQuality = to; this.applyQuality(); this.loop.invalidate() } } : {}),
      ...(this.deps.now ? { now: this.deps.now } : {}),
    })
    this.post.setLook(this.look.post)
    this.post.setSize(this.size.width, this.size.height, pixelRatio)
  }

  /**
   * The floating panel covers the canvas's right edge: the framing (`fitBox`) and the center of the view
   * aim at the FREE part. `setViewOffset` widens the view frustum to the right instead of
   * recentering it, so everything computed on the whole canvas (raycaster NDC, CSS2DRenderer
   * pills) stays correct without changing anything.
   */
  setViewInset(rightPx: number): void {
    this.viewInsetRight = Math.max(0, rightPx)
    this.applyProjection()
    this.loop.invalidate()
  }

  /** Width/height ratio of the FREE part of the canvas: what both projections frame. */
  private get viewAspect(): number {
    const { width, height } = this.size
    return Math.max(1, width - Math.min(this.viewInsetRight, width * 0.6)) / height
  }

  private applyProjection(): void {
    const { width, height } = this.size
    const free = Math.max(1, width - Math.min(this.viewInsetRight, width * 0.6))
    const cam = this.camera
    if (cam instanceof OrthographicCamera) {
      // the frustum carries the SHAPE (base height, screen ratio); the size is the zoom
      const half = ORTHO_BASE_M / 2
      cam.top = half
      cam.bottom = -half
      cam.left = -half * this.viewAspect
      cam.right = half * this.viewAspect
    } else cam.aspect = this.viewAspect
    if (free < width) cam.setViewOffset(free, height, 0, 0, width, height)
    else cam.clearViewOffset()
    cam.updateProjectionMatrix()
  }

  resize(width: number, height: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) }
    this.applyProjection()
    this.renderer?.setSize(this.size.width, this.size.height, false)
    this.post?.setSize(this.size.width, this.size.height, this.renderer?.getPixelRatio() ?? 1)
    this.labelRenderer?.setSize(this.size.width, this.size.height)
    this.loop.invalidate()
  }

  /**
   * Rotates the view around the target by `delta` radians (view buttons), without changing the
   * tilt. In isometric, the angles are locked: the button makes a QUARTER turn, whatever
   * the requested amplitude, and brings the view back to the nearest corner if it had left it.
   */
  orbitBy(delta: number): void {
    const { azimuth, polar, distance } = this.currentSpherical()
    if (this.options.projection === 'iso') {
      const quarter = (delta < 0 ? -1 : 1) * (Math.PI / 2)
      this.moveCamera(this.poseAt(snapIsoAzimuth(azimuth, DEFAULT_AZIMUTH) + quarter, ISO_POLAR, distance), true)
      return
    }
    this.moveCamera(this.poseAt(azimuth + delta, polar, distance), true)
  }

  /**
   * Moves the camera closer (`factor` < 1) or farther, within the controls' bounds. In orthographic
   * the camera does not move: it is the zoom that opens or closes, as the wheel does.
   */
  dollyBy(factor: number): void {
    const { azimuth, polar, distance } = this.currentSpherical()
    const ortho = this.camera instanceof OrthographicCamera ? this.camera : null
    if (ortho) {
      const pose = this.poseAt(azimuth, polar, distance)
      pose.zoom = clamp(ortho.zoom / factor, this.controls?.minZoom ?? 0, this.controls?.maxZoom ?? Infinity)
      this.moveCamera(pose, true)
      return
    }
    const lo = this.controls?.minDistance ?? 1, hi = this.controls?.maxDistance ?? Infinity
    this.moveCamera(this.poseAt(azimuth, polar, clamp(distance * factor, lo, hi)), true)
  }

  private poseAt(azimuth: number, polar: number, distance: number): CameraPose {
    const target = (this.controls?.target ?? new Vector3()).clone()
    const position = new Vector3().setFromSpherical(new Spherical(distance, polar, azimuth)).add(target)
    return { position, target }
  }

  private render(interactive = true): void {
    if (this.holdFrames || this.compiling) return
    this.probe?.begin()
    const t0 = this.deps.now?.() ?? performance.now()
    // The world matrices, ONCE per frame. Three recomputes them at the start of EVERY `render()` —
    // yet one frame counts several (the scene, that of the ambient occlusion) plus that of the
    // `CSS2DRenderer`, and nothing moves between them. `matrixWorldAutoUpdate = false` cuts the
    // automatic recomputation; it is we who request it, here, before the first render.
    this.scene.updateMatrixWorld()
    // three's counters reset to zero at every `render()`: with several renders per
    // frame, we must keep them ourselves to read a FRAME total and not that of the last pass.
    if (this.renderer) { this.renderer.info.autoReset = false; this.renderer.info.reset() }
    this.updateFogRange()
    // the caustics first: the basin bottom reads them in this very frame
    if (this.renderer) this.caustics?.update(this.renderer)
    if (this.renderer) this.updateReflection(this.renderer, t0)
    // With an effect chain, it is the chain that calls our render (through `draw`) then its passes;
    // without it, we draw straight to the screen.
    // Only the frames of a gesture WITHOUT a shadow capture tell the safeguard something about the machine.
    if (this.post) this.post.render(interactive && t0 > this.shadowsDirtyUntil && this.shadowFramesPending === 0)
    else if (this.renderer) { this.renderer.setRenderTarget(null); this.renderScene(this.renderer) }
    this.measure(t0, interactive)
    this.updatePillLod()
    this.updatePillFocus()
    if (this.labelsVisible) { this.labelRenderer?.render(this.scene, this.camera); this.markLabelsMoving() }
    this.probe?.end()
  }

  /**
   * ONE pass: the whole scene, lamps included. An indoor lamp only lights its level through
   * the height mask each material carries (`core/levelLight.ts`), no longer through rendering in passes.
   * What remains, as before: within the same level, a lamp still lights through a partition.
   */
  private renderScene(r: WebGLRenderer): void {
    // the mask's slices: the WORLD elevations of the levels (the root may be moved)
    if (this.nodes) setLevelHeights([...this.nodes.levels.values()].map((n) => n.group.matrixWorld.elements[13]!))
    // The shadows are only redone after a scene change, not because the camera turned:
    // the capture redraws the whole structure from the sun, and six more faces per garden lamp.
    const rebuildShadows = (this.deps.now?.() ?? performance.now()) <= this.shadowsDirtyUntil || this.shadowFramesPending > 0
    if (this.shadowFramesPending > 0) this.shadowFramesPending--
    this.perf.shadowsRebuilt = rebuildShadows
    r.shadowMap.autoUpdate = rebuildShadows
    r.render(this.scene, this.camera)
    r.shadowMap.autoUpdate = false
  }

  /** Time spent in `render()`, time spent ELSEWHERE, and rate. Read by the debug overlay. */
  private measure(t0: number, interactive: boolean): void {
    const t1 = this.deps.now?.() ?? performance.now()
    this.perf.cpuMs = this.perf.cpuMs ? this.perf.cpuMs * 0.85 + (t1 - t0) * 0.15 : t1 - t0
    // What separates two frames and was not spent drawing: it is the browser, not us.
    // Only on frames CHAINED by a gesture: between two wake-ups of a decorative animation,
    // the gap is the one we imposed ourselves (20 Hz = 50 ms), and counting it would be lying to ourselves.
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

  /** Rendering is on demand: the distance is only reread when something has moved. */
  private updatePillLod(): void {
    const layer = this.labelRenderer?.domElement
    if (!layer || !this.controls) return
    const d = this.camera.position.distanceTo(this.controls.target)
    // in orthographic the distance no longer says anything about the scale: it is the zoom that carries it
    const pxPerM = this.camera instanceof OrthographicCamera
      ? (this.size.height * this.camera.zoom) / ORTHO_BASE_M
      : this.size.height / (2 * d * Math.tan((this.perspectiveCamera.fov * Math.PI) / 360))
    const lod: PillLod = pxPerM >= PILL_LOD_FULL_MIN_PX_PER_M ? 'full' : pxPerM >= PILL_LOD_ICON_MIN_PX_PER_M ? 'icon' : 'dot'
    if (lod === this.pillLod) return
    this.pillLod = lod
    layer.dataset.lod = lod
  }

  /**
   * The pills follow the tilt-shift's sharp band. They are in the DOM and the image chain's blur
   * does not reach them: sharp above a blurred house, they break the miniature effect.
   *
   * The curve is the shader's (`tiltBlurFactor`), read at the PROJECTED pill's location rather
   * than by digging through the `transform` that `CSS2DRenderer` has just written — a string to re-parse at
   * every frame, and an implementation detail of three. Nothing is done when the effect is off,
   * except the frame that turns it off: that one gives all of them back their sharpness.
   */
  private updatePillFocus(): void {
    const ts = this.look.post.tiltShift
    const band = ts && ts.strength > 0 && ts.pills > 0 ? ts : null
    if (!band && !this.pillsFaded) return
    for (const m of this.markers.values()) {
      if (!band) { m.setPillFocus(1); continue }
      // NDC → UV: +1 at the top is 1, like the shader's `vUv.y`
      const uvY = (m.worldAnchor(this.pillFocusAt).project(this.camera).y + 1) * 0.5
      m.setPillFocus(1 - band.pills * tiltBlurFactor(uvY, band))
    }
    this.pillsFaded = !!band
  }

  setPaused(paused: boolean): void { this.loop.setPaused(paused) }

  dispose(): void {
    this.shapeEditor?.dispose()
    this.shapeEditor = null
    this.photoGen++                        // a material that arrives afterward has no scene left to dress
    this.prepareGen++                      // …and a preparation in progress, no house left to show
    this.compileGen++                      // …nor a compilation, no frame left to hold
    this.detachInput?.()
    this.detachWheel?.()
    if (this.labelsIdle !== null) clearTimeout(this.labelsIdle)
    if (this.stormTimer !== null) { clearTimeout(this.stormTimer); this.stormTimer = null }
    this.removePrecipitation()
    this.removeBats()
    this.removeDisco()
    this.removeParade()
    this.drag?.detach()
    this.openingDragger?.detach()
    this.gardenDragger?.detach()
    if (this.gardenFrame !== 0) cancelAnimationFrame(this.gardenFrame)
    this.garden.dispose()
    if (this.openingFrame !== 0) cancelAnimationFrame(this.openingFrame)
    if (this.reliefFrame !== 0) cancelAnimationFrame(this.reliefFrame)
    this.loop.dispose()
    this.controls?.dispose()
    this.clear()
    this.post?.dispose()
    disposeMaterials(this.materials)
    this.caustics?.dispose()
    this.reflection?.dispose()
    if (this.reflectionTimer !== null) clearTimeout(this.reflectionTimer)
    this.skyEnv?.dispose()
    this.renderer?.dispose()
    if (this.labelRenderer) this.labelRenderer.domElement.replaceChildren()
  }
}

/**
 * The outline and the inside of a rectangular frame of `w` × `h`, `b` wide: the two polygons
 * that `flatRing` and `extrudeRing` expect. The width is bounded to a fifth of the smallest
 * dimension — on an 80 cm bathroom window, a 7.5 cm frame already eats into the glass.
 */
function frameRect(w: number, h: number, b: number): [Vec2[], Vec2[]] {
  const x = w / 2, y = h / 2, t = Math.min(b, w * 0.2, h * 0.2)
  return [
    [[-x, -y], [x, -y], [x, y], [-x, y]],
    [[-x + t, -y + t], [x - t, -y + t], [x - t, y - t], [-x + t, y - t]],
  ]
}

/**
 * A label the scene writes itself: the name of an opening, one of its two dimensions, or the
 * letter of an axis of the origin marker.
 *
 * INLINE styles and not a class from `styles/app.css`: the application stylesheet belongs to
 * the interface, and the scene already knows how to dress itself (`core/theme.ts`). The colors are taken from the
 * theme variables, so both themes work with nothing more.
 *
 * A dimension has FIXED-WIDTH digits and a minimum width: "0.35 m" then "1.40 m" must
 * not make the label dance under the finger, precisely when its
 * value changes ten times per second.
 */
function sceneNote(kind: 'name' | 'gap' | 'axis'): CSS2DObject {
  const el = document.createElement('div')
  el.className = `scene-note scene-note--${kind}`
  el.style.cssText = [
    'pointer-events:none;position:absolute;left:0;top:0;transform:translate(-50%,-50%)',
    'padding:3px 8px;border-radius:8px;white-space:nowrap;font:600 11px/1.25 var(--font)',
    kind === 'axis'
      // an axis is named by a letter: no box around it, just the letter readable against sky
      // as against lawn (a drop shadow, not a background)
      ? 'color:var(--accent);font:700 12px/1 var(--font);text-shadow:0 1px 3px rgba(0,0,0,.55),0 0 2px rgba(0,0,0,.4)'
      : kind === 'name'
      ? 'background:var(--accent);color:var(--on-accent);border:1px solid transparent;max-width:220px;overflow:hidden;text-overflow:ellipsis'
      // 66 px: the width of "12.34 m" in this font, fixed-width digits — beyond ten
      // meters, a house wall no longer exists. The box therefore does not move by a pixel during the gesture.
      : 'background:color-mix(in srgb, var(--surface) 92%, transparent);color:var(--text);border:1px solid var(--line);font-variant-numeric:tabular-nums;min-width:66px;text-align:center',
  ].join(';')
  return new CSS2DObject(el)
}

/** Visible FOR REAL: a visible object in a hidden group (a level above) is not. */
function shownInScene(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false
  return true
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
