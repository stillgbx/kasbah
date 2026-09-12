import { z } from 'zod'
import { DEVICE_KINDS } from '../devices/kinds'
import { deviceIdSchema } from '../devices/descriptor'
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

export const OPENING_TYPES = ['door', 'window', 'passage', 'garage'] as const
export type OpeningType = (typeof OPENING_TYPES)[number]
export const openingSchema = z.object({
  id: idSchema,
  type: z.enum(OPENING_TYPES),
  /** Arête polygon[segment] → polygon[(segment+1) % n]. */
  segment: z.number().int().min(0),
  /** Distance (m) depuis polygon[segment] jusqu'au bord proche de l'ouverture. */
  offset: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  /** Hauteur d'allège depuis le sol fini. Défaut : 0 (porte/passage/garage) ou defaults.windowSill (fenêtre). */
  sill: z.number().min(0).optional(),
  style: metaSchema,
  meta: metaSchema,
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

export const siteSchema = z.object({
  elevation: z.number().default(0),
  terrain: polygonSchema,
  zones: z.array(zoneSchema).default([]),
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
  /** x, y absolus ; z RELATIF au sol de l'ancre (niveau, ou terrain pour l'extérieur). */
  position: vec3Schema,
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
  /** Battants d'un portail ou d'une porte : ce qui s'écarte quand il s'ouvre. Absent = un seul. */
  leaves: z.union([z.literal(1), z.literal(2)]).optional(),
  style: z.object({ icon: z.string().optional(), color: z.string().optional() }).optional(),
  meta: metaSchema,
})
export type HouseDevice = z.infer<typeof houseDeviceSchema>

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
 * Champ de panneaux solaires : une grille de `rows × cols` modules posée sur un niveau (le toit,
 * déclaré comme un niveau sans pièce). Les positions des modules ne sont PAS écrites : elles se
 * dérivent de l'origine, de l'orientation et du pas (`panelArrayDevices`), donc déplacer ou pivoter
 * le champ ne touche qu'un objet. `panels` lie chaque emplacement, rangée par rangée, à son
 * micro-onduleur — c'est le découpage de l'app du fabricant (un champ, puis ses onduleurs).
 */
export const panelArraySchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  levelId: idSchema,
  /** Coin du champ (bord de la rangée 0, colonne 0) : x, y absolus ; z RELATIF au sol du niveau. */
  origin: vec3Schema,
  /** Orientation (degrés, sens trigonométrique) : 0 = colonnes vers +x, rangées vers +y. */
  yaw: z.number().default(0),
  /** Inclinaison des modules (degrés) : le champ monte le long de ses rangées. 0 = à plat. */
  tilt: z.number().min(0).max(90).default(0),
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  panel: z.object({ width: z.number().positive(), height: z.number().positive() }).default(PANEL_SIZE),
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
  meta: metaSchema,
})
export type House = z.infer<typeof houseSchema>
/** Forme d'entrée (avant application des défauts zod) — ce qu'on écrit dans le JSON. */
export type HouseInput = z.input<typeof houseSchema>
