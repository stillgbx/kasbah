import {
  AmbientLight, Color, DirectionalLight, DoubleSide, HemisphereLight, MOUSE, OrthographicCamera, PerspectiveCamera, Plane, Raycaster, Scene, Shape, ShapeGeometry, Spherical, type Intersection, type Texture, TOUCH, Vector2, Vector3, VSMShadowMap,
  WebGLRenderer, Box3, BoxGeometry, Fog, Mesh, MeshBasicMaterial, type Material, type MeshPhysicalMaterial, type MeshStandardMaterial, type Object3D,
  Group, SphereGeometry, CylinderGeometry, RingGeometry, Frustum, Matrix4, Sphere, PointLight,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  boundsCenter, buildingBounds, computeHouseGeometry, deviceFloorZ, emptyReliefGrid, isFlatRelief, parseRelief, serializeRelief, terrainHeight, geoDistance, indexHouse, longestEdgeYawDeg, offsetPolygon, pointInPolygon, resolveDefaults, resolveDeviceLevelId, sitePosition,
  roofBounds, roomBounds, zoneBounds, openingCentre, openingGaps, openingLabel, planLength, surfaceAxes, surfaceGaps,
  assignParkings, atRest, mirekToRgb, xyToRgb, parkingGaps, parkingHost, parkingLabel, PARKING_SIDES,
  type DeviceDescriptor, type DeviceState, type House, type HouseDevice, type HouseGeometry, type HouseIndex, type Level, type OpeningRect, type Parking, type ParkingFix, type ParkingSide, type PlacedHouseDevice, type Relief, type ReliefGrid, type Vec2, type Vec3,
} from '@kasbah/shared'
import { applyLook, backdropColor, createMaterials, disposeMaterials, type MaterialSet } from './builders/materials'
import type { SurfaceRole } from './textures/procedural'
import { loadPackTextures, packById, packTexturesSettled, type TexturePack } from './textures/assets'
import { createSkyEnvironment, overcastSky } from './core/sky'
import { DECOR_LAYER, SITE_DECOR_LAYER } from './core/layers'
import { setLevelHeights } from './core/levelLight'
import { setHeightMist } from './core/heightMist'
import { materialOpacity, setLevelFade } from './core/levelFade'
import { roomFocusUniforms, setRoomFocusShape, setRoomFocusStrength } from './core/roomFocus'
import { createPostPipeline, detectQuality, gpuName, PIXEL_RATIO, tiltBlurFactor, toneMappingOf, type EffectiveQuality, type PostPipeline, type RenderQuality } from './core/post'
import { dayFactor, fogDistance, sunDirection, type SceneAmbience } from './core/ambience'
import { Bats } from './effects/bats'
import { Precipitation } from './effects/precipitation'
import { createWaterUniforms, makeWaterAlive, setWaterSun, setWaterTint, setWaterWind, WaterCaustics, type WaterStrength } from './effects/water'
import { defaultAmbience, defaultSceneTheme, rolesOf, styleById, type GlowLook, type PostLook, type RenderStyle, type StyleLook } from './styles'
import { applyTuning, NEUTRAL_TUNING, type SceneTuning } from './styles/tuning'
import { buildHouse, buildLevel, buildRoofMesh, shapeTerrain, type HouseNodes, type LevelNodes } from './builders/buildHouse'
import { ReliefEditor } from './relief/reliefEditor'
import { GardenLayer } from './garden/gardenLayer'
import type { Season } from './garden/season'
import { buildParking, parkingGlyphTexture, parkingMaterials, type ParkingMaterials, type ParkingNodes } from './builders/parking'
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

// Contrôleur de scène sans Vue. Dépendances injectables (renderer, RAF) → instanciable en Node
// pour les tests sans WebGL. Le composable useHouseScene est son adaptateur réactif.

export type LevelFocusMode = 'hide' | 'ghost'

export interface HouseSceneOptions {
  levelFocusMode: LevelFocusMode
  shadows: boolean
  /** Budget du post-traitement. `auto` mesure la machine puis se corrige (`core/post.ts`). */
  quality: RenderQuality
  /** Perspective, orthographique libre, ou isométrie verrouillée (`core/cameraFit.ts`). */
  projection: SceneProjection
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
  /** Banc de réglage de la lumière (`styles/tuning.ts`) : multiplicateurs posés sur le look du style. */
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
  /** Appels de dessin et triangles d'UNE image, tous rendus compris (scène, occlusion, effets). */
  calls: number
  triangles: number
  programs: number
  geometries: number
  textures: number
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

/** Points de vue de l'éditeur du relief : depuis un point cardinal, ou d'aplomb. */
export type TerrainView = 'north' | 'east' | 'south' | 'west' | 'top'

/** L'édition du relief vue du panneau : hauteur du point choisi (cm), brouillon (`null` = plat). */
export interface ReliefEditState {
  pointCm: number | null
  draft: Relief | null
  canUndo: boolean
  canRedo: boolean
  /** Dernier point choisi au tap (`seq` croît à chaque tap) et le pointeur qui l'a choisi. */
  pick: { seq: number; by: string }
}

export interface SceneEvents {
  deviceTap: (key: string) => void
  roomTap: (roomId: string) => void
  zoneTap: (zoneId: string) => void
  /** Tap sur le toit : le niveau qui le porte (il n'a ni pièce ni sol à toucher). */
  levelTap: (levelId: string) => void
  /** Tap sur une épingle du journal (un incident posé sur le terrain) : sa date, qui l'identifie. */
  journalTap: (at: number) => void
  backgroundTap: () => void
  /** Glissement de l'appareil déplaçable : position au sol (repère maison) et pièce survolée (même niveau) ou null. */
  deviceDrag: (key: string, xy: [number, number], roomId: string | null) => void
  deviceDrop: (key: string, xy: [number, number], roomId: string | null) => void
  /** Tap sur la poignée d'une ouverture (mode édition seulement). */
  openingTap: (openingId: string) => void
  /**
   * Glissement de l'ouverture SÉLECTIONNÉE : le point du doigt projeté sur le plan du SOL de son
   * niveau, en repère maison. C'est l'appelant qui en déduit un mur et une distance depuis le coin
   * (`slotFromPoint`) — la scène ne connaît pas les places admissibles.
   */
  openingDrag: (openingId: string, xy: [number, number]) => void
  openingDrop: (openingId: string) => void
  /**
   * Mur tapé pendant qu'une ouverture est armée (mode « poser ») : le point touché sur le bâti, en
   * repère maison. Comme pour le glissement, c'est l'appelant qui en déduit un mur et une distance
   * depuis le coin — la scène dit OÙ ON A TAPÉ, pas où l'ouverture a le droit d'aller.
   */
  placeTap: (xy: [number, number]) => void
  /**
   * Point du SOL touché pendant qu'une place de stationnement est armée : le sol d'une pièce, le
   * terrain ou une zone, en repère maison. Une place se pose à plat — il n'y a pas de mur à viser,
   * donc pas de règle d'admissibilité à appliquer, contrairement à une ouverture.
   */
  groundTap: (xy: [number, number], levelId: string | null) => void
  /**
   * L'édition du relief a bougé (entrée, glissement, import) ; `null` en sortant du mode.
   * `draft` = le brouillon tel qu'il s'écrirait, `null` s'il est plat.
   */
  reliefChange: (state: ReliefEditState | null) => void
  /** Tap sur une place de stationnement (mode édition seulement). */
  parkingTap: (parkingId: string) => void
  /**
   * Glissement de la place SÉLECTIONNÉE : le point du doigt projeté sur le sol, en repère maison.
   * C'est le centre voulu — une place au sol n'a pas de contrainte d'accueil, contrairement à une
   * ouverture qui doit trouver un mur.
   */
  parkingDrag: (parkingId: string, xy: [number, number]) => void
  parkingDrop: (parkingId: string) => void
  /** Tap sur un élément du jardin (mode édition seulement). */
  gardenTap: (itemId: string) => void
  /** Glissement de l'élément du jardin SÉLECTIONNÉ : son nouveau pied, en repère maison. */
  gardenDrag: (itemId: string, xy: [number, number]) => void
  gardenDrop: (itemId: string) => void
  /** Élément du jardin armé : le point du TERRAIN touché (un sol de pièce ou un toit n'en est pas un). */
  gardenPlaceTap: (xy: [number, number]) => void
  /**
   * La maison se prépare avant d'être montrée (voir `prepare`) : l'étape en cours, avec son compte
   * quand elle en a un (les matières), puis `null` quand elle est prête.
   */
  prepare: (stage: ScenePrepareStage | null, progress: { done: number; total: number } | null) => void
}

/** Les étapes de la préparation d'une maison, dans l'ordre. */
export type ScenePrepareStage = 'materials' | 'shaders' | 'frame'

/**
 * Après une image PEINTE : le rappel d'un `requestAnimationFrame` précède la peinture de son image,
 * celui du suivant la suit.
 */
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

/** Au-delà, la maison se montre même si des matières photo sont encore en route (réseau lent, fichier absent). */
const PREPARE_PHOTOS_MS = 10_000
/** Au-delà, la maison se montre même si des shaders compilent encore (la première image les finira). */
const PREPARE_SHADERS_MS = 30_000

const HOME_RADIUS_M = 120
/** Émission d'une fenêtre dont la pièce est éclairée à fond, la nuit ; et son opacité alors. */
const WINDOW_GLOW = 0.65
const WINDOW_LIT_OPACITY = 0.6
/** Portée (m) du brouillard quand l'air est clair : au-delà de tout ce que la scène dessine (sol infini : 400 m). */
const NO_FOG_M = 1e6
/** Part du ciel d'en haut (hémisphère) dans la couleur de la brume basse. */
const MIST_SKY_SHARE = 0.35
/** Hauteur (m) de l'étiquette d'une place au-dessus du sol, et celle de ses quatre cotes. */
const PARKING_NOTE_LIFT_M = 0.9
const PARKING_COTE_LIFT_M = 0.12
/** Côté de la boîte cadrée autour d'un appareil sélectionné : lui de près, sa pièce autour. */
const DEVICE_FOCUS_SIZE_M = 3
/** Têtes d'épingle du journal : les teintes de gravité de l'UI (`lib/journal.ts`), en nombres pour Three. */
const JOURNAL_PIN_COLORS: Record<string, number> = { info: 0x8a94a6, warning: 0xd38b22, error: 0xd24a43, fatal: 0xd24a43 }
/** Inclinaison permise en cadrant un appareil : plongeante, pour voir par-dessus les murs. */
const DEVICE_FOCUS_POLAR = [(20 * Math.PI) / 180, (40 * Math.PI) / 180] as const
const DEFAULT_AZIMUTH = -Math.PI / 4     // depuis le sud-est
/** Ce qu'un appareil peut être « derrière » son mur et gagner quand même le tap (une applique y est collée). */
const WALL_PICK_TOLERANCE_M = 0.05
/** Champ vertical de la perspective (et le champ de référence de l'orthographique). */
const BASE_FOV_DEG = 38
/** Bornes de la molette, à ce champ-là ; un champ plus étroit les recule d'autant. */
const MIN_DISTANCE_M = 4
const MAX_DISTANCE_M = 120
const DEFAULT_POLAR = (55 * Math.PI) / 180
/** Cadrage d'un niveau-toit : plus plongeant que les autres, on vient regarder la dalle elle-même. */
const ROOF_POLAR = (35 * Math.PI) / 180
/** Un éclair : facteur d'exposition et durée (ms) de chaque éclat — deux éclats, le second plus long. */
const FLASH: readonly (readonly [number, number])[] = [[2.6, 70], [1, 90], [1.9, 120]]
/** Entre deux éclairs, au hasard dans cette fourchette (ms). */
const FLASH_EVERY_MS: readonly [number, number] = [6000, 16000]
/** Plafond du volume où il pleut, au-dessus du sol de la maison (m) : au-dessus des toits, sous la caméra d'ensemble. */
const PRECIP_HEIGHT_M = 14
/**
 * Cadence de l'eau vivante (`effects/water.ts`), en images par seconde. Une houle de piscine avance
 * lentement : à 10 Hz l'œil ne voit pas la marche, et c'est deux fois moins d'images COMPLÈTES à
 * dessiner qu'une averse.
 */
const WATER_HZ = 10
const WORLD_UP = new Vector3(0, 1, 0)
/** Pas de la grille d'un relief créé dans l'éditeur (m) : ~900 poignées sur la parcelle, assez pour une bosse. */
const RELIEF_STEP = 2
/** Part visible de la maison pendant qu'on modèle le terrain : assez pour se repérer, pas pour gêner. */
const RELIEF_HOUSE_OPACITY = 0.5
/** De quoi tester la piscine contre le champ de la caméra sans rien allouer par mouvement. */
const waterFrustum = new Frustum()
const waterMatrix = new Matrix4()
const waterSphere = new Sphere()
const WHITE = new Color(0xffffff)
/**
 * Poignée d'une ouverture en mode édition : une dalle qui remplit son rectangle et déborde de
 * l'épaisseur du mur, et un cadre qui la cerne (voir `OPENING_RING` pour sa largeur).
 */
/**
 * De combien la poignée d'une ouverture DÉBORDE de chaque face du mur (m). Elle s'attrape ainsi de
 * l'intérieur comme de l'extérieur sans viser, et surtout son cadre au repos, qui est soumis à la
 * profondeur, reste visible quand on regarde la façade de biais : à ras du mur, la face extérieure le
 * masquait (constaté sur un mur de 30 cm, là où la poignée en faisait autant).
 */
const OPENING_HANDLE_PROUD_M = 0.09
/**
 * Largeur vue du cadre d'une poignée : FIN au repos, épais pour celle qu'on règle. C'est l'épaisseur
 * qui porte l'écart entre les deux — une nuance d'intensité ne suffisait pas à les distinguer, et
 * retirer le cadre au repos rendait les autres ouvertures introuvables.
 */
const OPENING_RING = { rest: 0.035, on: 0.075 } as const
/** De combien le nom de l'ouverture réglée flotte au-dessus d'elle (m) : dégagé du linteau. */
const OPENING_NOTE_LIFT_M = 0.18
/**
 * Le repère d'origine du fichier (mode édition) : rayon de l'anneau, épaisseur des barres, longueur
 * des deux axes et de la flèche du nord — en mètres. À l'échelle d'une pièce, pas d'un bâtiment : un
 * trièdre de logiciel de CAO au milieu d'une maquette n'aurait rien à y faire.
 */
const ORIGIN_MARK = { ring: 0.24, bar: 0.05, axis: 1.1, north: 0.7 } as const
/**
 * Ligne de cote d'une ouverture : épaisseur du trait, hauteur des tirets qui la ferment à chaque
 * bout, et de combien le nombre flotte au-dessus d'elle (m).
 */
const COTE = { bar: 0.035, tick: 0.2, lift: 0.14 } as const
/** Jusqu'où le cadrage d'une ouverture suit ses cotes (m) : au-delà, le bout du trait n'apprend rien. */
const OPENING_FOCUS_REACH_M = 2
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
/** Images dessinées au minimum qui refont les ombres après une demande (la VSM filtre sur deux passes). */
const SHADOW_MIN_FRAMES = 2
/**
 * L'envol d'un étage qu'on masque (`liftTo`) : de combien il monte avant de disparaître, et en
 * combien de temps — un peu moins que le vol de la caméra (650 ms), qu'il accompagne.
 */
const LEVEL_LIFT_M = 8
const LEVEL_LIFT_MS = 450
/** Marge (m) du seuil du fondu au-dessus du niveau qui reste : jamais une limite posée sur une face. */
const LEVEL_FADE_MARGIN_M = 0.03
/**
 * Les pilules qui APPARAISSENT attendent que l'étage ait commencé à se dégager : leur fondu part à ce
 * délai et dure un peu plus que le vol. Celles qui partent suivent le vol (`LEVEL_LIFT_MS`).
 */
const PILL_IN_DELAY_MS = 150
const PILL_IN_MS = 550
/** La pièce qu'on regarde : durée du fondu du reste de la maison, et épaisseur de dalle comprise sous son sol. */
const ROOM_FOCUS_MS = 300
const ROOM_FOCUS_SLAB_M = 0.35
/** Marge (m) entre le masque et les surfaces de la pièce : jamais une limite posée sur une face. */
const ROOM_FOCUS_MARGIN_M = 0.12
/** Délai après lequel les étiquettes sont considérées immobiles (et leur promotion relâchée). */
const LABELS_IDLE_MS = 500

export class HouseScene {
  readonly scene = new Scene()
  /**
   * La caméra ACTIVE. Elle change d'espèce avec la projection (`setOptions({ projection })`) : les
   * deux gardent la même pose, seul le tronc diffère. Ce qui la lit à chaque image — lancer de
   * rayon, étiquettes, chaîne d'image — n'a pas à savoir laquelle des deux elle est.
   */
  camera: PerspectiveCamera | OrthographicCamera
  /** Celle qui porte le champ de vision de référence : même en orthographique, c'est lui qui pose les distances. */
  private readonly perspectiveCamera: PerspectiveCamera
  /** Bâtie au premier passage en orthographique, gardée ensuite (l'aller-retour est un réglage, pas une animation). */
  private orthoCamera: OrthographicCamera | null = null
  readonly renderer: WebGLRenderer | null
  readonly labelRenderer: CSS2DRenderer | null
  readonly controls: OrbitControls | null
  readonly loop: RenderLoop
  readonly markers = new Map<string, DeviceMarker>()
  /**
   * Les incidents du journal d'un appareil, posés sur le terrain le temps que le panneau les montre :
   * chaque épingle avec sa tête (touchable), son étiquette (visible seulement quand elle est ACTIVE)
   * et sa date, qui l'identifie.
   */
  private journal: { group: Group; points: { at: number; anchor: Object3D; head: Mesh; label: CSS2DObject | null }[]; pickables: Object3D[]; active: number | null } | null = null
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
  /** Jeton de la préparation en cours : un nouveau chargement (ou la fin de la scène) l'invalide. */
  private prepareGen = 0
  private preparing = false
  /**
   * Aucune image pendant la préparation. Une seule image rendue avant la fin de `compileAsync`
   * compile TOUT d'un bloc, sur le fil principal : 9 s figées au premier chargement (cache de
   * shaders froid, iGPU), le voile compris — mesuré le 2026-09-25.
   */
  private holdFrames = false
  /** Des shaders demandés APRÈS le chargement (un style, une matière photo) se compilent : l'ancienne image reste. */
  private compiling = false
  private compileGen = 0
  private post: PostPipeline | null = null
  private quality: EffectiveQuality = 'high'
  /** Le cran où le garde-fou est descendu en « auto » ; `null` = la détection décide. Le réglage, lui, reste « auto ». */
  private autoQuality: EffectiveQuality | null = null
  /** Minuterie de l'orage en cours (prochain éclat, ou éclat en train de s'éteindre) ; `null` = pas d'orage. */
  private stormTimer: ReturnType<typeof setTimeout> | null = null
  /** Pluie ou neige en cours (`effects/precipitation.ts`), de quoi retirer son animation, et l'intensité avec laquelle elle a été bâtie. */
  private precip: Precipitation | null = null
  private stopPrecip: (() => void) | null = null
  /** Chauves-souris du style (`effects/bats.ts`), et de quoi retirer leur animation. */
  private bats: Bats | null = null
  private stopBats: (() => void) | null = null
  private precipIntensity = 0
  /**
   * L'eau vivante (`effects/water.ts`) : un temps PARTAGÉ par la surface et le fond — crêtes et
   * caustiques battent ensemble —, la force de chacun, et de quoi retirer l'animation. Les deux
   * matériaux sont patchés une fois pour toutes ; c'est la force qui dit si l'eau bouge. La carte
   * des caustiques n'existe qu'avec un renderer (pas en headless).
   */
  private readonly water = createWaterUniforms()
  private caustics: WaterCaustics | null = null
  private readonly waterStrength: { surface: WaterStrength; basin: WaterStrength }
  private stopWater: (() => void) | null = null
  /** Direction d'où vient la lumière du jour, monde three : l'heure de l'ambiance ET le cap de la maison. */
  private get sunDir(): Vector3 { return sunDirection(this.ambience, undefined, this.headingDeg) }
  /**
   * Le cap du +y du plan (`origin.heading`) : la météo compte ses directions depuis le nord VRAI, la
   * scène depuis le haut du plan. Soleil, pluie et houle le retranchent.
   */
  private get headingDeg(): number { return this.house?.origin.heading ?? 0 }
  /**
   * Les ombres ne dépendent PAS de la caméra : les refaire à chaque image pendant qu'on tourne
   * autour de la maison, c'est redessiner tout le bâti pour rien. Elles se refont pendant un court
   * moment après un changement de scène — le temps qu'une course de volet s'achève.
   */
  private shadowsDirtyUntil = 0
  /** Images dessinées qui refont encore les ombres, quel que soit le temps écoulé (`invalidateShadows`). */
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
  /** Le trait et le voile posés sur la pièce sélectionnée (`highlightRoom`), dans le groupe de son niveau. */
  private highlightMeshes: Mesh[] = []
  private selectedKey: string | null = null
  private listeners: { [K in keyof SceneEvents]: Set<SceneEvents[K]> } = {
    deviceTap: new Set(), roomTap: new Set(), zoneTap: new Set(), levelTap: new Set(), backgroundTap: new Set(),
    deviceDrag: new Set(), deviceDrop: new Set(), journalTap: new Set(),
    openingTap: new Set(), openingDrag: new Set(), openingDrop: new Set(), placeTap: new Set(),
    parkingTap: new Set(), parkingDrag: new Set(), parkingDrop: new Set(), groundTap: new Set(), reliefChange: new Set(), prepare: new Set(),
    gardenTap: new Set(), gardenDrag: new Set(), gardenDrop: new Set(), gardenPlaceTap: new Set(),
  }
  private detachInput: (() => void) | null = null
  /** Retire le relais de molette posé sur la couche des étiquettes (`forwardWheelFromLabels`). */
  private detachWheel: (() => void) | null = null
  private movableKeys: string[] = []
  /** Marqueur effectivement attrapé parmi les déplaçables (les modules d'un champ bougent ensemble). */
  private grabbedKey: string | null = null
  private drag: DragDetector | null = null
  private readonly dragPlane = new Plane()
  private readonly dragOffset = new Vector3()
  private lastDrag: { xy: [number, number]; roomId: string | null } | null = null
  /**
   * Mode « régler les ouvertures » : une poignée par ouverture, vivante seulement dans ce mode —
   * hors édition la scène est exactement celle d'avant. Seule la SÉLECTIONNÉE se glisse, comme un
   * seul appareil se déplace à la fois.
   */
  private editingOpenings = false
  private selectedOpeningId: string | null = null
  /** Pièce dont on attend qu'on tape un mur pour y poser une ouverture neuve (mode « poser »). */
  private placingOpening: { roomId: string; type: string } | null = null
  /** Cône de cap pendant la pose d'une fenêtre de toit / puits de lumière. */
  private placingYawGuide: Mesh | null = null
  /** Ouvertures dont un ouvrant porte le vantail (`dressedOpenings`), telles que les murs ont été bâtis. */
  private dressed: ReadonlySet<string> = new Set<string>()
  private openingHandles = new Map<string, { group: Group; fill: Mesh; ring: Mesh; ringOn: Mesh; rect: OpeningRect }>()
  /** Cinq matériaux pour toutes les poignées : la sélection n'est qu'un échange de matériau. */
  private openingMats: {
    fill: MeshBasicMaterial; fillOn: MeshBasicMaterial
    ring: MeshBasicMaterial; ringOn: MeshBasicMaterial
    /** Ce qui ÉTEINT un cadre : un matériau invisible, jamais `Object3D.visible` (voir `styleOpeningHandles`). */
    off: MeshBasicMaterial
  } | null = null
  private openingDragger: DragDetector | null = null
  /** Le repère d'origine du fichier (`buildOriginMark`), vivant avec le mode édition. */
  private originMark: { group: Group; labels: CSS2DObject[] } | null = null
  /** Nom et cotes de l'ouverture réglée (`refreshOpeningNotes`), et le groupe d'étiquettes qui les porte. */
  private openingNotes: {
    name: CSS2DObject
    /** Mur : [droite, gauche]. Surface : front, back, left, right. */
    gaps: CSS2DObject[]
    parent: Group
    /** Le tracé des cotes : un trait et deux tirets chacune. */
    cotes: Group
    lines: { line: Mesh; a: Mesh; b: Mesh }[]
    host: 'wall' | 'surface'
  } | null = null
  /** Dernière position du doigt pas encore rapportée, et l'image où elle le sera (0 = aucune en attente). */
  private pendingOpeningXY: [number, number] | null = null
  private openingFrame = 0
  /**
   * Places de stationnement : leur dessin au sol vit TOUJOURS (c'est du marquage, pas une poignée),
   * mais seul le mode édition les rend touchables et glissables — comme les ouvertures.
   */
  private editingParkings = false
  private selectedParkingId: string | null = null
  /** Une place est ARMÉE : le prochain tap au sol dit où elle se pose (mode « poser »). */
  private placingParking = false
  private parkingNodes = new Map<string, ParkingNodes>()
  private parkingMats: ParkingMaterials | null = null
  /** Le « P » du marquage : une texture pour toutes les places, refaite avec le thème. */
  private parkingGlyph: Texture | null = null
  private parkingDragger: DragDetector | null = null
  private pendingParkingXY: [number, number] | null = null
  private parkingFrame = 0
  /** Nom et quatre cotes de la place réglée, en DOM : gardées d'une image à l'autre (`refreshParkingNotes`). */
  private parkingNotes: { name: CSS2DObject; sides: Record<ParkingSide, CSS2DObject>; parent: Group } | null = null
  /**
   * Où chaque engin placé par son GPS se RANGE, quand il est au repos près d'une place compatible
   * (`assignParkings`). Recalculé avec les marqueurs — c'est lui qui remplace le point du relevé.
   */
  private parkingFixes = new Map<string, ParkingFix>()
  /** Arbres, buissons, pierres : un calque gardé d'une maison à l'autre, reposé sur chaque site neuf. */
  private garden = new GardenLayer()
  /** Saison du jardin (feuillage, fleurs, fruits), résolue par l'appelant (`auto` suit la date). */
  private season: Season = 'summer'
  private editingGarden = false
  private selectedGardenId: string | null = null
  private placingGarden = false
  private gardenDragger: DragDetector | null = null
  private pendingGardenXY: [number, number] | null = null
  private gardenFrame = 0
  /**
   * Relief en cours d'édition (brouillon), `null` hors du mode. Il survit à un rechargement de la
   * maison ; l'éditeur, lui, vit et meurt avec les nœuds de la scène.
   */
  private reliefGrid: ReliefGrid | null = null
  private reliefEditor: ReliefEditor | null = null
  private reliefFrame = 0
  /** Le mode est demandé ; il s'ouvre dès qu'une maison est chargée. */
  private reliefWanted = false
  /** Matières du bâti estompées pendant qu'on modèle le terrain, rendues pleines en sortant. */
  private reliefFaded = new Set<Material>()
  private readonly raycaster = new Raycaster()
  private size = { width: 1, height: 1 }
  private cameraTween: { cancel(): void } | null = null
  /** Où en est chaque étage (et le toit) de son envol : voir `liftTo`. */
  private readonly lifts = new Map<string, { offset: number; shown: boolean; tween: Tween | null }>()
  /** Hauteur monde au-dessus de laquelle les étages en vol s'effacent (`core/levelFade.ts`). */
  private fadeCutY = Infinity
  /** Où va la mise en valeur de la pièce (`core/roomFocus.ts`) : 0 ou 1, et la course en cours. */
  private roomFocusTarget = 0
  private roomFocusTween: Tween | null = null
  /** Ce que chaque pilule de niveau doit montrer, et le fondu en cours (`fadePills`). */
  private pillTargets = new WeakMap<DeviceMarker, boolean>()
  private pillFading: [DeviceMarker, boolean][] = []
  private pillTween: Tween | null = null
  private readonly deps: HouseSceneDeps
  private readonly sun: DirectionalLight
  private readonly hemi: HemisphereLight
  /** Lampes ÉTEINTES qui tiennent la place des lampes des niveaux masqués : voir `padLamps`. */
  private readonly lampPadding = new Group()
  private readonly ambient: AmbientLight
  /** Largeur (px) du bord droit du canvas couverte par le panneau flottant : le cadrage vise la partie libre. */
  private viewInsetRight = 0
  /** Ce que reflète une carrosserie. Propre aux véhicules : la maison, elle, n'a pas d'environnement. */
  private skyEnv: Texture | null = null
  /** Vrai tant qu'une pilule au moins porte une opacité du tilt-shift, donc qu'il y a à défaire. */
  private pillsFaded = false
  /** Réutilisé à chaque image par `updatePillFocus` : un vecteur par marqueur et par image, non. */
  private readonly pillFocusAt = new Vector3()
  /** Banc de réglage : neutre tant que les Réglages n'ont rien posé (`styles/tuning.ts`). */
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
    // Voir `render()` : les matrices monde se mettent à jour une fois par image, pas une fois par rendu.
    this.scene.matrixWorldAutoUpdate = false
    this.perspectiveCamera = new PerspectiveCamera(BASE_FOV_DEG, 1, 0.1, 500)
    this.camera = this.perspectiveCamera
    this.camera.position.set(20, 18, 20)
    // halos, ondes, jauges — d'un niveau et du jardin (`core/layers.ts`)
    for (const l of [DECOR_LAYER, SITE_DECOR_LAYER]) this.camera.layers.enable(l)
    // Le lancer de rayon ne teste QUE des listes explicites (jamais l'arbre) : lui ouvrir la couche
    // des décors ne rend donc rien de plus touchable, mais c'est ce qui permet d'attraper la poignée
    // d'une ouverture, qui y vit pour être dessinée APRÈS les murs de son niveau. Sans cette ligne,
    // `Raycaster` ne voit que la couche 0 et le glissement ne démarre jamais (constaté).
    this.raycaster.layers.enable(DECOR_LAYER)

    const create = deps.createRenderer ?? defaultCreateRenderer
    this.renderer = deps.headless ? null : create(canvas)
    this.supported = deps.headless ? true : this.renderer !== null
    // VSM (Variance Shadow Maps) et non PCFSoftShadowMap : depuis three 0.184 ce dernier est
    // déprécié et retombe sur du PCF DUR (bords crénelés) avec un avertissement en console.
    // VSM floute nativement, piloté par `shadow.radius` / `shadow.blurSamples`.
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
      // bornes de distance, plongée, rotation, molette et doigts dépendent de la projection : un seul endroit les pose
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
   * La molette posée SUR une pilule ne zoomait pas. Une pilule est cliquable, donc
   * `pointer-events: auto` (`styles/app.css`), donc elle reçoit aussi la molette — et
   * `OrbitControls`, qui écoute le CANVAS, ne la voit jamais. Sur une maison de quarante appareils,
   * l'écran en est constellé : le zoom devenait intermittent sans raison visible.
   *
   * L'événement est donc repassé au canvas tel quel, position comprise (le zoom vise le curseur).
   * Seule la MOLETTE : un glissement parti d'une pilule reste ambigu — c'est peut-être un appui sur
   * la pilule — alors qu'une molette sur une étiquette n'a aucun autre sens que « zoomer ».
   */
  private forwardWheelFromLabels(layer: HTMLElement | null): (() => void) | null {
    if (!layer || typeof WheelEvent === 'undefined') return null
    const onWheel = (e: WheelEvent) => {
      if (e.target === layer) return            // le vide entre les pilules : le canvas l'a déjà eu
      e.preventDefault()
      this.canvas.dispatchEvent(new WheelEvent('wheel', {
        deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ, deltaMode: e.deltaMode,
        clientX: e.clientX, clientY: e.clientY, bubbles: false, cancelable: true,
      }))
    }
    layer.addEventListener('wheel', onWheel, { passive: false })
    return () => layer.removeEventListener('wheel', onWheel)
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
    const turned = this.headingDeg !== house.origin.heading
    this.clear()
    this.house = house
    this.index = indexHouse(house)
    this.geometry = computeHouseGeometry(house)
    this.dressed = this.dressedOpenings()
    this.nodes = buildHouse(this.geometry, this.materials, this.dressed)
    if (this.reliefWanted && !this.reliefGrid) this.reliefGrid = parseRelief(house.site.relief) ?? emptyReliefGrid(house.site.terrain, RELIEF_STEP)
    this.applyReliefDraft()                // un relief en cours d'édition passe avant celui du fichier
    if (this.reliefGrid) { this.syncReliefFocus(); this.emitRelief() }
    this.invalidateShadows()
    this.nodes.terrain.receiveShadow = true
    this.scene.add(this.nodes.root)
    this.syncPrecipitation()               // la racine est neuve : ce qui tombe se repose dessus
    this.syncBats()
    this.applyMist()                       // la nappe se pose sur CE terrain
    if (turned) this.applySky()            // le soleil du ciel suit le cap de la maison
    this.fitSunShadow()
    this.buildParkings()                   // le marquage au sol vit avec le terrain, avant les marqueurs
    this.buildGarden()
    this.buildMarkers()
    this.syncWindowGlow()                  // les verres sont neufs : ils reprennent le style et les lampes
    this.buildOpeningHandles()             // la racine est neuve : le mode édition repose ses poignées
    this.buildOriginMark()                 // …son repère d'origine…
    this.refreshOpeningNotes()             // …et ses étiquettes, qui vivent dans un groupe jeté avec elle
    const c = this.geometry.bounds
    this.controls?.target.set((c.min[0] + c.max[0]) / 2, 0, -(c.min[1] + c.max[1]) / 2)
    this.applyLevelFocus()
    if (firstLoad) this.resetView(false)
    this.syncWater()                       // après le cadrage : la piscine est-elle DANS le champ ?
    this.loop.invalidate()
    void this.prepare()
  }

  /** La maison se prépare encore (voir `prepare`) : le voile de chargement la cache. */
  get preparingHouse(): boolean { return this.preparing }

  /**
   * Prépare la maison qu'on vient de construire AVANT qu'on la regarde : les matières photo, puis
   * les shaders (`compileAsync`, qui compile en parallèle quand le pilote le permet), puis une
   * première image — elle compile ce que `compileAsync` ne voit pas : la chaîne d'effets et le
   * relevé des ombres. Sans ça, tout se compilait à la première image, et chaque matière photo
   * arrivée ensuite recompilait sa matière : autant d'images figées au premier geste. Le rendu est
   * le même ; seul le MOMENT où ces compilations sont payées change, sous le voile de chargement.
   *
   * Ne couvre que l'état du chargement : un autre style, la pluie, une lampe de jardin allumée plus
   * tard peuvent encore demander leur variante.
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
      // les matières photo d'abord : chacune qui arrive change sa matière, donc son shader
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
      // laisser le voile PEINDRE l'étape avant de lancer les compilations, qui occupent le fil principal
      await nextPaint()
      if (gen !== this.prepareGen) return
      this.scene.updateMatrixWorld()
      // la variante que la scène utilise vraiment : celle de la cible de la chaîne d'effets (sans
      // tone mapping, linéaire), ou l'écran quand il n'y a pas de chaîne (qualité basse)
      const previous = r.getRenderTarget()
      r.setRenderTarget(this.post?.sceneTarget ?? null)
      // `compile` lance les compilations sans les attendre (en parallèle, quand le pilote a
      // KHR_parallel_shader_compile) ; c'est `shadersReady` qui attend. PAS `compileAsync` : sa boucle
      // lit le programme de chaque matière sans garde, et une matière détruite pendant l'attente (les
      // marqueurs se reconstruisent quand les descripteurs arrivent) la fait planter en silence — la
      // promesse ne se résolvait jamais et le voile restait (constaté le 2026-09-25).
      r.compile(this.scene, this.camera)
      r.setRenderTarget(previous)
      await this.shadersReady(r, () => gen === this.prepareGen)
      if (gen !== this.prepareGen) return
      step('frame')
      // laisser le voile peindre l'étape, puis rendre l'image qui compile le reste
      await nextPaint()
      if (gen !== this.prepareGen) return
      this.holdFrames = false
      this.render(false)
    } catch {
      // une préparation ratée ne doit pas laisser la maison sous le voile : on la montre telle quelle
    } finally {
      // la préparation suivante (un nouveau chargement) tient elle-même les images
      if (gen === this.prepareGen) { this.holdFrames = false; this.loop.invalidate() }
      step(null)
    }
  }

  /**
   * Attend que les programmes des matières visibles soient compilés. Une matière disparue ou qui
   * n'a pas encore de programme ne retient rien : la première image la compilera. Plafonné, pour
   * qu'aucun cas imprévu ne laisse la maison sous le voile.
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
   * La même compilation que `prepare`, pour ce qui change APRÈS le chargement : un style (jamais vu,
   * ou quitté — three jette les programmes que plus rien n'utilise), une matière photo qui arrive.
   * Laissés à la première image, ces shaders se compilaient sur le fil principal : 2,5 à 5,5 s
   * figées sur l'iGPU pour « réaliste », la sélection du style ne se peignant qu'après (mesuré le
   * 2026-09-27). Ici, `compile` les lance en parallèle et l'ancienne image reste jusqu'à ce qu'ils
   * soient prêts. Sans `KHR_parallel_shader_compile`, tout est « prêt » tout de suite : rien n'attend.
   */
  private async compileBeforeShow(): Promise<void> {
    const r = this.renderer
    if (!r || this.holdFrames) return      // une préparation tient déjà les images, et compilera tout
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
    this.reliefEditor?.dispose()
    this.reliefEditor = null
    this.clearOpeningHandles()
    this.clearOpeningNotes()
    this.clearParkings()
    this.clearParkingNotes()
    this.garden.group.removeFromParent()   // gardé : ses formes et matières servent à la maison suivante
    this.clearOriginMark()
    this.removePrecipitation()
    this.removeBats()
    // une maison neuve part posée : aucun étage n'est en vol
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
    this.syncWater()                       // plus de maison, donc plus de piscine à animer
    this.highlightedRoom = null
    this.highlightMeshes = []                // libérés avec la racine
  }

  /** Descripteurs de plugin (type de marqueur, icône). Reconstruit les marqueurs. */
  setDescriptors(descriptors: Record<string, DeviceDescriptor>): void {
    this.descriptors = new Map(Object.entries(descriptors))
    // le KIND d'un appareil vient de son descripteur, qui arrive parfois après la maison : une porte
    // de garage reconnue à ce moment-là doit faire retirer le vantail que le bâti avait dessiné
    if (this.house) { this.refreshDressedOpenings(); this.buildMarkers(); this.updateStates(this.states, true); this.applyLevelFocus(); this.loop.invalidate() }
  }

  /**
   * Les ouvertures HABILLÉES par un ouvrant : celles dont le vantail appartient à un appareil, qui le
   * dessine à ses cotes et l'ouvre. Le bâti n'en pose alors aucun — sans quoi une porte de garage
   * remontée laissait derrière elle le panneau fixe que `details.ts` avait dessiné.
   *
   * Un ouvrant, et lui seul : un capteur d'ouverture épouse lui aussi le rectangle de sa fenêtre,
   * mais il ne la ferme pas.
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

  /** Refait les murs des niveaux quand cet ensemble a changé, et rien sinon (le cas de tous les gestes). */
  private refreshDressedOpenings(): void {
    const next = this.dressedOpenings()
    if (next.size === this.dressed.size && [...next].every((id) => this.dressed.has(id))) return
    this.dressed = next
    for (const l of this.geometry?.levels ?? []) this.rebuildLevelNodes(l.levelId)
  }

  /**
   * Où poser un appareil : sa `position` du JSON, ou — pour un VÉHICULE, qui n'en a pas — celle
   * que son GPS lui donne, à condition qu'il soit sur le terrain. `null` = pas de marqueur.
   *
   * Une voiture n'est pas un objet du bâtiment : sa place n'est pas une donnée qu'on écrit, c'est
   * un calcul qui suit le relevé. Garée ailleurs, elle disparaît simplement de la scène.
   */
  private effectivePosition(device: HouseDevice): Vec3 | null {
    // Un ouvrant lié à une ouverture ÉPOUSE son rectangle : son tablier y était déjà dessiné, mais sa
    // pilule restait sur la `position` du JSON — posée une fois par l'auto-placement, puis figée
    // pendant qu'on affinait la baie au doigt (2,11 m d'écart mesurés sur le volet du bureau). Ce
    // qu'on voit et ce qu'on touche viennent maintenant du même point.
    const rect = device.openingId ? this.openingRect(device.openingId) : undefined
    if (rect) return openingCentre(rect)
    if (device.position) return device.position
    const raw = this.gpsPoint(device)
    if (!raw) return null
    // L'engin au repos près d'une place compatible s'y RANGE : le relevé dit « il est rentré », la
    // place dit où il se met (`computeParkingFixes`). Le z reste celui du relevé — une place ne
    // décolle pas du sol.
    const fix = this.parkingFixes.get(device.id)
    return fix ? [fix.position[0], fix.position[1], raw[2]] : raw
  }

  /** Le point du RELEVÉ, projeté sur le terrain et corrigé du décalage saisi — avant toute place. */
  private gpsPoint(device: HouseDevice): Vec3 | null {
    const state = device.deviceId ? this.states[device.deviceId] : undefined
    // un véhicule, ou une tondeuse qui publie sa position en GPS (Husqvarna) : même projection
    if ((state?.kind !== 'vehicle' && state?.kind !== 'mower') || !state.location || !this.house) return null
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
    // Rangé sur une place, c'est ELLE qui donne le cap, et elle passe avant tout ce qui se déduit :
    // le sens d'une place a été posé à la main en regardant la scène. Le `yawOffset` ne s'y ajoute
    // pas — il corrige une déduction, or il n'y a plus rien à corriger.
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
    if (state?.kind === 'vehicle' && state.location) return `${state.location.lat},${state.location.lon},${state.headingDeg ?? ''},${atRest(state)}`
    // une tondeuse publie sa position toutes les quelques secondes en tonte : reconstruire à chaque
    // relevé serait trop cher, et inutile — son marqueur SUIT la position (`MowerMarker`). Ce qui
    // compte ici, c'est seulement qu'elle entre sur le terrain ou en sorte
    // …et qu'elle se RANGE ou non : une tondeuse qui rentre à sa base doit s'y poser, et c'est la
    // reconstruction qui applique la place (`computeParkingFixes`)
    if (state?.kind === 'mower' && state.location && this.house) {
      return `${sitePosition(this.house, state.location) ? 'in' : 'out'}:${atRest(state)}`
    }
    return ''
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
      // une tondeuse non déclarée apparaît de même, si elle publie un GPS (`effectivePosition` tranche)
      if ((descriptor.kind !== 'vehicle' && descriptor.kind !== 'mower') || known.has(deviceId)) continue
      strays.push({ id: deviceId, deviceId, kind: descriptor.kind, meta: {} })
    }
    return [...devices, ...strays]
  }

  private buildMarkers(): void {
    if (!this.house || !this.index || !this.nodes || !this.geometry) return
    this.computeParkingFixes()             // où chacun se range : les marqueurs en dépendent
    for (const m of this.markers.values()) m.dispose()
    this.markers.clear()
    for (const d of this.drawable()) {
      const marker = this.makeMarker(d)
      if (marker) this.markers.set(d.id, marker)
    }
  }

  /**
   * Un marqueur, posé dans le groupe de son niveau. `null` quand l'appareil n'a pas de position
   * EFFECTIVE : pour la plupart c'est la `position` du JSON ; pour un véhicule, c'est son GPS projeté
   * sur le terrain (`effectivePosition`).
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
    // Une voiture rangée sur une place de garage n'est plus « dehors » : elle suit le niveau de la
    // place (comme le marquage). Sinon, vue 1er étage, sa pilule DOM perce le plancher et le rayon
    // la touche à travers le sol — elle n'a pas de roomId / levelId écrits.
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
      // Une tondeuse SUIT sa position publiée sans reconstruction (`MowerMarker`) : c'est donc au
      // marqueur, et non à la scène, de savoir qu'elle est rentrée à sa base — sinon elle dériverait
      // de quelques mètres au relevé suivant, alors même qu'elle est à l'arrêt dessus.
      parkedAt: (state) => {
        const fix = this.parkingFixes.get(d.id)
        return fix && atRest(state) ? { xy: fix.position, yaw: fix.yaw } : null
      },
    }, (state) => this.isAtHome(state))
    marker.object.position.set(device.position[0], device.position[1], this.localZ(device, device.position[2]))
    parent.add(marker.object)
    marker.setSelected(this.selectedKey === device.id)
    // le guide (anneau, fil, cône) ne se dessine que sur le PREMIER déplaçable — dix modules d'un
    // champ donneraient dix anneaux pour un seul objet qui bouge — mais TOUS se glissent
    if (this.movableKeys.includes(device.id)) marker.setMoving(true, device.position[2], this.movableKeys[0] === device.id)
    return marker
  }

  /** Le rectangle d'une ouverture, tous niveaux confondus (un ouvrant l'épouse, une poignée aussi). */
  private openingRect(openingId: string): OpeningRect | undefined {
    for (const l of this.geometry?.levels ?? []) {
      const found = l.openings.find((o) => o.openingId === openingId)
      if (found) return found
    }
    return undefined
  }

  /**
   * z local au groupe parent : tel quel sous un niveau, décalé du terrain SOUS `xy` pour un appareil
   * extérieur (le terrain dessiné, relief en cours d'édition compris).
   */
  private localZ(device: HouseDevice, z: number, xy: readonly number[] | undefined = device.position): number {
    const levelId = this.markerLevelId(device)
    if (levelId && this.nodes!.levels.has(levelId)) return z
    if (resolveDeviceLevelId(device, this.index!.roomsById) || !xy) return z + deviceFloorZ(this.house!, device, this.index!)
    return z + this.groundZ(xy[0]!, xy[1]!)
  }

  /** Hauteur absolue du terrain dessiné en (x, y) — relief compris, brouillon d'édition compris. */
  private groundZ(x: number, y: number): number {
    return this.geometry ? terrainHeight(this.geometry.terrain, x, y) : (this.house?.site.elevation ?? 0)
  }

  /**
   * Niveau qui porte le marqueur : `levelId` / pièce écrits, sinon celui de la place où l'engin
   * est rangé (`parkingFixes`). Sans quoi un GPS « au garage » reste parenté à `outdoorMarkers`.
   */
  private markerLevelId(device: HouseDevice): string | null {
    const written = resolveDeviceLevelId(device, this.index!.roomsById)
    if (written) return written
    const fix = this.parkingFixes.get(device.id)
    if (!fix || !this.house) return null
    const parking = this.house.site.parkings.find((p) => p.id === fix.parkingId)
    return parking ? this.parkingLevelId(parking) ?? null : null
  }

  /** Niveau d'une place : champ écrit, sinon pièce hôte (`parkingHost`). */
  private parkingLevelId(p: Parking): string | undefined {
    if (p.levelId) return p.levelId
    const host = this.house ? parkingHost(this.house, p) : null
    return host?.kind === 'room' ? this.index?.roomsById.get(host.id)?.levelId : undefined
  }

  /**
   * Seules des OUVERTURES ont changé (on en règle une au doigt). Le chemin complet (`load`) refait
   * tout — la géométrie de tous les niveaux, tous les marqueurs, la carte d'ombre — et RECENTRE la
   * caméra : intenable à chaque mouvement de doigt. Ici : la géométrie descriptive entière (elle est
   * pure et bon marché), mais seuls les MAILLAGES des niveaux touchés, et seuls les marqueurs qui
   * épousent une ouverture qui a bougé — un volet taille sa lame sur le rectangle de sa fenêtre.
   * Caméra, niveau focalisé, sélection et tous les autres marqueurs restent en place.
   *
   * (Des relevés ont été pris pendant l'écriture de ce chemin, mais sur batterie donc en mode
   * économie : ils ne disent rien de la machine et ne sont pas reportés ici.)
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
    this.syncWindowGlow()                  // les niveaux refaits ont des verres neufs
    this.applyLevelFocus()
    if (!this.openingDragger?.active()) this.invalidateShadows()
    this.loop.invalidate()
  }

  /** Refait le maillage du toit (trous de Velux) sans toucher aux niveaux ni à la caméra. */
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
   * Refait les MAILLAGES d'un niveau (murs, sols, vitrages, détails) d'après la géométrie courante.
   * Ses marqueurs, eux, sont repris tels quels : les reconstruire est précisément ce qui les fait
   * clignoter — et ce qui rouvrait tous les volets fermés de la maison (cf. `CoverMarker.posed`).
   */
  private rebuildLevelNodes(levelId: string): void {
    const nodes = this.nodes
    const old = nodes?.levels.get(levelId)
    const lg = this.geometry?.levels.find((l) => l.levelId === levelId)
    if (!nodes || !old || !lg) return
    const fresh = buildLevel(lg, this.materials, this.dressed)
    fresh.group.remove(fresh.markers, fresh.labels)   // les neufs sont vides : ce sont les anciens qu'on garde
    old.markers.removeFromParent()
    old.labels.removeFromParent()
    fresh.group.add(old.markers, old.labels)
    // Le trait de la pièce sélectionnée et les poignées d'ouverture sont rebâtis après coup : ils
    // échappent ici à la libération de l'ancien groupe. Les poignées surtout : leurs quatre matériaux
    // sont PARTAGÉS par tous les niveaux, et les libérer avec ce groupe-ci laisserait les poignées
    // des autres niveaux tenir un matériau mort.
    for (const m of this.highlightMeshes) if (m.parent === old.group) m.removeFromParent()
    for (const h of this.openingHandles.values()) if (h.group.parent === old.group) h.group.removeFromParent()
    disposeObject3D(old.group, new Set<Material>(this.materials.all))
    const next: LevelNodes = { ...fresh, markers: old.markers, labels: old.labels }
    nodes.levels.set(levelId, next)
    nodes.root.add(next.group)
  }

  /** Seuls les appareils ont changé (placement) : on refait les marqueurs sans toucher aux murs ni à la caméra. */
  updateDevices(house: House): void {
    if (!this.nodes) { this.load(house); return }
    this.house = house
    this.index = indexHouse(house)
    this.refreshDressedOpenings()          // lier (ou délier) un ouvrant retire (ou repose) le vantail du bâti
    this.buildMarkers()
    this.updateStates(this.states, true)
    this.applyLevelFocus()
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

  // ---- mode « régler les ouvertures » --------------------------------------
  /**
   * Entre (ou sort) du mode édition : une poignée apparaît sur CHAQUE ouverture — portes, passages et
   * portes de garage comprises, qui n'ont aucun objet dans la scène et n'offraient donc rien à
   * attraper. Elles vivent et meurent avec le mode.
   */
  setEditingOpenings(on: boolean): void {
    if (this.editingOpenings === on) return
    this.editingOpenings = on
    if (!on) this.setSelectedOpening(null)
    this.buildOpeningHandles()
    this.buildOriginMark()
    this.refreshOpeningNotes()
    this.applyLevelFocus()                 // les poignées d'un niveau masqué n'ont pas à se montrer
    this.loop.invalidate()
  }

  /**
   * L'ouverture en cours de réglage : elle se distingue des autres, et c'est la SEULE qui se glisse —
   * comme un seul appareil se déplace à la fois (`setMovable`).
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
   * Arme (ou désarme) la pose d'une ouverture dans une pièce : le prochain tap sur le bâti de son
   * niveau rapporte le point touché (`placeTap`) au lieu de changer la sélection. Pour une
   * ouverture de surface (toit / sol), un cône de cap est affiché au centre de la pièce.
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
      // au-dessus de la dalle du toit, dans le repère du niveau-toit (z local)
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
    // Même convention que l'existant : (x, 0.02, −y) dans le groupe de niveau.
    mesh.position.set(cx, z, -cy)
    parent.add(mesh)
    this.placingYawGuide = mesh
    this.loop.invalidate()
  }

  /**
   * Point du bâti sous le doigt, en repère maison. Selon la nature armée : murs+sols (murale),
   * sols seuls (puits de lumière), toit (fenêtre de toit).
   */
  private buildingPoint(roomId: string, type: string | undefined, ndc: { x: number; y: number }): [number, number] | null {
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera)
    // Fenêtre de toit : on vise le maillage du toit, pièce ou non (pose depuis l'onglet Toit).
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
   * Cadre une ouverture : même boîte de 3 m qu'un appareil, vue DEPUIS l'intérieur de sa pièce (le
   * calcul de `roomSideAzimuth` pour un appareil contre un mur) — sans quoi on regarde la fenêtre
   * depuis la pelouse, à travers la façade.
   */
  focusOpening(openingId: string, animate = true): void {
    const rect = this.openingRect(openingId)
    if (!rect || !this.house) return
    // Fenêtre de toit : cadrer depuis l'onglet Toit (sinon le toit disparaît et on croit la voir au sol).
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
    // Cadrer l'ouverture ET SES COTES, pas seulement elle : une boîte fixe autour de l'ouverture
    // laissait la cote de droite hors de l'image (ou sous le champ de recherche) dès que le vide de
    // ce côté dépassait un mètre et demi. On borne la portée — sur un mur de dix mètres, le bout de
    // la cote n'a plus d'intérêt et reculer d'autant ne montrerait plus rien de l'ouverture.
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
    box.expandByScalar(DEVICE_FOCUS_SIZE_M / 2)     // la hauteur de l'ouverture, l'épaisseur du mur, et de l'air
    const b = roomBounds(this.house, rect.roomId, resolveDefaults(this.house.defaults))
    const c = b ? boundsCenter(b) : null
    const { azimuth, polar } = this.currentSpherical()
    const inward = c && Math.hypot(c[0] - cx, c[1] - cy) > 0.5 ? Math.atan2(c[0] - cx, -(c[1] - cy)) : null
    this.flyTo(box, inward ?? azimuth, clamp(polar, DEVICE_FOCUS_POLAR[0], DEVICE_FOCUS_POLAR[1]), animate, 1.1)
  }

  // ---- places de stationnement -------------------------------------------

  /**
   * Qui se RANGE où, pour tous les engins d'un coup (`assignParkings`, partagé et testé sans scène).
   *
   * Recalculé avec les marqueurs, parce que c'est leur construction qui l'applique : une voiture
   * rentrée depuis le dernier relevé n'avait pas de marqueur, une voiture repartie n'en a plus, et
   * une voiture qui se gare change de place sans changer d'état.
   *
   * Un appareil qui a une `position` écrite n'est pas candidat : sa place fait foi (même règle que
   * partout ailleurs), et une place de stationnement ne déplace que ce qui vient d'un GPS.
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
   * Le MARQUAGE des places, qui vit en permanence — ce n'est pas une poignée d'édition mais de la
   * peinture au sol (voir `builders/parking.ts` pour les deux dessins). Le mode édition n'y ajoute
   * que le voile touchable et le cadre, par simple échange de matériau (`styleParkingHandles`).
   *
   * Où le poser : dans les MARQUEURS du niveau de la pièce qui la porte (un garage), sur
   * `DECOR_LAYER` — un décor translucide, hors du relevé d'occlusion, masqué avec son niveau. Dehors,
   * c'est du sol comme un autre : dans le groupe du site, avec le terrain.
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
      // même piège de matrice périmée que les poignées : le rayon lit `matrixWorld`
      nodes.group.updateWorldMatrix(true, true)
      this.parkingNodes.set(p.id, nodes)
    }
    this.styleParkingHandles()
    this.loop.invalidate()
  }

  /**
   * Le groupe qui porte une place, et son z LOCAL : les marqueurs de son NIVEAU, ou le site.
   *
   * C'est `levelId` qui tranche, pas le point : une place se pose SUR un niveau (le garage, le toit
   * pour une aire de drone) ou sur le terrain, et c'est le choix qu'on a fait en la posant. Une
   * place écrite sans niveau retombe sur la pièce qui la contient — celles d'avant le champ ne
   * bougent pas.
   */
  private parkingParent(p: Parking): { parent: Group; z: number; levelled: boolean } {
    const site = this.nodes!.site
    const levelId = this.parkingLevelId(p)
    const levelNodes = levelId ? this.nodes!.levels.get(levelId) : undefined
    return levelNodes
      ? { parent: levelNodes.markers, z: 0, levelled: true }
      : { parent: site, z: this.groundZ(p.center[0], p.center[1]), levelled: false }
  }

  /** Les quatre cotes d'une place dans son hôte, `null` si elle n'est posée sur rien de connu. */
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
   * Trois états, comme les poignées d'ouverture : hors édition rien ne se voit du réglage (le
   * marquage seul) ; en édition chaque place porte un cadre fin ; celle qu'on règle porte un cadre
   * épais, dessiné par-dessus les murs, et un voile teinté. Rien ne se construit ni ne se détruit —
   * seuls des MATÉRIAUX changent.
   */
  private styleParkingHandles(): void {
    const mats = this.parkingMats
    if (!mats) return
    for (const [id, n] of this.parkingNodes) {
      // La place CHOISIE se montre même hors mode édition : on arrive ici depuis la vue Robots, qui
      // arme la pose d'une base sans rien demander aux Réglages, et une place qu'on vient de poser
      // doit se voir et se glisser. Les autres n'ont leur cadre qu'en édition.
      const on = id === this.selectedParkingId
      n.fill.material = on ? mats.fillOn : mats.off
      n.ring.material = this.editingParkings && !on ? mats.ring : mats.off
      n.ringOn.material = on ? mats.ringOn : mats.off
      // le cône de sens vit avec le cadre : il n'a de raison d'être que pendant qu'on pose
      n.cone.material = on ? mats.ringOn : this.editingParkings ? mats.ring : mats.off
    }
    this.loop.invalidate()
  }

  /**
   * Mode « poser une place » : le tap suivant ne sélectionne rien, il rapporte le point du SOL
   * touché (`groundTap`). Tapé hors de tout sol, c'est un renoncement, comme pour une ouverture.
   */
  setPlacingParking(on: boolean): void {
    if (this.placingParking === on) return
    this.placingParking = on
    this.loop.invalidate()
  }

  /**
   * Le point du sol sous le doigt, ET le niveau de ce sol : sol de pièce, dalle de toit, terrain ou
   * zone — le premier rencontré. `levelId: null` = on a touché le terrain, donc le jardin.
   *
   * C'est ce qui donne son NIVEAU à une place qu'on pose : on la met dans le garage en tapant le sol
   * du garage, sur le toit en tapant le toit, dans le jardin en tapant la pelouse. Rien à choisir
   * dans un menu — la surface touchée dit déjà tout.
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
    return { xy: [hit.point.x, -hit.point.z], levelId: floorLevel.get(hit.object) ?? null }   // monde (x, y, z) → maison (x, z, -y)
  }

  /** Mode « régler les places » : armé depuis les Réglages, comme celui des ouvertures. */
  setEditingParkings(on: boolean): void {
    if (this.editingParkings === on) return
    this.editingParkings = on
    if (!on) this.setSelectedParking(null)
    else this.styleParkingHandles()
  }

  /**
   * La place qu'on règle. Comme pour une ouverture, c'est la sélection qui arme le glissement : une
   * seule place se déplace à la fois, et on ne l'attrape que par elle-même.
   */
  setSelectedParking(id: string | null): void {
    this.selectedParkingId = id
    this.buildParkings()                   // les lignes de cote naissent et meurent avec la sélection
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
   * Seules des PLACES ont changé (on en règle une au doigt). Ni la géométrie ni les niveaux n'en
   * dépendent : on refait le marquage, on recalcule qui se range où, et on ne reconstruit que les
   * marqueurs dont la place a changé — c'est ce qui fait suivre la voiture pendant le geste sans
   * refaire les quarante autres marqueurs à chaque image.
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
   * Seul le RELIEF a changé (on vient de l'enregistrer depuis l'éditeur). Le chemin complet (`load`)
   * recentrerait la caméra ; ici, le terrain reprend ses z et ce qui s'y pose suit.
   */
  updateRelief(house: House): void {
    if (!this.nodes || !this.house) { this.load(house); return }
    this.house = house
    this.index = indexHouse(house)
    this.geometry = computeHouseGeometry(house)
    if (this.reliefGrid) this.applyReliefDraft()
    else shapeTerrain(this.nodes, this.geometry, this.materials)
    this.afterTerrainChange()
    this.fitSunShadow()                    // les bornes de la maison suivent le relief enregistré
    this.emitRelief()
  }

  // ---- jardin (arbres, buissons, pierres) -----------------------------------
  private buildGarden(): void {
    if (!this.nodes || !this.house) return
    this.nodes.site.add(this.garden.group)
    this.garden.setAccent(this.theme.primary)
    this.garden.build(this.house.site.garden, (x, y) => this.groundZ(x, y), this.season, this.look.garden)
  }

  /** Seul le JARDIN a changé : les éléments se reposent, rien d'autre ne se reconstruit. */
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

  /** Mode édition : les éléments du jardin deviennent touchables. */
  setEditingGarden(on: boolean): void {
    if (this.editingGarden === on) return
    this.editingGarden = on
    if (!on) this.setSelectedGarden(null)
  }

  /** Élément armé : le tap suivant rapporte le point du terrain (`gardenPlaceTap`). */
  setPlacingGarden(on: boolean): void {
    this.placingGarden = on
    this.loop.invalidate()
  }

  /** L'élément réglé : anneau au pied, et c'est lui seul qui se glisse, attrapé par lui-même. */
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

  /** Cadre un élément du jardin, vu d'où on le regardait. */
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
    // plan horizontal au PIED, écart doigt–pied conservé (même règle qu'une place)
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
    this.pendingGardenXY = [hit.x, -hit.z]          // monde (x, y, z) ← maison (x, z, -y)
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

  // ---- mode « modeler le terrain » ------------------------------------------
  /**
   * Entre (ou sort) de l'édition du relief. En entrant, le brouillon part du relief enregistré (ou
   * d'une grille à plat au pas de `RELIEF_STEP`) ; en sortant, le terrain revient à celui du
   * fichier — enregistrer est l'affaire du panneau, avant de sortir.
   */
  setEditingRelief(on: boolean): void {
    this.reliefWanted = on
    if (on === (this.reliefGrid !== null)) return
    if (on) {
      if (!this.house) return              // la maison n'est pas là : `load` ouvrira le mode
      this.reliefGrid = parseRelief(this.house.site.relief) ?? emptyReliefGrid(this.house.site.terrain, RELIEF_STEP)
    } else {
      this.reliefGrid = null
      this.reliefEditor?.dispose()
      this.reliefEditor = null
      if (this.house) this.geometry = computeHouseGeometry(this.house)
    }
    if (!this.nodes || !this.geometry) return
    if (on) this.applyReliefDraft()
    else shapeTerrain(this.nodes, this.geometry, this.materials)
    this.syncReliefFocus()
    this.afterTerrainChange()
    this.emitRelief()
  }

  /**
   * On modèle le TERRAIN : la maison s'estompe (toutes les matières des niveaux et du toit, par
   * l'opacité tramée de `levelFade` — pas de tri de transparence, pas de recompilation) et les
   * pilules disparaissent. Tout revient en sortant du mode.
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

  /** Remplace le brouillon (import IGN) ; `null` = terrain plat. Le remplacement s'annule comme un geste. */
  setReliefDraft(relief: Relief | null): void {
    if (!this.reliefGrid || !this.house) return
    this.reliefGrid = parseRelief(relief ?? undefined) ?? emptyReliefGrid(this.house.site.terrain, RELIEF_STEP)
    this.reliefEditor?.setGrid(this.reliefGrid)
    this.applyReliefDraft()
    this.afterTerrainChange()
    this.emitRelief()
  }

  /** Choisit le point voisin dans une direction de l'écran (flèches du clavier). */
  stepReliefSelection(sx: number, sy: number): void {
    if (this.reliefEditor?.stepSelection(sx, sy)) this.emitRelief()
  }

  /** Annule (ou rétablit) la dernière modification du relief. */
  undoRelief(): void { if (this.reliefEditor?.undo()) this.afterReliefTravel() }
  redoRelief(): void { if (this.reliefEditor?.redo()) this.afterReliefTravel() }
  private afterReliefTravel(): void {
    this.reliefGrid = this.reliefEditor!.grid            // l'historique rend un autre objet grille
    this.applyReliefDraft()
    this.afterTerrainChange()
    this.emitRelief()
  }

  /** Le point choisi prend la hauteur saisie dans le panneau (cm). */
  setReliefPoint(cm: number): void {
    if (this.reliefEditor?.setSelectedCm(cm)) this.onReliefChanged(true)
  }

  /** Le brouillon tel qu'il s'écrit dans la maison ; `null` s'il est plat (le champ est retiré). */
  reliefDraft(): Relief | null {
    return this.reliefGrid && !isFlatRelief(this.reliefGrid) ? serializeRelief(this.reliefGrid) : null
  }

  /**
   * Pose le brouillon sur la géométrie et sur les maillages, et (re)crée l'éditeur si la racine est
   * neuve. Sans brouillon, rien : la géométrie est déjà celle du fichier.
   */
  private applyReliefDraft(): void {
    const grid = this.reliefGrid
    if (!grid || !this.nodes || !this.geometry) return
    this.geometry = { ...this.geometry, terrain: { ...this.geometry.terrain, relief: grid } }
    shapeTerrain(this.nodes, this.geometry, this.materials)
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
    } else {
      this.reliefEditor.refresh()
    }
  }

  /** Un glissement en cours : une mise à jour du terrain par IMAGE ; la fin du geste refait le reste. */
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
   * Ce qui se pose sur le terrain le suit : appareils du jardin, véhicules, épingles du journal,
   * places de stationnement ; l'ombre et la brume se refont sur la nouvelle surface.
   */
  private afterTerrainChange(): void {
    if (!this.nodes || !this.house) return
    for (const m of this.markers.values()) {
      if (m.object.parent !== this.nodes.outdoorMarkers) continue
      m.object.position.z = this.localZ(m.device, m.device.position[2])
    }
    for (const p of this.journal?.points ?? []) p.anchor.position.z = this.groundZ(p.anchor.position.x, p.anchor.position.y)
    this.buildParkings()
    this.buildGarden()
    this.applyMist()
    this.invalidateShadows()
    this.loop.invalidate()
  }

  private emitRelief(): void {
    const e = this.reliefEditor
    this.emit('reliefChange', e ? { pointCm: e.selectedCm(), draft: this.reliefDraft(), canUndo: e.canUndo, canRedo: e.canRedo, pick: e.pick } : null)
  }

  /**
   * Cadre une place : sa boîte, plus de l'air autour, vue d'où on la regardait. Le NIVEAU, lui, est
   * focalisé par le magasin quand la place est dans une pièce (`selectParking`) — sans quoi on
   * regarderait le marquage d'un garage à travers le toit, et l'onglet de niveau dirait autre chose
   * que la scène.
   */
  focusParking(parkingId: string, animate = true): void {
    const p = this.house?.site.parkings.find((x) => x.id === parkingId)
    const nodes = this.parkingNodes.get(parkingId)
    if (!p || !nodes) return
    const box = new Box3()
    nodes.group.updateWorldMatrix(true, true)
    box.setFromObject(nodes.group)
    // Au moins la boîte d'un appareil : une base de tondeuse fait 60 cm, et la cadrer au plus juste
    // mettait la caméra sous le sol. Une grande place, elle, garde sa marge proportionnelle.
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
    // Plan horizontal AU SOL DE LA PLACE, et écart doigt–centre conservé : une place attrapée par un
    // coin ne saute pas sous le doigt au premier appui.
    nodes.group.updateWorldMatrix(true, false)
    const foot = nodes.group.getWorldPosition(new Vector3())
    this.dragPlane.setFromNormalAndCoplanarPoint(WORLD_UP, foot)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    this.dragOffset.copy(hit ? hit.sub(foot) : new Vector3())
  }

  /** Une position par IMAGE, pas une par événement (même raison que le glissement d'une ouverture). */
  private moveParkingDrag(id: string, ev: TapEvent): void {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    if (!hit) return
    hit.sub(this.dragOffset)
    this.pendingParkingXY = [hit.x, -hit.z]         // monde (x, y, z) ← maison (x, z, -y)
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
    this.flushParkingDrag(id)                       // la dernière position, celle qu'on garde
    if (moved) this.emit('parkingDrop', id)
    this.invalidateShadows()
  }

  /**
   * Ce que la scène écrit sur la place en cours de réglage : son NOM au-dessus d'elle, et ses QUATRE
   * cotes — ce qui la sépare du contour de son hôte devant, derrière et de chaque côté. C'est ainsi
   * qu'on pose une place de garage au mètre ruban, et c'est ce que le panneau règle.
   *
   * Les nombres viennent de `parkingGaps`, partagé avec le panneau : la même place ne peut pas se
   * coter de deux manières. Le trait de chaque cote, lui, est de la géométrie posée dans le groupe de
   * la place (`buildParking`) : il tourne et glisse avec elle, sans un temps de retard.
   *
   * Les étiquettes sont GARDÉES d'une image à l'autre : les refaire à chaque mouvement de doigt
   * ferait clignoter du DOM — c'est la leçon des cotes d'ouverture.
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
    // un `CSS2DObject` a posé son élément dans la couche du rendu 2D : le retirer de la scène ne
    // l'enlève pas (même geste que les cotes d'ouverture)
    for (const note of [this.parkingNotes.name, ...Object.values(this.parkingNotes.sides)]) {
      note.element.remove()
      note.removeFromParent()
    }
    this.parkingNotes = null
    this.loop.invalidate()
  }

  /**
   * Une poignée par ouverture, dans le groupe de son niveau : une dalle qui remplit le rectangle —
   * c'est elle qu'on attrape, et elle déborde l'épaisseur du mur pour s'attraper des deux côtés — et
   * un trait qui le cerne. Tous deux NON ÉCLAIRÉS, dans le langage de la surbrillance de pièce.
   *
   * **Trois états à lire sans hésiter** : rien, une ouverture, celle qu'on règle. Ce sont
   * l'ÉPAISSEUR du cadre et son rapport à la profondeur qui les séparent, pas une nuance d'opacité
   * (essayée d'abord, illisible) ni la présence du cadre (essayée ensuite : les dix-huit autres
   * ouvertures devenaient introuvables).
   *
   *  - au repos : un cadre FIN, calme, et surtout un TUBE — une bague extrudée dans toute l'épaisseur
   *    de la poignée, qui dépasse donc des deux faces du mur. C'est ce qui lui permet d'être soumise
   *    au test de profondeur : le toit et les façades la masquent comme n'importe quel objet, alors
   *    qu'un cadre PLAT posé à mi-épaisseur serait enterré dans la menuiserie qui l'entoure ;
   *  - sélectionnée : un cadre deux fois plus ÉPAIS, éclairci, plat, et dessiné par-dessus les murs
   *    (`depthTest: false`, comme le trait d'une pièce) — sinon la façade cache la poignée de la
   *    fenêtre qu'on regarde depuis la chambre. C'est la seule qui traverse.
   *
   * Les deux cadres existent en permanence sur chaque poignée ; la sélection n'éteint que des
   * MATÉRIAUX. Rien ne se construit ni ne se détruit en sélectionnant.
   *
   * **Elles vivent sur `DECOR_LAYER`, dans le groupe des MARQUEURS de leur niveau** : hors du relevé
   * d'occlusion (un voile translucide n'est pas un obstacle), touchables (le lancer de rayon ouvre
   * cette couche), et masquées avec leur niveau.
   */
  private buildOpeningHandles(): void {
    this.clearOpeningHandles()
    if (!this.editingOpenings || !this.nodes || !this.geometry) return
    const accent = this.theme.primary
    const trait = accent.clone().lerp(WHITE, 0.2).multiplyScalar(1.15)
    const mats = {
      // le voile porte « il y a quelque chose ici », le cadre porte « c'est une ouverture » : au repos
      // le voile s'efface derrière le cadre, qui dit la même chose en plus lisible
      fill: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.08, depthWrite: false, side: DoubleSide }),
      fillOn: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide }),
      ring: new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.62, depthWrite: false, side: DoubleSide }),
      ringOn: new MeshBasicMaterial({ color: trait, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: DoubleSide }),
      // Ce qui éteint un cadre est SON MATÉRIAU et non `Object3D.visible` : cette propriété-là dit
      // « mon niveau est masqué » (`shownInScene`), et c'est elle qui décide si une poignée est
      // touchable — l'éteindre ici rendrait la poignée injoignable au doigt.
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
          group.rotation.order = 'ZXY'                    // pencher après le cap (cf. buildPane)
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
        // Cadre : pour un MUR, bâti dans XY puis redressé (y local → z du mur). Pour une SURFACE
        // (sol / toit), il RESTE dans XY — le plan du porteur — sans `rotateX`, sinon il se dresse
        // à la verticale (mesuré sur un puits de lumière).
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
        // La `Scene` tourne avec `matrixWorldAutoUpdate = false` : sans cet appel, la matrice monde
        // d'une poignée neuve reste l'IDENTITÉ jusqu'à la prochaine image, le lancer de rayon la teste
        // à l'origine du monde, et un tap la traverse jusqu'au sol de la pièce (mesuré : onze poignées
        // sur onze, jusqu'à douze mètres d'écart). `true` pour les enfants : c'est la dalle, pas le
        // groupe, que le rayon touche. Même geste que `focusJournalPoint` et `openingFoot`, qui lisent
        // une position monde sans attendre une image.
        group.updateWorldMatrix(true, true)
        this.openingHandles.set(o.openingId, { group, fill, ring, ringOn, rect: o })
      }
    }
    this.styleOpeningHandles()
  }

  /**
   * Ce que la scène écrit sur l'ouverture en cours de réglage : son NOM au-dessus d'elle, et ses deux
   * COTES de part et d'autre — ce qui la sépare de chaque bout de son mur. C'est ainsi qu'on relève
   * une maison au mètre ruban, et c'est ce que l'utilisateur regarde en la déplaçant.
   *
   * Les nombres viennent d'`openingGaps` et le nom d'`openingLabel`, tous deux partagés avec le
   * panneau : la même fenêtre ne peut pas se nommer de deux façons ni se coter de deux manières.
   * Le format (`toFixed(2)` et « m ») est celui du panneau, au centimètre près.
   *
   * Les étiquettes se posent à la SÉLECTION, pas au premier mouvement du doigt : apparaître au
   * moment où le geste commence les ferait surgir sous la main, et elles servent aussi à relire ce
   * que les champs du panneau viennent d'écrire.
   *
   * Chaque nombre est posé sur une vraie LIGNE DE COTE, comme sur un plan : un trait qui va du bord
   * de l'ouverture au coin du mur — exactement l'intervalle que le nombre annonce, ni plus ni moins,
   * sans quoi on ne sait pas si « 0,25 m » se mesure jusqu'au coin ou jusqu'au tableau — fermé à
   * chaque bout par un tiret vertical. C'est de la GÉOMÉTRIE de scène et non un tracé dans la couche
   * DOM : le tracé vit dans le repère du niveau, donc il suit l'ouverture qui glisse sans un temps de
   * retard, et il se cache avec son niveau.
   *
   * Il vit avec les MARQUEURS du niveau, sur `DECOR_LAYER` — c'est ce qui le fait dessiner après les
   * murs (voir `buildOpeningHandles` : posé ailleurs, le mur le recouvrait), et c'est aussi un groupe
   * qui SURVIT à la reconstruction d'un niveau, comme les étiquettes.
   *
   * **Le cas difficile est la cote courte.** Le nombre est du DOM, large de 66 px quelle que soit la
   * distance ; l'intervalle, lui, est en mètres. Aucun seuil en mètres ne peut donc décider « le
   * nombre est plus large que sa cote ». Il est pour cette raison posé AU-DESSUS du trait et non
   * dessus : il ne le coupe jamais, à aucune échelle, et reste au milieu de son intervalle donc
   * attaché à lui. À zéro, il n'y a pas d'intervalle : le trait disparaît et les deux tirets se
   * confondent en un seul — ce qui est exactement ce qu'il y a à lire, l'ouverture touche le coin.
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
      // Surface : quatre cotes dans le plan (comme une place), trait le long de chaque intervalle.
      // l'emprise vue du ciel (cap et longueur du rectangle géométrique) : les traits partent du bord du
      // trou d'un Velux, pas de sa longueur le long de la pente
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
        // repère du groupe cotes = centre de l'ouverture : bord à `half` le long de dir, bout à half+span
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
   * Le repère d'ORIGINE du fichier, en mode édition seulement : le (0, 0, 0) local depuis lequel
   * toutes les coordonnées de `house.json` sont mesurées — polygones de pièce, positions d'appareils,
   * `offset` d'ouverture. C'est ce que `house.origin` ancre sur le globe.
   *
   * Un point seul ne dirait pas dans quel SENS on compte : il porte donc ses deux axes, +x et +y,
   * distingués par leur longueur et par une étiquette, plus une flèche plus courte vers le NORD VRAI
   * — `heading` est le cap de +y, donc le nord est en (−sin h, cos h) dans le repère local. C'est ce
   * qui permet de rapprocher un relevé du terrain.
   *
   * Tout est dessiné PAR-DESSUS la maison (`depthTest: false`) : l'origine peut tomber dans un mur,
   * sous une dalle ou loin du bâti, et un repère qu'on ne voit pas ne repère rien. Il n'est ni
   * touchable (aucun `role` dans `userData`, jamais présenté à `pick`) ni déplaçable : l'origine du
   * fichier n'est pas un réglage.
   *
   * Il est posé dans les marqueurs du niveau qui porte le z = 0 du fichier, et sur `DECOR_LAYER`,
   * comme les poignées.
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
    // L'anneau posé à plat sur le (0, 0) du fichier : c'est LUI le repère, les axes ne font que dire
    // dans quel sens on compte. `RingGeometry` est dans le plan XY, qui est le SOL en Z-up local —
    // comme l'anneau du guide de déplacement (`DeviceMarker.setMoving`).
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
    // Le nord est plus court et plus pâle que les axes du fichier : c'est un renseignement sur le
    // terrain, pas une direction dans laquelle on compte quelque chose.
    const h = (this.house.origin.heading * Math.PI) / 180
    arm([-Math.sin(h), Math.cos(h)], ORIGIN_MARK.north, WHITE, 0.55, 'N')
    group.traverse((n) => n.layers.set(DECOR_LAYER))
    // le niveau dont le sol est le plus proche du z = 0 du fichier ; le repère se replace dans son
    // repère à lui (un niveau est posé à son élévation) pour retomber exactement sur l'origine
    const host = [...this.nodes.levels.entries()]
      .sort((a, b) => Math.abs(a[1].elevation) - Math.abs(b[1].elevation))[0]
    if (!host) return
    group.position.z = -host[1].elevation
    host[1].markers.add(group)
    group.updateWorldMatrix(true, true)     // même piège de matrice périmée que les poignées
    this.originMark = { group, labels }
    this.loop.invalidate()
  }

  private clearOriginMark(): void {
    if (!this.originMark) return
    // les étiquettes des axes sont des éléments DOM posés par le rendu 2D : le groupe s'en va, elles non
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
      h.ring.material = on ? mats.off : mats.ring          // le cadre fin s'efface sous l'épais
      h.ringOn.material = on ? mats.ringOn : mats.off
    }
  }

  /** La poignée est-elle sous le doigt ? Masquée avec son niveau, elle ne s'attrape pas. */
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
    // Plan HORIZONTAL au sol du niveau : ce qu'on rapporte est le point du doigt sur ce sol, à charge
    // de l'appelant d'y chercher la place admissible la plus proche. L'écart initial doigt–ouverture
    // est conservé (comme pour un appareil) : sans lui, l'ouverture sauterait au premier appui, la
    // poignée étant à hauteur d'allège et le plan à ses pieds. Les deux glissements partagent plan et
    // écart : on ne déplace jamais un appareil et une ouverture en même temps.
    const foot = this.openingFoot(handle.group, handle.rect.levelId)
    this.dragPlane.setFromNormalAndCoplanarPoint(WORLD_UP, foot)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    this.dragOffset.copy(hit ? hit.sub(foot) : new Vector3())
  }

  /**
   * UNE position par image, pas une par événement. Le pointeur en émet plusieurs fois par image, et
   * chacune reconstruit les murs d'un niveau : tout ce travail-là finissait à la poubelle avant
   * d'être vu. On retient la dernière position et on la rapporte à l'image suivante.
   */
  private moveOpeningDrag(id: string, ev: TapEvent): void {
    this.raycaster.setFromCamera(new Vector2(ev.ndc.x, ev.ndc.y), this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3())
    if (!hit) return
    hit.sub(this.dragOffset)
    this.pendingOpeningXY = [hit.x, -hit.z]         // monde (x, y, z) ← maison (x, z, -y)
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
    this.flushOpeningDrag(id)                       // la dernière position, celle qu'on garde
    if (moved) this.emit('openingDrop', id)
    this.invalidateShadows()                        // le geste est fini : les ombres reprennent la main
  }

  /** Le pied de l'ouverture dans le monde : son milieu horizontal, ramené au sol de son niveau. */
  private openingFoot(group: Group, levelId: string): Vector3 {
    group.updateWorldMatrix(true, false)
    const p = group.getWorldPosition(new Vector3())
    p.y = this.nodes?.levels.get(levelId)?.elevation ?? 0
    return p
  }

  /**
   * Teinte d'une carrosserie MONTRÉE le temps qu'on la choisit (aperçu) : rien n'est écrit, et la
   * maison reprend la main dès que le choix est validé. `null` rend la teinte d'avant.
   */
  previewBodyColor(key: string, color: string | null): void {
    this.markers.get(key)?.previewColor(color)
  }

  /**
   * Pose les INCIDENTS du journal d'un appareil sur le terrain : une épingle par point (tige fine,
   * tête teintée de la gravité, plus grosse pour une erreur grave), projetée comme l'appareil
   * lui-même (`sitePosition`, avec son `gpsOffset`) — un point hors du terrain n'est pas dessiné.
   * `null` retire tout. C'est ainsi qu'on LOCALISE une panne : « No loop signal » a une place.
   */
  setJournalPoints(key: string | null, points: readonly { at: number; lat: number; lon: number; severity: string; label?: string }[]): void {
    if (this.journal) {
      // les étiquettes sont des éléments DOM que le rendu 2D a posés : retirer le groupe de la scène
      // ne les enlève pas, elles resteraient dans le vide (constaté) — même geste que `DeviceMarker.dispose`
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
    stem.rotateX(Math.PI / 2)                      // l'axe du cylindre est Y chez Three, la tige monte en Z
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
      // la tête se touche : c'est par là qu'on lit l'incident depuis la scène
      top.userData = { role: 'journal', at: p.at }
      pickables.push(top)
      pin.add(rod, top)
      // l'étiquette (texte du fabricant et code) n'apparaît que sur l'épingle ACTIVE : dix-neuf
      // étiquettes ouvertes se couvriraient l'une l'autre
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
   * L'épingle ACTIVE : celle de la ligne choisie dans le panneau, ou celle qu'on vient de toucher.
   * Tête grossie, étiquette visible ; `null` éteint tout. C'est ainsi qu'on lit l'incident depuis la
   * scène sans avoir à retrouver sa ligne.
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

  /** Cadre la caméra sur un incident du journal (même boîte de 3 m que sur un appareil). */
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

  /** Déplace un marqueur (aperçu) ; `position` dans le repère maison (z relatif au sol de l'ancre). */
  moveMarker(key: string, position: Vec3): void {
    const marker = this.markers.get(key)
    if (!marker || !this.house || !this.index) return
    marker.object.position.set(position[0], position[1], this.localZ(marker.device, position[2], position))
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
    const levelId = this.markerLevelId(device)
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
      const fanId = marker.linkedFanDeviceId
      const fanNext = fanId ? states[fanId] : undefined
      const fanChanged = !!fanId && fanNext !== prev[fanId]
      if (force || next !== prev[id] || !marker.currentState || soundChanged || fanChanged) {
        marker.update(next, sound)
        if (fanId) marker.setCompanionFan(fanNext)
        touched = true
        // Seuls ces trois-là DÉPLACENT quelque chose qui porte une ombre (un tablier, une voiture) ou
        // en allument une (une lampe de jardin). Un capteur qui publie sa mesure toutes les secondes
        // ne doit pas relancer un relevé d'ombres.
        if (next && (next.kind === 'cover' || next.kind === 'vehicle' || next.kind === 'light')) this.invalidateShadows()
      }
    }
    if (touched) this.syncWindowGlow()
  }

  // ---- focus / caméra -----------------------------------------------------
  setOptions(opts: Partial<HouseSceneOptions>): void {
    this.invalidateShadows()
    const before = this.options.quality
    const projectionBefore = this.options.projection
    this.options = { ...this.options, ...opts }
    if (this.renderer) this.renderer.shadowMap.enabled = this.options.shadows
    if (this.options.quality !== before) { this.autoQuality = null; this.applyQuality() }   // un choix explicite repart de la détection
    if (this.options.projection !== projectionBefore) this.applyProjectionMode()
    this.applyLevelFocus()
    this.loop.invalidate()
  }

  /**
   * Change de projection. La pose ne bouge PAS : c'est le tronc qui change. Le zoom orthographique
   * est choisi pour montrer la même hauteur de monde au point visé, et le retour en perspective
   * retrouve la distance qui montrait cette hauteur — sinon la maison sauterait d'un facteur dix au
   * moment où l'on coche la case.
   */
  private applyProjectionMode(): void {
    const mode = this.options.projection
    const target = this.controls?.target ?? new Vector3()
    // la hauteur de monde montrée au point visé, relevée AVANT tout changement : c'est elle qui tient
    const height = this.camera instanceof OrthographicCamera
      ? ORTHO_BASE_M / this.camera.zoom
      : visibleHeight(this.camera.position.distanceTo(target), this.perspectiveCamera.fov)
    // l'isométrie est une perspective à champ ÉTROIT ; l'orthographique se rapporte au champ de base
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
      this.applyProjection()                 // le champ a pu changer sans changer de caméra
      const { azimuth, polar } = this.currentSpherical()
      this.camera.position.copy(this.poseAt(azimuth, polar, distance).position)
    }
    // l'isométrie ne se contente pas d'un tronc : elle impose ses angles, et la vue s'y range
    if (mode === 'iso') {
      const { azimuth, distance } = this.currentSpherical()
      this.moveCamera(this.poseAt(snapIsoAzimuth(azimuth, DEFAULT_AZIMUTH), ISO_POLAR, distance), true)
    }
    this.controls?.update()
  }

  /** Échange la caméra active en lui passant pose, couches et cadrage ; la chaîne d'image la suit. */
  private swapCamera(next: PerspectiveCamera | OrthographicCamera): void {
    const from = this.camera
    if (next === from) return
    next.position.copy(from.position)
    next.quaternion.copy(from.quaternion)
    next.layers.mask = from.layers.mask
    this.camera = next
    if (this.controls) this.controls.object = next
    this.applyProjection()
    // l'occlusion ambiante tient une référence sur la caméra : la chaîne se refait avec la neuve
    this.applyQuality()
  }

  /**
   * Ce que les contrôles autorisent, selon la projection. En orthographique la molette ne change
   * plus la distance mais le ZOOM : les bornes de l'une se traduisent dans l'autre. En isométrie la
   * rotation libre est coupée — doigt et bouton gauche déplacent la vue, et les boutons de la vue
   * tournent par quarts de tour (`orbitBy`).
   */
  private applyControlLimits(): void {
    const c = this.controls
    if (!c) return
    const fov = this.perspectiveCamera.fov
    // le champ étroit de l'isométrie recule la caméra d'autant : les bornes de la molette suivent
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
    // un niveau masqué ne porte plus d'ombre (et un niveau rendu en porte de nouveau) : sans relevé,
    // l'étage caché continuait d'assombrir celui qu'on regarde
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
      // …et avec eux les poignées d'ouverture et les cotes. Un étage qui s'ENVOLE garde les siens
      // pendant le vol (ses pilules montent et s'estompent avec lui) : c'est son groupe, masqué à
      // l'arrivée, qui les retire. Le fantôme, lui, reste en place sans ses marqueurs.
      nodes.markers.visible = !ghost
      for (const mesh of [...nodes.walls, ...nodes.floors.values(), ...nodes.panes]) {
        mesh.material = ghost ? this.materials.ghost : (mesh.userData.material as Material)
      }
      // pilules : seulement le niveau focalisé (lisibilité) ; l'appareil sélectionné reste visible
      for (const m of this.markers.values()) if (m.object.parent === nodes.markers) pills.push([m, focused?.id === id])
    }
    this.fadePills(pills)
    // le toit se voit en vue d'ensemble et depuis le niveau qu'il porte (le toit déclaré comme un
    // niveau, pour ses panneaux) ; depuis un étage, il cacherait les pièces
    if (this.nodes.roof) this.liftTo('roof', () => this.nodes?.roof ?? undefined, 0, !focused || this.isRoofLevel(focused), this.topBelow(this.geometry?.roof?.zBase ?? 0))
    // jardin : pilules visibles — sauf un GPS coincé SOUS le plancher focalisé (même XY qu'une
    // pièce de cet étage, plus bas). Une voiture sans place finissait ainsi à percer le 1er.
    for (const m of this.markers.values()) {
      if (m.object.parent !== this.nodes.outdoorMarkers) continue
      m.setPillVisible(!focused || !this.coveredByFocusedFloor(m))
    }
    this.padLamps()
  }

  /**
   * Montre ou masque un étage (ou le toit) en le faisant S'ENVOLER : il monte en accélérant puis
   * disparaît ; il redescend et se pose en revenant. Un déplacement, et non un fondu TRANSPARENT :
   * aucune matière ne devient transparente, aucun programme ne change. `get` relit l'objet à chaque image — un
   * niveau reconstruit en plein vol (réglage d'une ouverture) reprend la course où elle en est.
   * Sans renderer (tests), la bascule est immédiate, comme avant.
   *
   * Il s'efface en même temps qu'il monte (`core/levelFade.ts`) : tout ce qui est au-dessus de
   * `fadeCutY` — le haut du niveau qui reste — perd des pixels à mesure que l'étage s'élève.
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
    // la carte d'ombre suit l'étage pendant tout le vol, et se refait une fois posé
    this.invalidateShadows(LEVEL_LIFT_MS + SHADOW_SETTLE_MS)
    // plusieurs étages partent ensemble (rez-de-chaussée depuis « Tout ») : le seuil le plus bas
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
        this.invalidateShadows()             // l'étage vient d'être masqué (ou posé) : son ombre suit
        // plus rien en vol : le fondu se lève, l'image redevient celle d'avant au pixel près
        if ([...this.lifts.values()].every((l) => !l.tween)) { this.fadeCutY = Infinity; setLevelFade(1e9, 1) }
      },
    })
    state.tween = tw
    apply()
    this.loop.addTween(tw)
  }

  /**
   * Montre ou masque les pilules des niveaux EN FONDU, au rythme de l'envol des étages : celles qui
   * apparaissent partent de 0, celles qui partent s'estompent (et montent avec leur étage) puis se
   * masquent. Auparavant elles basculaient d'un coup — les pilules du rez-de-chaussée surgissaient
   * alors que l'étage, encore là, s'envolait sans les siennes. Une pilule neuve (marqueurs refaits)
   * se pose sans fondu : elle n'a jamais été vue.
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
    // un fondu en cours se termine d'un coup : ses pilules prennent leur état final
    this.finishPillFade()
    for (const [m, want] of changes) if (want) { m.setPillFade(0); m.setPillVisible(true) }
    this.pillFading = changes
    // une seule course, en temps : la sortie finit avec le vol, l'entrée part après un délai
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

  /** Le haut (z maison, donc hauteur monde) du plus haut niveau posé sous `z` : là où l'étage qui s'envole commence. */
  private topBelow(z: number): number {
    let top = -Infinity
    for (const l of this.nodes?.levels.values() ?? []) if (l.elevation < z - 1e-3) top = Math.max(top, l.elevation + l.height)
    // le seuil passe JUSTE au-dessus du dessus de ses murs : posé pile dessus, il faisait basculer
    // chaque pixel de ces faces d'un côté ou de l'autre — un grain qui scintillait pendant l'envol
    return (Number.isFinite(top) ? Math.min(top, z) : z) + LEVEL_FADE_MARGIN_M
  }

  /**
   * Garde CONSTANT le nombre de lumières ponctuelles que voit le rendu. Three compile un programme
   * par nombre de lumières : masquer l'étage retirait ses lampes, et la première visite du
   * rez-de-chaussée recompilait toutes les matières — 2,2 s d'image figée sur l'iGPU (mesuré le
   * 2026-09-24). Une lampe éteinte, posée hors de tout niveau, prend la place de chaque lampe
   * masquée ; le shader ne calcule rien pour elle (`core/levelLight.ts`).
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
   * Marqueur d'extérieur caché par le plancher de l'étage qu'on regarde : plus bas que ce niveau,
   * et son XY tombe dans une pièce de ce niveau (garage sous chambre, etc.).
   */
  private coveredByFocusedFloor(m: DeviceMarker): boolean {
    if (!this.focusedLevelId || !this.house || !this.index) return false
    const focused = this.house.levels.find((l) => l.id === this.focusedLevelId)
    if (!focused) return false
    // altitude absolue Z-up : somme des z locaux jusqu'à la racine de la maison
    let absZ = 0
    for (let o: Object3D | null = m.object; o && o !== this.nodes!.root; o = o.parent) absZ += o.position.z
    if (absZ >= focused.elevation - 0.05) return false
    const rooms = this.index.roomsByLevel.get(focused.id) ?? []
    const xy: Vec2 = [m.object.position.x, m.object.position.y]
    return rooms.some((r) => pointInPolygon(xy, r.polygon))
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
    const levelId = this.markerLevelId(device)
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

  /**
   * Regarde la parcelle DEPUIS un point cardinal (le vrai, `origin.heading` compris), presque à
   * l'horizontale : c'est de profil qu'on juge une pente ou un talus. `top` : d'aplomb, pour viser un
   * point dans le plan.
   */
  viewTerrainFrom(side: TerrainView, animate = true): void {
    if (!this.geometry || !this.house) return
    if (side === 'top') { this.flyTo(boundsToWorldBox(this.geometry.bounds), this.currentSpherical().azimuth, 0.01, animate, 1.0); return }
    const h = (this.house.origin.heading * Math.PI) / 180
    const north: Vec2 = [-Math.sin(h), Math.cos(h)]      // le nord en repère maison (+y est tourné du cap)
    const turn = { north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2 }[side]
    const d: Vec2 = [north[0] * Math.cos(turn) - north[1] * Math.sin(turn), north[0] * Math.sin(turn) + north[1] * Math.cos(turn)]
    // caméra du côté `d` : en monde (x, z = −y), azimut three = atan2(x, z)
    this.flyTo(boundsToWorldBox(this.geometry.bounds), Math.atan2(d[0], -d[1]), Math.PI / 2 - 0.12, animate, 1.0)
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

  /**
   * La POSE est la même dans les deux projections — c'est le champ de vision de référence qui la
   * calcule, même quand la caméra n'en a plus. L'orthographique y ajoute son zoom : les deux cadrent
   * alors la même chose, et basculer de l'une à l'autre ne déplace rien. L'isométrie, elle, ramène
   * l'angle demandé sur ses rails avant de cadrer.
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
      // Dessiné PAR-DESSUS les murs (`ringThrough`, comme le guide du mode déplacer) : en vue
      // oblique, le pied d'un mur cachait le trait qui le longe.
      // Ces cinq nombres sont ceux que le banc de réglage (`styles/tuning.ts`) met sous curseur.
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
      // …et le reste de la maison s'efface derrière elle (`core/roomFocus.ts`) : son contour élargi
      // d'un mur extérieur (ses murs restent entiers), de sous sa dalle au haut de ses murs. La
      // limite tombe dans le VIDE, au-delà du mur : posée pile sur sa face extérieure, elle faisait
      // basculer chaque pixel d'un côté ou de l'autre — un grain qui scintillait au moindre geste.
      const wall = this.house ? resolveDefaults(this.house.defaults).exteriorWallThickness : 0.3
      setRoomFocusShape(offsetPolygon(floor.polygon, wall + ROOM_FOCUS_MARGIN_M), level.elevation - ROOM_FOCUS_SLAB_M, level.elevation + level.height + ROOM_FOCUS_MARGIN_M)
    }
    this.fadeRoomFocus(floor && level ? 1 : 0)
    this.highlightedRoom = roomId
    this.loop.invalidate()
  }

  /** Amène la mise en valeur d'une pièce à `to` (0 = aucune) en `ROOM_FOCUS_MS`, sans rejouer si elle y va déjà. */
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
   * Les fenêtres d'une pièce dont une lampe est allumée s'éclairent, vues de dehors : le verre de la
   * pièce (un clone par pièce, `buildLevel`) émet la couleur de ses lampes, poussée au-dessus de 1
   * pour que le bloom l'accroche, et devient plus opaque — un verre à 30 % n'émettrait que 30 %.
   * Seulement la nuit (`theme.night`) : en plein jour, une fenêtre éclairée ne se voit pas.
   * Ne change qu'une couleur et une opacité : aucune variante de programme.
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

  // ---- sélection ----------------------------------------------------------
  setSelected(key: string | null): void {
    if (this.selectedKey) this.markers.get(this.selectedKey)?.setSelected(false)
    this.selectedKey = key
    if (key) this.markers.get(key)?.setSelected(true)
    this.applyLevelFocus()
    this.loop.invalidate()
  }

  /** Sélection au point NDC par lancer de rayon : objet d'appareil, sol de pièce, toit, zone. */
  pick(ndc: { x: number; y: number }): { kind: 'device'; key: string } | { kind: 'room'; roomId: string } | { kind: 'level'; levelId: string } | { kind: 'zone'; zoneId: string } | { kind: 'journal'; at: number } | { kind: 'opening'; openingId: string } | { kind: 'parking'; parkingId: string } | { kind: 'garden'; itemId: string } | null {
    if (!this.nodes) return null
    this.raycaster.setFromCamera(new Vector2(ndc.x, ndc.y), this.camera)
    // En mode édition, un arbre passe avant tout le reste : c'est le seul moment où on le touche.
    if (this.editingGarden) {
      const hitItem = this.raycaster.intersectObjects(this.garden.pickables(), false)[0]
      const itemId = hitItem ? this.garden.idOf(hitItem) : null
      if (itemId) return { kind: 'garden', itemId }
    }
    // En mode édition, une place passe avant le sol qui la porte — mais APRÈS les appareils : la
    // voiture garée dessus reste ce qu'on touche en premier, c'est elle qu'on vient piloter.
    if (this.editingParkings) {
      const fills: Mesh[] = []
      for (const n of this.parkingNodes.values()) if (shownInScene(n.group)) fills.push(n.fill)
      const pickables: Object3D[] = []
      for (const m of this.markers.values()) if (m.visibleInScene) pickables.push(...m.pickables)
      const hitParking = this.raycaster.intersectObjects(fills, false)[0]
      const hitOnIt = this.raycaster.intersectObjects(pickables, false)[0]
      if (hitParking && (!hitOnIt || hitParking.distance < hitOnIt.distance)) {
        return { kind: 'parking', parkingId: hitParking.object.userData.parkingId as string }
      }
    }
    // En mode édition, la poignée d'une ouverture passe AVANT l'appareil : c'est elle qu'on vient
    // chercher, et le tablier d'un volet couvre justement sa fenêtre.
    if (this.editingOpenings) {
      const fills: Mesh[] = []
      for (const h of this.openingHandles.values()) if (shownInScene(h.group)) fills.push(h.fill)
      const hitHandle = this.raycaster.intersectObjects(fills, false)[0]
      if (hitHandle) return { kind: 'opening', openingId: hitHandle.object.userData.openingId as string }
    }
    // une épingle du journal d'abord : petite, posée au sol, elle perdrait contre le sol de la pièce
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
    // Un mur ARRÊTE le rayon : sans lui, le tap sur une cloison traversait et tombait sur le sol de
    // la pièce voisine. Il sélectionne la pièce dont on voit la face (`roomOfWallHit`).
    const hitWall = this.raycaster.intersectObjects(walls, false)[0]
    // Le toit cache ce qu'il couvre : un tap dessus va au niveau qui le porte, jamais à la pièce
    // qu'on ne voit pas dessous (sans quoi le toit disparaissait au profit de l'étage).
    const roofNode = this.nodes.roof
    const roofLevel = roofNode?.visible ? this.roofLevel() : undefined
    const hitRoof = roofNode && roofLevel ? this.raycaster.intersectObject(roofNode, false)[0] : undefined
    // Un appareil SOUS un plancher (voiture au garage sous la chambre) est plus loin que le sol :
    // on ne le prend que s'il est le plus proche — sinon on touche le plancher qu'on voit.
    const deviceWins = !!hitDevice
      && (!hitFloor || hitDevice.distance <= hitFloor.distance)
      && (!hitRoof || hitDevice.distance <= hitRoof.distance)
      // une applique, une télé murale sont DEVANT leur mur : la marge ne les fait pas perdre contre lui
      && (!hitWall || hitDevice.distance <= hitWall.distance + WALL_PICK_TOLERANCE_M)
    if (deviceWins) return { kind: 'device', key: hitDevice!.object.userData.key as string }
    if (hitRoof && (!hitFloor || hitRoof.distance <= hitFloor.distance) && (!hitWall || hitRoof.distance <= hitWall.distance)) return { kind: 'level', levelId: roofLevel!.id }
    if (hitWall && (!hitFloor || hitWall.distance < hitFloor.distance)) {
      const roomId = this.roomOfWallHit(hitWall)
      return roomId ? { kind: 'room', roomId } : null
    }
    if (hitFloor) return { kind: 'room', roomId: hitFloor.object.userData.roomId as string }
    // les zones du jardin ne se sélectionnent qu'en vue d'ensemble / jardin
    if (this.focusedLevelId === null) {
      const hitZone = this.raycaster.intersectObjects([...this.nodes.zones.values()], false)[0]
      if (hitZone) return { kind: 'zone', zoneId: hitZone.object.userData.zoneId as string }
    }
    return null
  }

  /**
   * La pièce d'un mur touché : celle DEVANT la face vue (une cloison sépare deux pièces, on veut
   * celle qu'on regarde), sinon celle DERRIÈRE (la façade vue du jardin ouvre la pièce qu'elle
   * ferme). Le dessus d'un mur n'a pas de face verticale : c'est le côté caméra qui compte.
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
    // devant, à peine décollé ; derrière, au-delà de l'épaisseur du mur (une façade fait ~0,4 m)
    let roomId = roomAt(0.1)
    for (let d = 0.1; !roomId && d <= 1; d += 0.1) roomId = roomAt(-d)
    return roomId ?? null
  }

  private handleTap(ev: TapEvent): void {
    if (this.drag?.active() || this.openingDragger?.active() || this.parkingDragger?.active() || this.gardenDragger?.active() || this.reliefEditor?.active()) return   // fin d'un glissement, pas un tap
    // on modèle le terrain : un tap choisit un point, il n'ouvre ni une pièce ni un appareil
    if (this.reliefGrid) { this.reliefEditor?.tap(ev); return }
    // Une ouverture armée prend le tap AVANT toute sélection : on est venu désigner un mur, pas
    // ouvrir la pièce ou l'appareil qui se trouve devant. Tapé à côté du bâti, c'est un tap de fond
    // — l'appelant y lit un renoncement, comme partout ailleurs dans la vue.
    if (this.placingOpening) {
      const xy = this.buildingPoint(this.placingOpening.roomId, this.placingOpening.type, ev.ndc)
      if (xy) this.emit('placeTap', xy)
      else this.emit('backgroundTap')
      return
    }
    // Une place armée prend le tap de la même façon, mais au SOL : c'est là qu'on la pose.
    if (this.placingParking) {
      const hit = this.groundPoint(ev.ndc)
      if (hit) this.emit('groundTap', hit.xy, hit.levelId)
      else this.emit('backgroundTap')
      return
    }
    // Un élément du jardin armé : seul le TERRAIN (pelouse, zones) l'accueille, pas un plancher.
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
    // Le brouillard est TOUJOURS posé, rejeté à perte de vue quand l'air est clair : three compile un
    // programme avec et un sans, et le faire apparaître (visibilité sous 5 km) recompilait toutes les
    // matières — 2,1 s d'image figée mesurées sur le curseur de visibilité des Réglages (2026-09-25).
    const far = fogDistance(this.ambience)
    const fog = this.scene.fog instanceof Fog ? this.scene.fog : (this.scene.fog = new Fog(backdrop, NO_FOG_M, NO_FOG_M))
    fog.color.copy(backdrop)
    fog.near = far === null ? NO_FOG_M : far * 0.35
    fog.far = far === null ? NO_FOG_M : far
    this.applyMist()
  }

  /**
   * La brume basse de l'aube et de la nuit (`core/heightMist.ts`), posée sur le terrain. Sa couleur
   * est l'horizon du ciel, éclairci vers le ciel qui l'éclaire d'en haut (la lune, l'aube) : une
   * nappe un peu plus claire que le fond, qui se lit contre lui.
   */
  private applyMist(): void {
    const sky = new Color().copy(this.look.lighting.hemiSky).multiplyScalar(this.look.lighting.hemiIntensity * MIST_SKY_SHARE)
    const color = backdropColor(overcastSky(this.look.sky, this.ambience.cloudiness)).lerp(sky, 0.5)
    setHeightMist(this.ambience, color, this.geometry?.terrain.z ?? 0)
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
    // …et, quoi que dure l'attente, les PROCHAINES images dessinées : une fenêtre en temps seule
    // expirait pendant le voile de chargement (aucune image, shaders en compilation) — l'étage
    // masqué pendant ce temps laissait son ombre sur le rez-de-chaussée.
    this.shadowFramesPending = SHADOW_MIN_FRAMES
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
    this.buildOpeningHandles()             // les poignées sont teintées de l'accent, qui vient de changer
    this.buildParkings()                   // le marquage au sol suit le thème, comme le reste
    this.buildGarden()                     // l'anneau d'accent suit le thème, le jardin la palette du style
    this.buildOriginMark()                 // le repère d'origine aussi
    this.highlightRoom(this.highlightedRoom)
    this.syncWindowGlow()                  // le verre du style, et l'heure qui dit s'il fait nuit
    this.invalidateShadows()               // le soleil a pu bouger
    this.syncStorm()
    this.syncPrecipitation()
    this.syncBats()
    this.syncWater()                       // le style dit si l'eau bouge, l'heure ce que le fond reçoit
    this.loop.invalidate()
    void this.compileBeforeShow()
  }

  /**
   * Le banc de réglage, pendant qu'on tire un curseur. `setAppearance` referait les matières, le
   * ciel, les ombres et les textures à chaque image du glissement — or un multiplicateur du banc ne
   * touche QUE la chaîne d'image, le halo des lampes et le trait de la pièce. C'est le même look
   * recalculé, mais seulement ce qui en dépend est réappliqué.
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

  /** Ce que la chaîne d'image applique VRAIMENT, réglage compris : de quoi en déduire un défaut. */
  tunedLook(): { post: PostLook; glow: GlowLook } {
    return { post: this.look.post, glow: this.look.glow }
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
   * Pluie ou neige selon l'ambiance — le seul effet météo qui fait tourner la boucle (à 20 Hz, comme
   * toute animation décorative). Coupé en qualité BASSE : sur une tablette qui peine déjà, une averse
   * de deux mille traits n'est pas ce qu'on lui demande. Le vent vient de l'ambiance aussi ; sans
   * météo réelle, une brise d'ouest.
   */
  private syncPrecipitation(): void {
    const p = this.ambience.precipitation
    if (!p || this.quality === 'low' || !this.nodes || !this.geometry) { this.removePrecipitation(); return }
    const params = { kind: p.kind, intensity: p.intensity, windKmh: this.ambience.windKmh ?? 10, windDirDeg: (this.ambience.windDirDeg ?? 250) - this.headingDeg }
    // même nature et intensité voisine : on règle sans reconstruire ; sinon on repart (le nombre
    // de particules est fixé à la création)
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
   * Les chauves-souris du style : une animation décorative de plus (20 Hz), coupée en qualité basse
   * comme la pluie. Même nombre : on garde la nuée en vol ; sinon on la refait.
   */
  private syncBats(): void {
    const n = this.look.bats?.count ?? 0
    if (n <= 0 || this.quality === 'low' || !this.nodes || !this.geometry) { this.removeBats(); return }
    if (this.bats && this.bats.count === n && this.bats.object.parent === this.nodes.root) { this.bats.setColor(this.look.bats!.color); return }
    this.removeBats()
    const b = this.geometry.bounds
    const bats = new Bats({ min: [b.min[0], b.min[1]], max: [b.max[0], b.max[1]], roofZ: b.max[2] }, n, this.look.bats!.color)
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

  private removePrecipitation(): void {
    this.stopPrecip?.()
    this.stopPrecip = null
    this.precip?.dispose()
    this.precip = null
  }

  /**
   * L'eau qui bouge (`effects/water.ts`). Le shader ne coûte que les pixels de la piscine ; ce qui
   * coûte, c'est la BOUCLE — une eau animée redessine toute la scène, dix fois par seconde. D'où
   * trois conditions, dans cet ordre de gratuité : le style veut de l'eau vivante (la maquette non),
   * la qualité n'est pas basse (même règle que la pluie), et une piscine est DANS LE CHAMP. Le
   * dernier point se réévalue à chaque mouvement de caméra : une maison qu'on regarde côté rue ne
   * paie pas la piscine du jardin.
   *
   * Les caustiques du fond suivent le jour : un bassin qui s'allume tout seul à minuit ne trompe
   * personne. La houle, elle, ondule aussi sous la lune.
   */
  private syncWater(): void {
    const flow = this.look.surfaces.zones.pool.flow ?? 1
    this.waterStrength.surface.value = flow
    setWaterTint(this.water, this.theme.zones.pool)
    setWaterSun(this.water, this.sunDir)
    setWaterWind(this.water, this.ambience.windKmh ?? 10, (this.ambience.windDirDeg ?? 250) - this.headingDeg)   // sans météo, la brise de la pluie
    this.waterStrength.basin.value = flow * (0.25 + 0.75 * dayFactor(this.ambience))
    const wanted = flow > 0 && this.quality !== 'low' && this.poolInView()
    if (wanted === (this.stopWater !== null)) return
    if (!wanted) { this.stopWater?.(); this.stopWater = null; return }
    this.stopWater = this.loop.addAnimation({
      hz: WATER_HZ,
      step: (_now, dtS) => { this.water.time.value += dtS; return true },
    })
  }

  /** Une piscine est-elle dans le tronc de projection ? Sans piscine, la réponse est non. */
  private poolInView(): boolean {
    if (!this.nodes || !this.geometry) return false
    this.camera.updateMatrixWorld()
    waterFrustum.setFromProjectionMatrix(waterMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse))
    // La racine pend à l'origine de la scène, et `matrixWorldAutoUpdate` est coupé (les matrices
    // monde ne se refont qu'à l'image) : sa matrice LOCALE est donc sa matrice monde, et c'est la
    // seule qui sépare un maillage de zone du repère du monde.
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
   * Les matériaux, avec les matières en images si le style porte un pack et que l'utilisateur les
   * veut. Les images arrivent APRÈS : en attendant, le procédural tient la place, et chaque rôle
   * chargé repasse par ici avec une carte de plus. Le jeton écarte les arrivées pour un style ou un
   * réglage qu'on a quitté depuis — et une scène détruite, qui l'incrémente en partant.
   */
  private applyMaterials(): void {
    const pack = this.photoPack()
    const gen = this.photoGen
    const photos = pack
      ? loadPackTextures(pack, this.photoRoles(), () => {
        if (gen !== this.photoGen) return
        this.applyMaterials()
        this.highlightRoom(this.highlightedRoom)   // recopie les couleurs des clones, et redessine
        void this.compileBeforeShow()              // une carte de plus = un autre programme
      })
      : undefined
    applyLook(this.materials, this.theme, this.look, photos, { wetness: this.ambience.wetness ?? 0, snow: this.ambience.snow ?? 0 })
    this.syncFloorClones()
  }

  /** Le pack de matières photo du style, si l'utilisateur les veut. */
  private photoPack(): TexturePack | undefined {
    return this.assets ? packById(this.style.assets) : undefined
  }

  /** Les rôles à habiller de photos. `poolTile` n'est dans aucun look (le bassin l'impose dans `applyLook`) : on le charge quand même. */
  private photoRoles(): SurfaceRole[] {
    return [...rolesOf(this.look.surfaces), 'poolTile']
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
    const auto = this.options.quality === 'auto'
    const wanted = this.options.quality === 'auto' ? (this.autoQuality ?? detectQuality(this.renderer ? gpuName(this.renderer) : '')) : this.options.quality
    this.quality = wanted
    this.syncPrecipitation()               // la qualité basse coupe la pluie
    this.syncBats()                        // …et les chauves-souris
    this.syncWater()                       // …et fige l'eau
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
      draw: (target) => { this.renderer!.setRenderTarget(target); this.renderScene(this.renderer!) },
      // La machine ne suit pas : on descend d'un cran, sans rien demander à personne — en « auto »
      // seulement. Une qualité choisie est un choix : le garde-fou l'écrasait (mesuré le 2026-09-27,
      // « high » forcé sur l'iGPU redescendait en « medium » au bout de 13 s).
      ...(auto ? { onDowngrade: (to: EffectiveQuality) => { this.autoQuality = to; this.applyQuality(); this.loop.invalidate() } } : {}),
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

  /** Rapport largeur/hauteur de la partie LIBRE du canvas : ce que les deux projections cadrent. */
  private get viewAspect(): number {
    const { width, height } = this.size
    return Math.max(1, width - Math.min(this.viewInsetRight, width * 0.6)) / height
  }

  private applyProjection(): void {
    const { width, height } = this.size
    const free = Math.max(1, width - Math.min(this.viewInsetRight, width * 0.6))
    const cam = this.camera
    if (cam instanceof OrthographicCamera) {
      // le tronc porte la FORME (hauteur de base, rapport de l'écran) ; la taille, c'est le zoom
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
   * Tourne la vue autour de la cible de `delta` radians (boutons de la vue), sans changer la
   * plongée. En isométrie, les angles sont verrouillés : le bouton fait un QUART de tour, quelle
   * que soit l'amplitude demandée, et ramène la vue sur le coin le plus proche si elle l'avait quitté.
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
   * Rapproche (`factor` < 1) ou éloigne la caméra, dans les bornes des contrôles. En orthographique
   * la caméra ne bouge pas : c'est le zoom qui s'ouvre ou se ferme, comme le fait la molette.
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
    // Les matrices monde, UNE fois par image. Three les recalcule au début de CHAQUE `render()` —
    // or une image en compte plusieurs (la scène, celle de l'occlusion ambiante) plus celle du
    // `CSS2DRenderer`, et rien ne bouge entre elles. `matrixWorldAutoUpdate = false` coupe le
    // recalcul automatique ; c'est nous qui le demandons, ici, avant le premier rendu.
    this.scene.updateMatrixWorld()
    // Les compteurs de three se remettent à zéro à chaque `render()` : avec plusieurs rendus par
    // image, il faut les tenir nous-mêmes pour lire un total d'IMAGE et non de dernière passe.
    if (this.renderer) { this.renderer.info.autoReset = false; this.renderer.info.reset() }
    // les caustiques d'abord : le fond du bassin les lit dans cette image-ci
    if (this.renderer) this.caustics?.update(this.renderer)
    // Avec une chaîne d'effets, c'est elle qui appelle notre rendu (par `draw`) puis ses passes ;
    // sans elle, on dessine droit à l'écran.
    // Seules les images d'un geste SANS relevé d'ombres disent quelque chose de la machine au garde-fou.
    if (this.post) this.post.render(interactive && t0 > this.shadowsDirtyUntil && this.shadowFramesPending === 0)
    else if (this.renderer) { this.renderer.setRenderTarget(null); this.renderScene(this.renderer) }
    this.measure(t0, interactive)
    this.updatePillLod()
    this.updatePillFocus()
    if (this.labelsVisible) { this.labelRenderer?.render(this.scene, this.camera); this.markLabelsMoving() }
    this.probe?.end()
  }

  /**
   * UNE passe : toute la scène, lampes comprises. Une lampe d'intérieur n'éclaire que son niveau par
   * le masque de hauteur que chaque matière porte (`core/levelLight.ts`), plus par un rendu en passes.
   * Reste, comme avant : dans un même niveau, une lampe éclaire encore à travers une cloison.
   */
  private renderScene(r: WebGLRenderer): void {
    // les tranches du masque : les élévations MONDE des niveaux (la racine peut être déplacée)
    if (this.nodes) setLevelHeights([...this.nodes.levels.values()].map((n) => n.group.matrixWorld.elements[13]!))
    // Les ombres ne se refont qu'après un changement de scène, pas parce que la caméra a tourné :
    // le relevé redessine tout le bâti depuis le soleil, et six faces de plus par lampe de jardin.
    const rebuildShadows = (this.deps.now?.() ?? performance.now()) <= this.shadowsDirtyUntil || this.shadowFramesPending > 0
    if (this.shadowFramesPending > 0) this.shadowFramesPending--
    this.perf.shadowsRebuilt = rebuildShadows
    r.shadowMap.autoUpdate = rebuildShadows
    r.render(this.scene, this.camera)
    r.shadowMap.autoUpdate = false
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
    // en orthographique la distance ne dit plus rien de l'échelle : c'est le zoom qui la porte
    const pxPerM = this.camera instanceof OrthographicCamera
      ? (this.size.height * this.camera.zoom) / ORTHO_BASE_M
      : this.size.height / (2 * d * Math.tan((this.perspectiveCamera.fov * Math.PI) / 360))
    const lod: PillLod = pxPerM >= PILL_LOD_FULL_MIN_PX_PER_M ? 'full' : pxPerM >= PILL_LOD_ICON_MIN_PX_PER_M ? 'icon' : 'dot'
    if (lod === this.pillLod) return
    this.pillLod = lod
    layer.dataset.lod = lod
  }

  /**
   * Les pilules suivent la bande nette du tilt-shift. Elles sont en DOM et le flou de la chaîne
   * d'image ne les atteint pas : nettes au-dessus d'une maison floutée, elles cassent la maquette.
   *
   * La courbe est celle du shader (`tiltBlurFactor`), lue à la place de la pilule PROJETÉE plutôt
   * qu'en fouillant le `transform` que `CSS2DRenderer` vient d'écrire — une chaîne à re-parser à
   * chaque image, et un détail d'implémentation de three. Rien n'est fait quand l'effet est éteint,
   * sauf l'image qui l'éteint : celle-là rend leur netteté à toutes.
   */
  private updatePillFocus(): void {
    const ts = this.look.post.tiltShift
    const band = ts && ts.strength > 0 && ts.pills > 0 ? ts : null
    if (!band && !this.pillsFaded) return
    for (const m of this.markers.values()) {
      if (!band) { m.setPillFocus(1); continue }
      // NDC → UV : +1 en haut vaut 1, comme le `vUv.y` du shader
      const uvY = (m.worldAnchor(this.pillFocusAt).project(this.camera).y + 1) * 0.5
      m.setPillFocus(1 - band.pills * tiltBlurFactor(uvY, band))
    }
    this.pillsFaded = !!band
  }

  setPaused(paused: boolean): void { this.loop.setPaused(paused) }

  dispose(): void {
    this.photoGen++                        // une matière qui arrive après n'a plus de scène à habiller
    this.prepareGen++                      // …et une préparation en cours, plus de maison à montrer
    this.compileGen++                      // …ni une compilation, plus d'image à retenir
    this.detachInput?.()
    this.detachWheel?.()
    if (this.labelsIdle !== null) clearTimeout(this.labelsIdle)
    if (this.stormTimer !== null) { clearTimeout(this.stormTimer); this.stormTimer = null }
    this.removePrecipitation()
    this.removeBats()
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
    this.skyEnv?.dispose()
    this.renderer?.dispose()
    if (this.labelRenderer) this.labelRenderer.domElement.replaceChildren()
  }
}

/**
 * Le contour et l'intérieur d'un cadre rectangulaire de `w` × `h`, large de `b` : les deux polygones
 * que `flatRing` et `extrudeRing` attendent. La largeur est bornée au cinquième de la plus petite
 * cote — sur une fenêtre de salle de bain de 80 cm, un cadre de 7,5 cm mange déjà le verre.
 */
function frameRect(w: number, h: number, b: number): [Vec2[], Vec2[]] {
  const x = w / 2, y = h / 2, t = Math.min(b, w * 0.2, h * 0.2)
  return [
    [[-x, -y], [x, -y], [x, y], [-x, y]],
    [[-x + t, -y + t], [x - t, -y + t], [x - t, y - t], [-x + t, y - t]],
  ]
}

/**
 * Une étiquette que la scène écrit elle-même : le nom d'une ouverture, l'une de ses deux cotes, ou la
 * lettre d'un axe du repère d'origine.
 *
 * Styles EN LIGNE et non une classe de `styles/app.css` : la feuille de l'application appartient à
 * l'interface, et la scène sait déjà s'habiller seule (`core/theme.ts`). Les couleurs sont prises aux
 * variables du thème, donc les deux thèmes marchent sans rien de plus.
 *
 * Une cote a des chiffres à CHASSE FIXE et une largeur minimale : « 0.35 m » puis « 1.40 m » ne
 * doivent pas faire danser l'étiquette sous le doigt, alors que c'est précisément le moment où sa
 * valeur change dix fois par seconde.
 */
function sceneNote(kind: 'name' | 'gap' | 'axis'): CSS2DObject {
  const el = document.createElement('div')
  el.className = `scene-note scene-note--${kind}`
  el.style.cssText = [
    'pointer-events:none;position:absolute;left:0;top:0;transform:translate(-50%,-50%)',
    'padding:3px 8px;border-radius:8px;white-space:nowrap;font:600 11px/1.25 var(--font)',
    kind === 'axis'
      // un axe se nomme d'une lettre : pas de cartouche autour, juste la lettre lisible sur ciel
      // comme sur pelouse (une ombre portée, pas un fond)
      ? 'color:var(--accent);font:700 12px/1 var(--font);text-shadow:0 1px 3px rgba(0,0,0,.55),0 0 2px rgba(0,0,0,.4)'
      : kind === 'name'
      ? 'background:var(--accent);color:var(--on-accent);border:1px solid transparent;max-width:220px;overflow:hidden;text-overflow:ellipsis'
      // 66 px : la largeur de « 12.34 m » à cette fonte, chiffres à chasse fixe — au-delà de dix
      // mètres, un mur de maison n'existe plus. La boîte ne bouge donc pas d'un pixel pendant le geste.
      : 'background:color-mix(in srgb, var(--surface) 92%, transparent);color:var(--text);border:1px solid var(--line);font-variant-numeric:tabular-nums;min-width:66px;text-align:center',
  ].join(';')
  return new CSS2DObject(el)
}

/** Visible POUR DE BON : un objet visible dans un groupe masqué (un niveau au-dessus) ne l'est pas. */
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
