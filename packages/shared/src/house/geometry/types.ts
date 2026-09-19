import type { Vec2 } from './vec2'
import type { FloorStyle, OpeningMaterial, OpeningType, RoomKind, ZoneKind } from '../schema'

// Descripteurs géométriques PURS (aucune dépendance three) : c'est le contrat testé.
// Les builders côté web les transforment en BufferGeometry sans réfléchir.
// Sauf mention contraire, les z sont LOCAUX AU NIVEAU (sol fini = 0).

export type Vec3 = [number, number, number]

export interface AABB3 { min: Vec3; max: Vec3 }

export interface WallPrism {
  roomId: string
  levelId: string
  segment: number
  kind: 'interior' | 'exterior'
  /** Quad convexe CCW (plan), extrudé de z0 à z1. */
  footprint: [Vec2, Vec2, Vec2, Vec2]
  z0: number
  z1: number
  /** Renseigné pour les morceaux sous/sur une ouverture (allège, linteau). */
  openingId?: string
}

export interface OpeningRect {
  openingId: string
  roomId: string
  levelId: string
  type: OpeningType
  /** Surface qui porte l'ouverture : mur, sol (puits de lumière) ou toit (Velux). */
  host: 'wall' | 'floor' | 'roof'
  /** Coin bas-gauche de l'ouverture (z local = allège pour un mur ; face basse de la dalle / du toit pour une surface). */
  origin: Vec3
  /** Direction unitaire le long de la largeur (dans le plan). */
  u: Vec2
  /** Normale extérieure unitaire du mur (dans le plan) ; `[0, 0]` pour une surface horizontale. */
  normal: Vec2
  width: number
  height: number
  /** Épaisseur du porteur (mur, dalle ou toit). */
  depth: number
  /** Nombre de vantaux EFFECTIF (`openingLeaves`) : jamais l'optionnel du fichier. */
  leaves: number
  /** Cap (azimut) d'une ouverture de surface. */
  yaw?: number
  /** Pente (degrés depuis l'horizontal) d'une fenêtre de toit ; 0 = plat / sol. */
  slope?: number
  /** Matière de la menuiserie, si le fichier en impose une. */
  material?: OpeningMaterial
  /** Couleur de la menuiserie (#rrggbb), si le fichier en impose une. */
  color?: string
}

export interface FloorHole {
  openingId: string
  /** Quad CCW du trou dans le plan de la pièce. */
  polygon: [Vec2, Vec2, Vec2, Vec2]
}

export interface FloorDescriptor {
  roomId: string
  levelId: string
  polygon: Vec2[]
  z0: number
  z1: number
  kind: RoomKind
  floorStyle?: FloorStyle
  /** Trous des puits de lumière (`skylight`) de la pièce. */
  holes?: FloorHole[]
}

export interface TerrainDescriptor { polygon: Vec2[]; z: number }
export interface ZoneDescriptor { zoneId: string; kind: ZoneKind; polygon: Vec2[]; z: number }

export interface RoofHole {
  openingId: string
  roomId: string
  /** Quad CCW en plan (projection) — suffit pour un toit plat ; pour un gable, aussi projeté sur la face. */
  polygon: [Vec2, Vec2, Vec2, Vec2]
  /** Index de la face gable touchée ; absent pour un toit plat. */
  faceIndex?: number
  /** Quatre coins 3D sur la face (absolu) quand `faceIndex` est posé. */
  corners?: [Vec3, Vec3, Vec3, Vec3]
}

export interface RoofDescriptor {
  type: 'flat' | 'gable'
  /** Emprise agrandie du débord (plan). */
  outline: Vec2[]
  /** z absolu de la base du toit (haut des murs du dernier niveau). */
  zBase: number
  /** z absolu du point le plus haut. */
  zRidge: number
  thickness: number
  /** Faces planes convexes (coordonnées ABSOLUES), vides pour un toit plat (le builder extrude `outline`). */
  faces: Vec3[][]
  /** Trous des fenêtres de toit. */
  holes?: RoofHole[]
}

export interface LabelAnchor { roomId: string; position: Vec2 }

export interface LevelGeometry {
  levelId: string
  elevation: number
  height: number
  floors: FloorDescriptor[]
  walls: WallPrism[]
  openings: OpeningRect[]
  labelAnchors: LabelAnchor[]
}

export interface HouseGeometry {
  levels: LevelGeometry[]
  terrain: TerrainDescriptor
  zones: ZoneDescriptor[]
  roof?: RoofDescriptor
  /** Boîte englobante ABSOLUE de tout (niveaux, terrain, toit). */
  bounds: AABB3
}
