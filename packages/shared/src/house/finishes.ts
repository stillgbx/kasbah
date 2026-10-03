// Catalogue des FINITIONS : ce qu'on pose sur le sol et les murs d'une pièce, et sur la façade.
//
// Une pièce enregistre une finition (« parquet chêne clair »), jamais une image : c'est la scène qui
// l'interprète selon le style de rendu — photo ambientCG (CC0) dans les styles qui portent un pack
// d'images, matière procédurale de sa FAMILLE teinte de sa couleur moyenne sinon. Les styles « de
// costume » (cyberpunk, indigo…) gardent leur palette et ignorent les finitions.
//
// Les images vivent sous `apps/web/public/assets/textures/<dir>/{color,normal,roughness,thumb}.jpg`,
// produites par `scripts/fetch-textures.mjs` (même liste d'identifiants ambientCG, à tenir ensemble ;
// un test côté web vérifie que chaque `dir` existe).

/** Surfaces qu'une finition peut habiller. */
export type FinishSurface = 'floor' | 'wall' | 'facade'

/** Famille : le regroupement du sélecteur, et la matière procédurale de repli. */
export const FINISH_FAMILIES = ['wood', 'tile', 'carpet', 'concrete', 'paint', 'stone', 'siding', 'pavers'] as const
export type FinishFamily = (typeof FINISH_FAMILIES)[number]

export interface FinishSpec {
  family: FinishFamily
  surfaces: readonly FinishSurface[]
  /** Identifiant ambientCG (provenance, `SOURCES.md`). */
  asset: string
  /** Dossier sous `assets/textures/` (les dix matières du pack d'origine restent où elles étaient). */
  dir: string
  /** Côté (m) couvert par une image : la cote publiée par ambientCG, à l'œil quand elle manque. */
  tileM: number
  /** Couleur moyenne (sRGB) de la photo : la teinte du repli procédural. */
  color: string
  /** Une teinte libre peut remplacer la couleur de la photo (peintures et enduits seulement). */
  tintable?: boolean
}

const F = (family: FinishFamily, surfaces: FinishSurface[], asset: string, tileM: number, color: string, dir = `finishes/${asset}`, tintable?: boolean): FinishSpec =>
  ({ family, surfaces, asset, dir, tileM, color, ...(tintable ? { tintable } : {}) })

export const FINISHES = {
  // parquets
  'oak': F('wood', ['floor'], 'WoodFloor051', 1.8, '#987c5c', 'photo/wood'),
  'light-oak': F('wood', ['floor'], 'WoodFloor040', 1.9, '#b98753'),
  'honey-oak': F('wood', ['floor'], 'WoodFloor062', 1.8, '#9c7345'),
  'walnut': F('wood', ['floor'], 'WoodFloor064', 1.8, '#6a4415'),
  'herringbone': F('wood', ['floor'], 'WoodFloor036', 1.9, '#e2c7a2'),
  'basketweave': F('wood', ['floor'], 'WoodFloor070', 1.2, '#5c340f'),
  'decking': F('wood', ['floor'], 'Planks029S', 2.4, '#918164'),
  // carrelages et pierres
  'white-tile': F('tile', ['floor', 'wall'], 'Tiles107', 4.8, '#fcf5fb', 'photo/tile'),
  'light-stone-tile': F('tile', ['floor'], 'Tiles141', 2, '#d1cbc6'),
  'limestone-tile': F('tile', ['floor'], 'Tiles143', 2, '#dbb390'),
  'black-tile': F('tile', ['floor', 'wall'], 'Tiles052', 1.5, '#1c1820'),
  'terrazzo': F('tile', ['floor'], 'Tiles040', 1.8, '#ded7de'),
  'marble': F('tile', ['floor', 'wall'], 'Marble014', 2, '#d4c1b3'),
  'travertine': F('tile', ['floor', 'wall'], 'Travertine009', 1.2, '#dcccae'),
  'mosaic-tile': F('tile', ['floor', 'wall'], 'Tiles133A', 1.2, '#d0dde0', 'photo/poolTile'),
  'subway-tile': F('tile', ['wall'], 'Tiles136A', 1, '#c9cfd3'),
  'hex-tile': F('tile', ['floor', 'wall'], 'Tiles071', 0.45, '#f0e8ef'),
  'cement-tile': F('tile', ['floor', 'wall'], 'Tiles101', 1, '#bcbce1'),
  // moquettes
  'beige-carpet': F('carpet', ['floor'], 'Carpet016', 1.7, '#bfaf92', 'photo/carpet'),
  'navy-carpet': F('carpet', ['floor'], 'Carpet012', 1.5, '#36394c'),
  'white-carpet': F('carpet', ['floor'], 'Carpet014', 1.5, '#bfb9b4'),
  // bétons
  'grey-concrete': F('concrete', ['floor', 'wall', 'facade'], 'Concrete046', 2.4, '#d0ccb9', 'photo/concrete'),
  'polished-concrete': F('concrete', ['floor', 'wall'], 'Concrete016', 2.4, '#7d8388'),
  'beige-concrete': F('concrete', ['floor', 'wall', 'facade'], 'Concrete048', 2.4, '#a09987'),
  // enduits et peintures : teintables
  'smooth-plaster': F('paint', ['wall', 'facade'], 'Plaster001', 2, '#d8d2cd', 'photo/plaster', true),
  'matte-paint': F('paint', ['wall', 'facade'], 'PaintedPlaster017', 2, '#c3bdb8', undefined, true),
  'rough-plaster': F('paint', ['wall', 'facade'], 'Plaster002', 2, '#dbd5d0', undefined, true),
  // briques et pierres
  'ashlar': F('stone', ['wall', 'facade'], 'Bricks100', 2.5, '#8c7c50', 'photo/stone'),
  'red-brick': F('stone', ['wall', 'facade'], 'Bricks101', 2, '#a17058'),
  'white-brick': F('stone', ['wall', 'facade'], 'Bricks060', 1.05, '#ddd7d2'),
  'rubble-stone': F('stone', ['wall', 'facade'], 'Bricks084', 2, '#afa583'),
  // bois en paroi
  'wood-siding': F('siding', ['wall', 'facade'], 'WoodSiding009', 1.2, '#cac19e'),
  // dallages (terrasses, balcons)
  'mixed-pavers': F('pavers', ['floor'], 'PavingStones128', 3.5, '#9f9b8b', 'photo/pavers'),
  'grey-slabs': F('pavers', ['floor'], 'PavingStones136', 2, '#a59673'),
  'herringbone-pavers': F('pavers', ['floor'], 'PavingStones137', 1.8, '#8c714e'),
  'long-slabs': F('pavers', ['floor'], 'PavingStones144', 2, '#9f9b8e'),
} as const satisfies Record<string, FinishSpec>

export type FinishId = keyof typeof FINISHES
export const FINISH_IDS = Object.keys(FINISHES) as [FinishId, ...FinishId[]]

export const finishSpec = (id: FinishId): FinishSpec => FINISHES[id]

/** Les finitions qui peuvent habiller cette surface, dans l'ordre du catalogue. */
export const finishesFor = (surface: FinishSurface): FinishId[] =>
  FINISH_IDS.filter((id) => (FINISHES[id].surfaces as readonly FinishSurface[]).includes(surface))
