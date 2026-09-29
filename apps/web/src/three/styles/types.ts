import { Color } from 'three'
import type { FloorStyle, ZoneKind } from '@kasbah/shared'
import { duskFactor, type SceneAmbience } from '../core/ambience'
import type { SurfaceRole } from '../textures/procedural'

// Un STYLE DE RENDU décide de tout ce qui relève du goût : les couleurs de matière, quelle matière
// procédurale habille quelle surface, comment le ciel est fait, ce que le post-traitement en fait.
// Il ne décide PAS de l'heure (`core/ambience.ts`) ni de la palette de l'interface (`core/theme.ts`).
//
// Un style est une FONCTION de l'ambiance : `look(ambience)`. C'est ce qui permet au même style
// « réaliste » de rendre un midi d'été et la nuit de la maquette sans deux styles distincts — il
// mélange ses deux jeux de valeurs avec `dayFactor`. Un style qui n'a pas de nuit (un rendu de plan,
// par exemple) ignore simplement son argument.
//
// AJOUTER UN STYLE : un fichier dans ce dossier qui exporte un `RenderStyle`, plus une ligne dans
// `index.ts` et deux clés i18n. Rien d'autre à toucher — ni la scène, ni les builders, ni l'UI.

/** Couleurs de MATIÈRE (le style les donne, le thème de l'app n'y touche pas). */
export interface ScenePalette {
  wall: Color
  wallInterior: Color
  floor: Color
  floors: Record<FloorStyle, Color>
  glass: Color
  roof: Color
  /**
   * La dalle d'un toit PLAT : celle du versant, sauf si le style la déclare (un toit végétalisé).
   * TOUJOURS présente : le thème de scène se recompose en étalant l'ancien, une clé absente y
   * gardait la couleur du style précédent (l'herbe de nature restait sur le toit du réaliste).
   */
  roofFlat: Color
  terrain: Color
  zones: Record<ZoneKind, Color>
  /** Lame d'un volet. */
  slat: Color
  /** Petit objet connecté neutre. */
  device: Color
}

/** Comment une surface répond à la lumière, et de quelle matière elle est faite. */
export interface SurfaceLook {
  /** La matière procédurale (`textures/procedural.ts`). */
  texture: SurfaceRole
  /** Rugosité là où la carte de rugosité vaut 1 : 0 = miroir, 1 = mat. */
  roughness: number
  /** Métallicité (ne rend QUE des reflets : sans carte d'environnement, une valeur haute noircit). */
  metalness?: number
  /** Part de la couleur que la surface ÉMET (un sol de néon, une paroi rétroéclairée). */
  emissive?: number
  /** Multiplicateur du relief de la matière : 0 l'aplatit, 2 le creuse. */
  relief?: number
  /**
   * Eau VIVANTE (`effects/water.ts`), lu pour la seule piscine : 1 = elle ondule et projette ses
   * caustiques, 0 = elle reste figée. Une maquette a de l'eau en résine coulée, pas de la houle.
   */
  flow?: number
}

export interface SurfaceLooks {
  wall: SurfaceLook
  wallInterior: SurfaceLook
  floor: SurfaceLook
  floors: Record<FloorStyle, SurfaceLook>
  roof: SurfaceLook
  /** La dalle d'un toit PLAT, si le style la distingue du versant : à défaut, du gravillon (`materials.ts`). */
  roofFlat?: SurfaceLook
  terrain: SurfaceLook
  zones: Record<ZoneKind, SurfaceLook>
}

export interface GlassLook {
  opacity: number
  roughness: number
  metalness: number
  /** Ce que la vitre renvoie de l'intérieur quand la nuit tombe (une fenêtre allumée se voit du jardin). */
  emissive: number
}

/**
 * Le ciel, en valeurs LINÉAIRES et non bornées à 1 : c'est lui qui sert de carte d'environnement à
 * toute la scène. Le dépassement au-dessus de 1 n'est pas un détail — une tache plafonnée à 255 ne
 * fait pas un reflet, elle fait une tache grise ; c'est le dépassement qui donne le point brillant.
 */
export interface SkyLook {
  zenith: readonly [number, number, number]
  horizon: readonly [number, number, number]
  ground: readonly [number, number, number]
  /** Éclat du disque solaire, en multiples du blanc. 0 = ciel couvert, pas de point brillant. */
  sunGlare: number
  sunColor: readonly [number, number, number]
  /** Ce que le ciel apporte aux matériaux (`scene.environmentIntensity`). */
  intensity: number
}

export interface LightRig {
  sunColor: Color
  sunIntensity: number
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
  ambientIntensity: number
  /** Les ombres portées s'effacent sous un ciel couvert ou une lune basse : 0 les éteint. */
  shadowOpacity: number
}

export interface PostLook {
  toneMapping: 'aces' | 'agx' | 'neutral' | 'linear'
  /** Exposition : le diaphragme. C'est le réglage qui décide si la nuit est lisible ou noire. */
  exposure: number
  /** Halo autour de ce qui dépasse le seuil. `null` = pas de passe de bloom. */
  bloom: { strength: number; radius: number; threshold: number } | null
  /** Occlusion ambiante : ce qui assombrit les angles rentrants et pose les objets sur leur sol. */
  ao: { intensity: number; radius: number } | null
  /** Assombrissement des bords de l'image, 0 à 1. */
  vignette: number
  /**
   * TILT-SHIFT : une bande nette, le reste flou — ce qui fait lire une vraie maison comme une
   * maquette. Absent (le cas de tous les styles), l'effet n'existe pas : il ne se règle QUE depuis
   * le banc (`styles/tuning.ts`), parce que c'est un goût et non une propriété de la lumière.
   */
  tiltShift?: TiltShiftLook | null
  /** Étalonnage de l'image finie (`GradeLook`). Absent = neutre : l'image du style, à l'identique. */
  grade?: GradeLook | null
}

/**
 * ÉTALONNAGE en espace d'affichage, dans la passe de sortie : `gain × (c + lift × (1 − c))`, puis
 * la puissance `1 / gamma`, puis la saturation. Par canal (r, g, b) : c'est ce qui teinte une image
 * sans toucher à aucune lumière — le bleu de l'aube, l'orangé du couchant.
 */
export interface GradeLook {
  /** Relève les noirs vers cette couleur : 0 = neutre. */
  lift: readonly [number, number, number]
  /** > 1 éclaircit les tons moyens : 1 = neutre. */
  gamma: readonly [number, number, number]
  /** Multiplie les hautes lumières : 1 = neutre. */
  gain: readonly [number, number, number]
  /** 1 = neutre, 0 = noir et blanc. */
  saturation: number
}

/** Voir `PostLook.tiltShift`. Les valeurs sont en fraction de l'image, l'origine en BAS (comme les UV). */
export interface TiltShiftLook {
  /** Force du flou hors de la bande nette. */
  strength: number
  /** Position de la bande nette, 0 = bas de l'image, 1 = haut. */
  center: number
  /** Demi-hauteur de la bande nette. */
  width: number
  /** Combien les pilules DOM suivent le flou (elles ne sont pas dans le canvas). */
  pills: number
}

/** Le halo posé sur une lampe allumée, et ce qu'elle éclaire autour d'elle. */
export interface GlowLook {
  /** Diamètre (m) du halo. */
  scale: number
  /** Opacité du halo à pleine luminosité. */
  opacity: number
  /** Intensité de la `PointLight` d'une lampe à pleine luminosité. */
  lightIntensity: number
  /** Part émissive du globe de la lampe. */
  emissive: number
}

/**
 * Le jardin dans ce style (`three/garden/`). Absent = ses couleurs NATURELLES : les verts des
 * familles, ceux de la saison, les couleurs propres à chaque espèce. Présent, la palette du style
 * remplace tout cela — une espèce garde sa silhouette, ses saisons (feuillage restant) et ses
 * fruits, mais prend les teintes du style.
 */
export interface GardenLook {
  /** Teintes du feuillage ; chaque élément en prend une, tirée par sa graine. */
  leaf: readonly Color[]
  bark: Color
  stone: Color
  /** Fruits et fleurs. `null` = ceux de l'espèce. */
  accent: Color | null
  /** Part ÉMISE du feuillage et des fruits (néon) ; absent = rien n'émet. */
  emissive?: number
  /** Feuillage restant, en plus de celui de la saison : < 1 dégarnit (arbres à moitié morts). */
  foliage?: number
}

/** Tout ce que la scène lit d'un style, pour une ambiance donnée. */
export interface StyleLook {
  palette: ScenePalette
  surfaces: SurfaceLooks
  glass: GlassLook
  sky: SkyLook
  lighting: LightRig
  post: PostLook
  glow: GlowLook
  /**
   * Chauves-souris qui tournent autour de la maison (`effects/bats.ts`). Absent ou `count` 0 = aucune.
   * La teinte est au style : une silhouette noire se perd la nuit sur un jardin noir.
   */
  bats?: { count: number; color: Color }
  /**
   * Boule à facettes au-dessus du toit et projecteurs qui balaient la maison (`effects/disco.ts`).
   * Absent ou `spots` 0 = rien. Les projecteurs passent d'une couleur de `colors` à la suivante.
   */
  disco?: { spots: number; colors: readonly Color[] }
  garden?: GardenLook
}

export interface RenderStyle {
  readonly id: string
  /** Clé i18n du nom affiché (`scene.styles.<id>`). */
  readonly labelKey: string
  /**
   * Pack de matières en images (`textures/assets.ts`) que ce style sait porter, rôle pour rôle, à
   * la place de ses matières procédurales. Absent = style entièrement calculé (le switch des
   * Réglages est alors grisé).
   */
  readonly assets?: string
  look(ambience: SceneAmbience): StyleLook
}

// ---- outils d'écriture des styles ---------------------------------------------------------------

/** Une palette DÉCLARÉE : des hexadécimaux, plus lisibles à écrire et à relire qu'un `new Color`. */
export interface PaletteSpec {
  wall: string
  wallInterior: string
  floor: string
  floors: Record<FloorStyle, string>
  glass: string
  roof: string
  /** Absente = la couleur du toit (`roof`). */
  roofFlat?: string
  terrain: string
  zones: Record<ZoneKind, string>
  slat: string
  device: string
}

const mixColor = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t)
const mixRecord = <K extends string>(a: Record<K, string>, b: Record<K, string>, t: number) =>
  Object.fromEntries((Object.keys(a) as K[]).map((k) => [k, mixColor(a[k], b[k], t)])) as Record<K, Color>

/** Une palette déclarée, telle quelle : pour un style dont les matières ne changent pas avec l'heure. */
export const toPalette = (p: PaletteSpec): ScenePalette => mixPalette(p, p, 0)

/**
 * Mélange deux palettes déclarées. `t` = 0 rend la première, 1 la seconde ; les styles s'en servent
 * pour passer de leur nuit à leur jour avec `dayFactor`, sans écrire deux fois la même structure.
 */
export function mixPalette(night: PaletteSpec, day: PaletteSpec, t: number): ScenePalette {
  return {
    wall: mixColor(night.wall, day.wall, t),
    wallInterior: mixColor(night.wallInterior, day.wallInterior, t),
    floor: mixColor(night.floor, day.floor, t),
    floors: mixRecord(night.floors, day.floors, t),
    glass: mixColor(night.glass, day.glass, t),
    roof: mixColor(night.roof, day.roof, t),
    roofFlat: mixColor(night.roofFlat ?? night.roof, day.roofFlat ?? day.roof, t),
    terrain: mixColor(night.terrain, day.terrain, t),
    zones: mixRecord(night.zones, day.zones, t),
    slat: mixColor(night.slat, day.slat, t),
    device: mixColor(night.device, day.device, t),
  }
}

/** Interpolation linéaire, l'outil de base d'un style qui change avec l'heure. */
export const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Idem pour un triplet de ciel. */
export function mixRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

export const NEUTRAL_GRADE: GradeLook = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1 }
/** Le couchant : hautes lumières orangées, noirs un peu violacés, couleurs plus franches. */
const DUSK_GRADE: GradeLook = { lift: [0.012, 0, 0.03], gamma: [1.03, 1, 0.96], gain: [1.08, 0.97, 0.85], saturation: 1.1 }
/** L'aube : froide et pâle, un bleu qui n'a pas encore chauffé. */
const DAWN_GRADE: GradeLook = { lift: [0, 0.008, 0.03], gamma: [0.98, 1, 1.03], gain: [0.93, 0.99, 1.08], saturation: 0.94 }

/**
 * L'étalonnage de l'HEURE : neutre en plein jour et en pleine nuit, orangé quand le soleil rase
 * l'horizon à l'ouest, bleuté quand il y est à l'est. Un ciel couvert l'éteint en grande partie :
 * sans soleil, pas de couleur de couchant. `strength` le dose par style.
 */
export function hourGrade(a: SceneAmbience, strength = 1): GradeLook {
  const k = duskFactor(a) * (1 - 0.7 * a.cloudiness) * strength
  const target = a.sunAzimuthDeg < 180 ? DAWN_GRADE : DUSK_GRADE
  return {
    lift: mixRgb(NEUTRAL_GRADE.lift, target.lift, k),
    gamma: mixRgb(NEUTRAL_GRADE.gamma, target.gamma, k),
    gain: mixRgb(NEUTRAL_GRADE.gain, target.gain, k),
    saturation: mix(NEUTRAL_GRADE.saturation, target.saturation, k),
  }
}

/** Tous les rôles de matière qu'un look emploie : ce sont les seuls à cuire. */
export function rolesOf(s: SurfaceLooks): SurfaceRole[] {
  return [
    s.wall.texture, s.wallInterior.texture, s.floor.texture, s.roof.texture, s.terrain.texture,
    ...(s.roofFlat ? [s.roofFlat.texture] : []),
    ...Object.values<SurfaceLook>(s.floors).map((l) => l.texture),
    ...Object.values<SurfaceLook>(s.zones).map((l) => l.texture),
  ]
}
