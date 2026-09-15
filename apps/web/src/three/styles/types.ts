import { Color } from 'three'
import type { FloorStyle, ZoneKind } from '@kasbah/shared'
import type { SceneAmbience } from '../core/ambience'
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
}

export interface SurfaceLooks {
  wall: SurfaceLook
  wallInterior: SurfaceLook
  floor: SurfaceLook
  floors: Record<FloorStyle, SurfaceLook>
  roof: SurfaceLook
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

/** Tout ce que la scène lit d'un style, pour une ambiance donnée. */
export interface StyleLook {
  palette: ScenePalette
  surfaces: SurfaceLooks
  glass: GlassLook
  sky: SkyLook
  lighting: LightRig
  post: PostLook
  glow: GlowLook
}

export interface RenderStyle {
  readonly id: string
  /** Clé i18n du nom affiché (`scene.styles.<id>`). */
  readonly labelKey: string
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

/** Tous les rôles de matière qu'un look emploie : ce sont les seuls à cuire. */
export function rolesOf(s: SurfaceLooks): SurfaceRole[] {
  return [
    s.wall.texture, s.wallInterior.texture, s.floor.texture, s.roof.texture, s.terrain.texture,
    ...Object.values<SurfaceLook>(s.floors).map((l) => l.texture),
    ...Object.values<SurfaceLook>(s.zones).map((l) => l.texture),
  ]
}
