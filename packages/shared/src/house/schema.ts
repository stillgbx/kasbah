import { z } from 'zod'
import { DEVICE_KINDS, VEHICLE_FINISHES } from '../devices/kinds'
import { deviceIdSchema, hexColorSchema } from '../devices/descriptor'
export { hexColorSchema }
import { commandSchema } from '../devices/command'
import { signedArea } from './geometry/vec2'

// Description de la maison. Repère : Z-UP métrique, x = est, y = nord, z = haut (les
// polygones vivent en XY comme `THREE.Shape`, les hauteurs s'extrudent en +Z).
// Les polygones de pièces sont la FACE INTÉRIEURE finie, en sens trigonométrique (CCW) —
// l'ordre est imposé (pas inversé en silence) car les ouvertures référencent un index de segment.

export const vec2Schema = z.tuple([z.number(), z.number()])
export const vec3Schema = z.tuple([z.number(), z.number(), z.number()])
export type { Vec2 } from './geometry/vec2'
export type { Vec3 } from './geometry/types'
import type { Vec2 } from './geometry/vec2'

const idSchema = z.string().min(1).regex(/^[a-z0-9_.-]+$/i, 'id: [a-z0-9_.-]+')
const metaSchema = z.record(z.string(), z.unknown()).optional()

/**
 * Identifiant d'une carrosserie 3D : `<pluginId>/<modèle>`, qui est AUSSI le chemin du fichier
 * sous `public/models/`. Le catalogue vit côté web (lui seul sait ce qui est livré) ; le contrat
 * partagé ne valide donc que la forme, pas l'existence du modèle.
 */
export const model3dSchema = z.string().regex(/^(none|[a-z0-9_]+\/[a-z0-9-]+)$/, "model3d: 'none' ou <pluginId>/<modèle>")

function noConsecutiveDuplicates(poly: Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) return false
  }
  return true
}

export const polygonSchema = z.array(vec2Schema).min(3)
  .refine(noConsecutiveDuplicates, 'polygon has consecutive duplicate points')
export const ccwPolygonSchema = polygonSchema
  .refine((p) => signedArea(p) > 0, 'polygon must be counter-clockwise (CCW)')

export const geoOriginSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  alt: z.number().default(0),
  /** Cap (degrés, horaire depuis le nord vrai) de l'axe local +y. 0 = +y pointe au nord. */
  heading: z.number().min(-360).max(360).default(0),
})
export type GeoOrigin = z.infer<typeof geoOriginSchema>

export const houseDefaultsSchema = z.object({
  levelHeight: z.number().positive(),
  slabThickness: z.number().min(0),
  interiorWallThickness: z.number().min(0),
  exteriorWallThickness: z.number().min(0),
  doorHeight: z.number().positive(),
  windowSill: z.number().min(0),
}).partial()

export const levelSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** Libellé court pour les onglets (ex. « RDC »). */
  shortName: z.string().min(1).max(12).optional(),
  /** z du sol fini (absolu, repère maison). */
  elevation: z.number(),
  height: z.number().positive().optional(),
  /** Emprise extérieure (face externe des murs). Sert au toit. */
  outline: polygonSchema.optional(),
  /** Ordre d'affichage des pièces du niveau (UI). Les pièces absentes suivent, par ordre alphabétique. */
  roomOrder: z.array(idSchema).optional(),
  meta: metaSchema,
})
export type Level = z.infer<typeof levelSchema>

export const WALL_KINDS = ['interior', 'exterior', 'none'] as const
export type WallKind = (typeof WALL_KINDS)[number]

/**
 * `bay` = baie vitrée (grande ouverture vitrée descendant au sol), `glass-door` = porte vitrée.
 * Toutes deux sont VITRÉES comme une fenêtre et posées au sol comme une porte : c'est justement ce
 * qu'aucune des quatre premières ne savait dire, et pourquoi elles existent à part.
 *
 * `roof-window` = fenêtre de toit (Velux) sur la surface du toit ; `skylight` = puits de lumière /
 * vitre au sol. Toutes deux sont ancrées en surface (`x`, `y`, `yaw`), pas sur un mur.
 */
export const OPENING_TYPES = ['door', 'window', 'passage', 'garage', 'bay', 'glass-door', 'roof-window', 'skylight'] as const
export type OpeningType = (typeof OPENING_TYPES)[number]

/** Ouverture posée sur un sol ou un toit, pas sur un mur. */
export const SURFACE_OPENING_TYPES = ['roof-window', 'skylight'] as const
export type SurfaceOpeningType = (typeof SURFACE_OPENING_TYPES)[number]

export const isSurfaceOpening = (type: OpeningType): type is SurfaceOpeningType =>
  (SURFACE_OPENING_TYPES as readonly string[]).includes(type)

/**
 * Matière de la MENUISERIE d'une ouverture — son dormant et ses vantaux, pas le mur qui la porte.
 * Absente, la scène garde ce qu'elle déduit de la nature (dormant anthracite, vantail bois) : un
 * relevé au mètre ruban n'a pas à décrire la matière de chaque fenêtre pour être juste.
 *
 * `glass` VITRE l'ouverture en plus de la teinter : une porte pleine déclarée en verre reçoit son
 * vitrage et perd son panneau opaque, exactement comme une porte vitrée. `fabric` est la seule qui
 * ne dise rien de plus qu'une lumière : une TOILE, mate et sans reflet — la banne d'un store, le
 * tissu d'un rideau, une porte de garage à rideau souple.
 */
export const OPENING_MATERIALS = ['wood', 'metal', 'glass', 'fabric'] as const
export type OpeningMaterial = (typeof OPENING_MATERIALS)[number]

/** Bornes du nombre de vantaux. Dix : au-delà, ce n'est plus une ouverture, c'est une façade. */
export const MIN_OPENING_LEAVES = 1
export const MAX_OPENING_LEAVES = 10
export const openingSchema = z.object({
  id: idSchema,
  /**
   * Nom en clair, donné depuis le mode édition (« Baie du salon »). Absent, c'est l'`id` du relevé
   * qui s'affiche : un identifiant reste lisible, il n'est simplement pas toujours un nom.
   */
  name: z.string().min(1).max(60).optional(),
  type: z.enum(OPENING_TYPES),
  /**
   * Arête polygon[segment] → polygon[(segment+1) % n]. Requis pour une ouverture MURALE ; absent
   * pour `roof-window` / `skylight` (ancrage surface).
   */
  segment: z.number().int().min(0).optional(),
  /** Distance (m) depuis polygon[segment] jusqu'au bord proche. Requis pour une ouverture murale. */
  offset: z.number().min(0).optional(),
  /**
   * Centre en plan (repère maison) d'une ouverture de SURFACE. Requis pour `roof-window` /
   * `skylight` ; absent pour une ouverture murale.
   */
  x: z.number().optional(),
  y: z.number().optional(),
  /**
   * Cap (azimut, degrés) d'une ouverture de surface — même convention que les appareils et les
   * places (0 = face à +y). Requis pour `roof-window` / `skylight`.
   */
  yaw: z.number().min(-360).max(360).optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Hauteur d'allège depuis le sol fini. Défaut : 0 (porte/passage/garage) ou defaults.windowSill (fenêtre). */
  sill: z.number().min(0).optional(),
  /**
   * Nombre de vantaux. Absent, il se DÉDUIT de la nature et de la largeur (`openingLeaves`) : une
   * baie de trois mètres est une coulissante à deux ou trois vantaux, tout le reste n'en a qu'un.
   * Le nombre dessine les refends d'une ouverture vitrée et découpe le panneau d'une porte pleine.
   */
  leaves: z.number().int().min(MIN_OPENING_LEAVES).max(MAX_OPENING_LEAVES).optional(),
  /** Matière de la menuiserie. Absente, la scène décide d'après la nature (`OPENING_MATERIALS`). */
  material: z.enum(OPENING_MATERIALS).optional(),
  /** Couleur de la menuiserie (#rrggbb). Absente, c'est la palette du style de rendu qui la donne. */
  color: hexColorSchema.optional(),
  style: metaSchema,
  meta: metaSchema,
}).superRefine((o, ctx) => {
  if (isSurfaceOpening(o.type)) {
    if (o.x === undefined) ctx.addIssue({ code: 'custom', path: ['x'], message: 'surface opening requires x' })
    if (o.y === undefined) ctx.addIssue({ code: 'custom', path: ['y'], message: 'surface opening requires y' })
    if (o.yaw === undefined) ctx.addIssue({ code: 'custom', path: ['yaw'], message: 'surface opening requires yaw' })
  } else {
    if (o.segment === undefined) ctx.addIssue({ code: 'custom', path: ['segment'], message: 'wall opening requires segment' })
    if (o.offset === undefined) ctx.addIssue({ code: 'custom', path: ['offset'], message: 'wall opening requires offset' })
  }
})
export type Opening = z.infer<typeof openingSchema>

export const ROOM_KINDS = ['room', 'corridor', 'stairs', 'garage', 'terrace', 'balcony'] as const
export type RoomKind = (typeof ROOM_KINDS)[number]
export const FLOOR_STYLES = ['wood', 'tile', 'concrete', 'carpet'] as const
export type FloorStyle = (typeof FLOOR_STYLES)[number]
export const roomSchema = z.object({
  id: idSchema,
  levelId: idSchema,
  name: z.string().min(1),
  polygon: ccwPolygonSchema,
  kind: z.enum(ROOM_KINDS).default('room'),
  height: z.number().positive().optional(),
  walls: z.array(z.object({
    segment: z.number().int().min(0),
    kind: z.enum(WALL_KINDS).optional(),
    thickness: z.number().min(0).optional(),
  })).optional(),
  openings: z.array(openingSchema).default([]),
  style: z.object({ color: z.string().optional(), floor: z.enum(FLOOR_STYLES).optional() }).optional(),
  meta: metaSchema,
})
export type Room = z.infer<typeof roomSchema>

export const ZONE_KINDS = ['lawn', 'terrace', 'driveway', 'path', 'pool', 'bed', 'other'] as const
export type ZoneKind = (typeof ZONE_KINDS)[number]
export const zoneSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  kind: z.enum(ZONE_KINDS),
  polygon: polygonSchema,
  style: z.object({ color: z.string().optional() }).optional(),
  meta: metaSchema,
})
export type Zone = z.infer<typeof zoneSchema>

/** Plus petite cote d'une place (m) : une place de zéro disparaîtrait du sol sans qu'on sache pourquoi. */
export const MIN_PARKING_DIM = 0.2
const parkingDimSchema = z.number().min(MIN_PARKING_DIM).max(30)

/**
 * Place de stationnement : le rectangle au sol où un engin mobile se RANGE, orienté (il a un avant).
 *
 * C'est la réponse au seul défaut des appareils placés par leur GPS (véhicule, robot) : le relevé
 * est bon à quelques mètres près, ce qui suffit à dire « la voiture est à la maison » et pas à la
 * poser dans son garage — elle finissait en travers d'un mur, et dans le mauvais sens. Un engin AU
 * REPOS près d'une place compatible s'y range donc exactement (`assignParkings`, `parking.ts`).
 *
 * Deux champs, et deux seulement, disent qui a le droit d'une place :
 * - **`accepts`** — le kind qui s'y range. Une voiture n'a rien à faire sur la base d'une tondeuse,
 *   et c'est ce champ qui l'interdit. Il commande AUSSI le dessin : une place de voiture se trace
 *   au sol (tirets et « P »), la base d'un robot est un objet (plaque et bloc de tête).
 * - **`deviceId`** — place RÉSERVÉE à cet appareil. Une base ne se partage pas : celle de la
 *   tondeuse n'est pas celle de l'aspirateur. Absent = place PARTAGÉE par tous les appareils du
 *   kind, ce qui est le cas des voitures : n'importe laquelle se gare dans n'importe quel garage.
 */
export const parkingSchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  accepts: z.enum(DEVICE_KINDS),
  deviceId: deviceIdSchema.optional(),
  /**
   * Niveau qui porte la place. **Absent = au sol, sur le terrain** (jardin). Une place n'est pas
   * toujours dehors : une voiture se gare dans un garage, un drone se pose sur le toit, un
   * aspirateur a sa base à l'étage — et c'est le niveau qui donne son altitude au marquage, décide
   * de la passe qui le dessine, et le fait disparaître quand on regarde un autre étage.
   */
  levelId: idSchema.optional(),
  /** Centre du rectangle (m, repère maison). */
  center: vec2Schema,
  /** `[largeur, longueur]` (m) : la longueur est l'axe avant-arrière, celui qu'oriente `yaw`. */
  size: z.tuple([parkingDimSchema, parkingDimSchema]),
  /** Cap de l'AVANT (degrés, 0 = vers +y), même convention que le `yaw` d'un appareil. */
  yaw: z.number(),
  /**
   * Distance (m) au-delà du rectangle où l'engin s'accroche encore. Absente = `PARKING_SNAP_MARGIN`.
   * Se règle place par place parce que le biais résiduel d'un GPS n'est pas le même dans un garage
   * fermé et au milieu d'une allée.
   */
  margin: z.number().min(0).max(20).optional(),
  meta: metaSchema,
})
export type Parking = z.infer<typeof parkingSchema>

export const siteSchema = z.object({
  elevation: z.number().default(0),
  terrain: polygonSchema,
  zones: z.array(zoneSchema).default([]),
  parkings: z.array(parkingSchema).default([]),
})
export type Site = z.infer<typeof siteSchema>

export const MOUNTS = ['ceiling', 'wall', 'floor', 'free'] as const
export const houseDeviceSchema = z.object({
  id: idSchema,
  /** Absent → le nom du descripteur de plugin fait foi (renommer dans l'app du fabricant se propage). */
  name: z.string().min(1).optional(),
  /** Liaison vers un appareil de plugin (`hue:…`, `mock:…`). Absent → appareil « non lié » (affiché grisé). */
  deviceId: deviceIdSchema.optional(),
  /** Indice de kind quand l'appareil n'est pas (encore) lié ; sinon le descripteur fait foi. */
  kind: z.enum(DEVICE_KINDS).optional(),
  /**
   * x, y absolus ; z RELATIF au sol de l'ancre (niveau, ou terrain pour l'extérieur).
   * **Absente = appareil NON PLACÉ** : la maison le connaît (et peut lui donner un `name`) sans
   * qu'il occupe un point de la scène 3D. C'est le cas d'un véhicule, qui n'est pas un objet du
   * bâtiment ; sa place, le jour où on la dessinera, viendra de son GPS et non de ce champ.
   */
  position: vec3Schema.optional(),
  /**
   * Correction (m, repère maison) appliquée à la place CALCULÉE d'un appareil placé par son GPS —
   * un véhicule. Ni le relevé du véhicule ni l'origine de la maison ne sont exacts au mètre : ce
   * décalage constant, saisi une fois depuis la carte du véhicule, remet la voiture sur sa place de
   * parking. Sans effet sur un appareil qui a une `position`, elle fait déjà foi.
   */
  gpsOffset: vec2Schema.optional(),
  /**
   * Correction (degrés) appliquée à l'orientation CALCULÉE d'un appareil placé par son GPS — un
   * véhicule. Elle s'ajoute à ce que la scène a déduit (cap du fabricant, axe de la pièce) : ni un
   * cap mesuré ni l'axe d'un garage ne disent de quel côté la voiture s'est garée, et un demi-tour
   * se saisit ici une fois pour toutes. Sans effet sur un appareil qui a un `yaw` : il fait déjà foi.
   */
  yawOffset: z.number().optional(),
  /**
   * Capacité utile de la batterie (kWh) d'un véhicule. **Aucun fabricant ne la donne** — ni Tesla,
   * ni Renault, pas même dans la fiche technique du véhicule, et un code batterie ne se traduit pas.
   * C'est donc une valeur SAISIE, et elle n'a qu'un usage : estimer une puissance de charge que le
   * véhicule ne dit pas (`estimateChargePowerW`). Absente = on n'estime rien.
   */
  batteryKwh: z.number().positive().max(500).optional(),
  /**
   * Carrosserie dessinée dans la scène 3D pour un véhicule : `<pluginId>/<modèle>`, l'identifiant
   * d'un modèle du catalogue web (`three/models/catalog`). `'none'` = la silhouette générique, que
   * l'on choisit pour retrouver le repère d'encombrement plutôt que la vraie forme. **Absent =
   * automatique** : le catalogue tranche d'après le plugin du véhicule, ce qui est juste dans le
   * cas courant — une seule voiture par plugin.
   */
  model3d: model3dSchema.optional(),
  /**
   * Couleur de la carrosserie (`#rrggbb`). Les modèles 3D sont livrés SANS couleur — aucun
   * fabricant ne publie la teinte d'un véhicule, et la deviner à partir du VIN n'est pas possible.
   * Absente = la scène applique sa couleur de véhicule, qui suit le thème.
   */
  bodyColor: hexColorSchema.optional(),
  /**
   * Aspect de la peinture d'un véhicule (`solid` / `metallic` / `matte`). Même règle que la couleur :
   * ce que l'utilisateur choisit l'emporte sur ce que le fabricant dit, et l'absence rend la main.
   */
  bodyFinish: z.enum(VEHICLE_FINISHES).optional(),
  levelId: idSchema.optional(),
  roomId: idSchema.optional(),
  zoneId: idSchema.optional(),
  /** Volets / capteurs d'ouverture : le marqueur épouse le rectangle de l'ouverture. */
  openingId: idSchema.optional(),
  mount: z.enum(MOUNTS).optional(),
  /** Orientation (degrés), 0 = face à +y. */
  yaw: z.number().optional(),
  /**
   * Encombrement (m) de ce qui est DESSINÉ pour l'appareil, quand la scène n'a rien d'autre pour le
   * dimensionner : un portail ou une porte de garage posés dehors sont des objets libres, alors qu'un
   * volet lié à une ouverture épouse déjà son rectangle. `width` en travers, `height` en hauteur ;
   * absent = la taille par défaut du marqueur.
   */
  size: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  /**
   * Vantaux d'un ouvrant : ce qui s'écarte quand un portail s'ouvre, et ce qui DÉCOUPE le tablier
   * d'un volet lié à une ouverture (deux vantaux = volet battant, un = tablier d'un seul tenant).
   * Absent = un seul, sauf un portail, qui en a deux.
   */
  leaves: z.union([z.literal(1), z.literal(2)]).optional(),
  /**
   * Matière d'un ouvrant (`OPENING_MATERIALS`), comme `Opening.material` l'est d'une menuiserie.
   * Absente, la scène garde la matière d'ouvrant du style de rendu. Préfixée `cover` — `style.color`
   * occupe déjà le mot « couleur » sur un appareil, et deux champs homonymes se confondraient.
   *
   * Le VERRE ne fait pas ici ce qu'il fait sur une ouverture (où il la vitre, cf. `isGlazed`) : il
   * rend le panneau translucide, et c'est ce qu'est une porte de garage vitrée.
   */
  coverMaterial: z.enum(OPENING_MATERIALS).optional(),
  /** Couleur d'un ouvrant (#rrggbb). Absente, c'est la palette du style de rendu qui la donne. */
  coverColor: hexColorSchema.optional(),
  style: z.object({ icon: z.string().optional(), color: z.string().optional() }).optional(),
  meta: metaSchema,
})
export type HouseDevice = z.infer<typeof houseDeviceSchema>
/**
 * Un appareil de la maison qui OCCUPE un point de la scène. Les autres — un véhicule, par exemple —
 * sont connus de la maison (nom, liaison) sans y avoir de place. Ce type le dit une fois, au seuil
 * de la 3D, plutôt que de forcer chaque accès à `position` à se reposer la question.
 */
export type PlacedHouseDevice = HouseDevice & { position: z.infer<typeof vec3Schema> }
export const isPlaced = (d: HouseDevice): d is PlacedHouseDevice => d.position !== undefined

export const roofSchema = z.object({
  type: z.enum(['flat', 'gable']),
  levelId: idSchema.optional(),
  outline: polygonSchema.optional(),
  pitch: z.number().min(5).max(75).default(30),
  ridgeAxis: z.enum(['x', 'y']).optional(),
  overhang: z.number().min(0).default(0.3),
})
export type Roof = z.infer<typeof roofSchema>

/** Module photovoltaïque courant (m) : `width` le long des colonnes, `height` le long des rangées. */
export const PANEL_SIZE = { width: 1.13, height: 1.76 } as const
/**
 * Puissance crête (Wc) d'un module quand le champ ne la dit pas : celle d'un panneau courant. C'est
 * l'ÉCHELLE de couleur d'un module — sa dalle en 3D, sa ligne dans la vue Énergie — et non une
 * mesure : un micro-onduleur écrête souvent en deçà, un champ neuf produit un peu au-delà.
 */
export const PANEL_PEAK_W = 450
/**
 * Champ de panneaux solaires : une grille de `rows × cols` modules posée sur un niveau (le toit,
 * déclaré comme un niveau sans pièce). Les positions des modules ne sont PAS écrites : elles se
 * dérivent de l'origine, de l'orientation et du pas (`panelArrayDevices`), donc déplacer ou pivoter
 * le champ ne touche qu'un objet.
 *
 * DEUX inclinaisons, et c'est ce qui évite de traiter à part le toit plat et le toit pentu : `slope`
 * est la pente du support (le champ épouse le toit), `tilt` l'angle de chaque module sur ce support
 * (les châssis). Un toit pentu, c'est `slope` seul ; un toit plat, `tilt` seul ; une terrasse en
 * pente, les deux. Les deux penchent le verre du MÊME côté : vers l'azimut, donc vers le soleil. `panels` lie chaque emplacement, rangée par rangée, à son
 * micro-onduleur — c'est le découpage de l'app du fabricant (un champ, puis ses onduleurs).
 */
export const panelArraySchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  /**
   * L'INSTALLATION dont ce champ fait partie (`deviceId` du site, `enphase:site`…). C'est ce qui lie
   * les panneaux à leur passerelle : retirer l'installation de la maison emporte ses champs. Absent
   * dans un fichier écrit à la main : le champ est alors rattaché à la seule installation affichée.
   */
  siteId: deviceIdSchema.optional(),
  levelId: idSchema,
  /** Coin du champ (bord de la rangée 0, colonne 0) : x, y absolus ; z RELATIF au sol du niveau. */
  origin: vec3Schema,
  /**
   * AZIMUT du champ (degrés, sens trigonométrique, 0 = vers +y) : la direction vers laquelle les
   * modules regardent, celle qu'on tourne vers le soleil. C'est aussi celle dans laquelle les rangées
   * s'éloignent de l'origine et DESCENDENT la pente — un toit descend vers le soleil, pas l'inverse.
   * Même convention que le `yaw` d'un appareil : ce qui regarde quelque part regarde vers +y à 0.
   */
  yaw: z.number().default(0),
  /**
   * Pente du SUPPORT (degrés) : le plan sur lequel le champ est posé. C'est la pente du toit sous
   * lui — 0 sur un toit plat, au sol ou sur une terrasse. Le champ DESCEND le long de ses rangées,
   * dans la direction de son azimut.
   */
  slope: z.number().min(0).max(90).default(0),
  /**
   * Inclinaison de chaque MODULE sur son support (degrés) : l'angle des châssis. 0 = posé à même le
   * toit, ce qu'on fait sur un toit pentu. POSITIF, le module se redresse face au soleil : son bord
   * bas du côté de l'azimut, son bord haut à l'opposé — c'est le montage courant d'un toit plat.
   * Négatif, il bascule dans l'autre sens (un châssis qui regarde derrière le champ).
   * Les deux angles s'ajoutent pour l'inclinaison réelle du verre.
   */
  tilt: z.number().min(-90).max(90).default(0),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  /** Le MODULE de ce champ : sa taille, et sa puissance crête (Wc) qui dit à quoi « à fond » ressemble. */
  panel: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    peakW: z.number().positive().max(2000).default(PANEL_PEAK_W),
  }).default({ ...PANEL_SIZE, peakW: PANEL_PEAK_W }),
  /**
   * PUISSANCE DE SORTIE MAXIMALE des micro-onduleurs de ce champ (W, 0 = inconnue) — le terme des
   * fiches techniques. Un onduleur ne sort pas plus : un IQ8P plafonne à 480 W sous un module de
   * 500 Wc, et la mesure bute là, pas à la crête du verre. Ça se SAISIT, parce que la passerelle ne
   * publie nulle part la fiche technique : elle ne donne que `maxReportWatts`, le record de chaque
   * onduleur (418 à 440 W sur un parc réel relevé), qui dit ce qui s'est produit — voir
   * `SensorState.maxValue`, que la vue Énergie marque à côté de celle-ci.
   */
  maxOutputW: z.number().min(0).max(2000).default(0),
  /** Espace entre deux modules (m). */
  gap: z.number().min(0).default(0.02),
  /** Appareil de plugin de chaque emplacement, rangée par rangée ; `null` = module sans onduleur suivi. Au plus rows × cols. */
  panels: z.array(deviceIdSchema.nullable()),
  meta: metaSchema,
})
export type PanelArray = z.infer<typeof panelArraySchema>

/** Scène : lot de commandes envoyées d'un coup (Départ, Nuit, Cinéma…). */
export const sceneActionSchema = z.object({ deviceId: deviceIdSchema, command: commandSchema })
export const houseSceneSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** Nom d'icône (clé du jeu d'icônes de l'app), optionnel. */
  icon: z.string().optional(),
  actions: z.array(sceneActionSchema).min(1),
})
export type HouseScene = z.infer<typeof houseSceneSchema>

/**
 * Réglages d'un PLUGIN, décidés depuis Réglages → Plugins et gardés DANS la maison : quels
 * fabricants cette maison utilise, et ce qu'on veut de chacun. Aucun secret ici — clés et jetons
 * restent dans `.env` ; le fichier maison ne porte que des choix.
 */
export const pluginSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  /** Sous-items du plugin (les kinds simulés par `mock`…), par id. Absent = défaut du plugin. */
  parts: z.record(z.string(), z.boolean()).default({}),
  /**
   * Défaut appliqué aux ambiances animées qui APPARAISSENT (créées chez le fabricant, ou qui
   * gagnent une palette). Ne touche jamais les ambiances déjà connues.
   */
  autoDynamicForNewScenes: z.boolean().default(false),
})
export type PluginSettings = z.infer<typeof pluginSettingsSchema>

/**
 * Modification partielle venue de l'UI (`PATCH /api/plugins/:id`) : seuls les champs présents sont
 * écrits. Déclaré à la main et NON par `pluginSettingsSchema.partial()` : zod applique quand même
 * le `.default()` d'un champ rendu optionnel, si bien qu'un patch `{ parts }` arrivait porteur d'un
 * `enabled: false` fantôme — basculer un sous-item éteignait le plugin.
 */
export const pluginSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  parts: z.record(z.string(), z.boolean()).optional(),
  autoDynamicForNewScenes: z.boolean().optional(),
})
export type PluginSettingsPatch = z.infer<typeof pluginSettingsPatchSchema>

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = { enabled: false, parts: {}, autoDynamicForNewScenes: false }

/**
 * Maison sans section `plugins` : la simulation seule, avec tous ses kinds — la démo tourne sans
 * rien configurer, le reste s'active dans l'UI. zod 4 ne valide PAS la valeur d'un `.default()`,
 * elle est donc écrite en entier.
 */
export const defaultPlugins = (): Record<string, PluginSettings> => ({ mock: { ...DEFAULT_PLUGIN_SETTINGS, enabled: true } })

/**
 * RÉGLAGE DE LA LUMIÈRE de la scène 3D, enregistré dans la maison (`render.tuning`). Ce sont des
 * MULTIPLICATEURS posés sur ce que le style de rendu calcule pour l'heure qu'il est : × 1 partout
 * rend le style tel quel, et la courbe jour/nuit du style survit au réglage. Les cinq derniers,
 * eux, sont les grandeurs mêmes du trait qui souligne la pièce sélectionnée — il vient du thème de
 * l'application, aucun style ne le calcule.
 *
 * Pourquoi dans la MAISON et non dans les préférences de la tablette (comme le style ou la
 * qualité) : une lumière se règle une fois, devant la maison, et vaut ensuite pour toutes les
 * tablettes qui la regardent. La qualité, elle, dépend de la machine qui dessine.
 *
 * Les bornes sont larges et strictes à la fois : larges parce qu'un goût ne se discute pas, strictes
 * parce qu'une valeur folle doit être REFUSÉE à l'écriture (400) plutôt qu'écrite puis subie. Un
 * fichier de maison abîmé à la main se refuse comme n'importe quel autre champ de la maison.
 */
const factor = (max: number) => z.number().min(0).max(max).default(1)
export const sceneTuningSchema = z.object({
  /** × sur l'exposition du style (le diaphragme). */
  exposure: factor(3),
  /** Courbe de tone mapping ; `style` laisse celle du style. */
  toneMapping: z.enum(['style', 'aces', 'agx', 'neutral', 'linear']).default('style'),
  /** × sur la force du bloom. */
  bloomStrength: factor(3),
  /** × sur le SEUIL du bloom : au-dessus de 1, seules les vraies sources bavent. */
  bloomThreshold: factor(4),
  /** × sur le rayon du bloom. */
  bloomRadius: factor(3),
  /** × sur la vignette. */
  vignette: factor(3),
  /** × sur l'opacité du halo additif posé sur une lampe allumée. */
  glowOpacity: factor(3),
  /** × sur le diamètre de ce halo. */
  glowScale: factor(3),
  /** × sur l'intensité de la lumière ponctuelle d'une lampe. */
  lightIntensity: factor(3),
  /** × sur la part émissive du globe d'une lampe. */
  emissive: factor(3),
  /** Largeur (m) du trait posé le long des murs de la pièce sélectionnée. */
  ringWidth: z.number().min(0.01).max(1).default(0.14),
  /** Éclat du trait : l'accent multiplié par ce nombre. Au-dessus de 1, le bloom l'accroche. */
  ringBoost: z.number().min(0).max(4).default(1.15),
  /** Part de blanc mêlée à l'accent avant l'éclat. */
  ringWhite: z.number().min(0).max(1).default(0.2),
  /** Opacité du trait. */
  ringOpacity: z.number().min(0).max(1).default(0.92),
  /** Opacité du voile posé sur le sol de la pièce. */
  fillOpacity: z.number().min(0).max(1).default(0.1),
  /** Le trait passe par-dessus les murs au lieu d'être caché par eux. */
  ringThrough: z.boolean().default(true),
  // ---- tilt-shift : l'effet de maquette (valeurs ABSOLUES, aucun style n'en calcule) ----
  /** Force du flou hors de la bande nette. `0` = effet éteint, et la passe n'est pas payée. */
  tiltShift: z.number().min(0).max(1).default(0),
  /** Hauteur de la bande nette dans l'image (0 = un trait, 1 = toute l'image). */
  tiltCenter: z.number().min(0).max(1).default(0.5),
  /** Demi-hauteur de la bande nette, en fraction de l'image. */
  tiltWidth: z.number().min(0.02).max(1).default(0.18),
  /**
   * Combien les pilules des appareils suivent le flou. Elles sont en DOM, hors du canvas : nettes
   * au-dessus d'une maison floutée, elles cassent la maquette ; effacées, la scène perd ses noms.
   * `0` les laisse intactes, `1` les efface autant que le flou efface la maison.
   */
  tiltPills: z.number().min(0).max(1).default(0.6),
})
export type SceneTuning = z.infer<typeof sceneTuningSchema>

/** Le réglage qui ne change rien : ce que le style calcule, sans retouche. */
export const NEUTRAL_TUNING: SceneTuning = sceneTuningSchema.parse({})

/** Ce que la maison dit du RENDU de sa scène 3D. Absent = les styles tels qu'ils sont écrits. */
export const renderSettingsSchema = z.object({
  tuning: sceneTuningSchema.optional(),
})
export type RenderSettings = z.infer<typeof renderSettingsSchema>

export const houseSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: z.string().min(1),
  origin: geoOriginSchema,
  defaults: houseDefaultsSchema.optional(),
  levels: z.array(levelSchema).min(1),
  rooms: z.array(roomSchema),
  site: siteSchema,
  devices: z.array(houseDeviceSchema).default([]),
  scenes: z.array(houseSceneSchema).default([]),
  roof: roofSchema.optional(),
  arrays: z.array(panelArraySchema).default([]),
  /** Plugins de cette maison : lesquels sont actifs, et leurs sous-items. */
  plugins: z.record(z.string(), pluginSettingsSchema).default(defaultPlugins),
  /** Réglage de la lumière de la scène 3D, posé depuis la vue Maison. */
  render: renderSettingsSchema.optional(),
  meta: metaSchema,
})
export type House = z.infer<typeof houseSchema>
/** Forme d'entrée (avant application des défauts zod) — ce qu'on écrit dans le JSON. */
export type HouseInput = z.input<typeof houseSchema>
