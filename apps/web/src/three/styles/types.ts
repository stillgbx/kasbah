import { Color } from 'three'
import type { FloorStyle, ZoneKind } from '@kasbah/shared'
import { duskFactor, type SceneAmbience } from '../core/ambience'
import type { SurfaceRole } from '../textures/procedural'

// A RENDER STYLE decides everything that is a matter of taste: the material colors, which procedural
// material dresses which surface, how the sky is made, what post-processing does with it.
// It does NOT decide the hour (`core/ambience.ts`) nor the interface palette (`core/theme.ts`).
//
// A style is a FUNCTION of the ambience: `look(ambience)`. That is what lets the same
// "realistic" style render a summer noon and the maquette's night without two distinct styles — it
// blends its two sets of values with `dayFactor`. A style that has no night (a plan render,
// for example) simply ignores its argument.
//
// ADDING A STYLE: a file in this folder that exports a `RenderStyle`, plus a line in
// `index.ts` and two i18n keys. Nothing else to touch — neither the scene, nor the builders, nor the UI.

/** MATERIAL colors (the style gives them, the app theme does not touch them). */
export interface ScenePalette {
  wall: Color
  wallInterior: Color
  floor: Color
  floors: Record<FloorStyle, Color>
  glass: Color
  roof: Color
  /**
   * The slab of a FLAT roof: that of the slope, unless the style declares it (a green roof).
   * ALWAYS present: the scene theme is recomposed by spreading the old one, a missing key there
   * kept the previous style's color (nature's grass stayed on realistic's roof).
   */
  roofFlat: Color
  terrain: Color
  zones: Record<ZoneKind, Color>
  /** Slat of a shutter. */
  slat: Color
  /** Small neutral connected object. */
  device: Color
}

/** How a surface responds to light, and what material it is made of. */
export interface SurfaceLook {
  /** The procedural material (`textures/procedural.ts`). */
  texture: SurfaceRole
  /** Roughness where the roughness map is 1: 0 = mirror, 1 = matte. */
  roughness: number
  /** Metalness (renders ONLY reflections: without an environment map, a high value turns black). */
  metalness?: number
  /** Share of the color that the surface EMITS (a neon floor, a backlit wall). */
  emissive?: number
  /** Multiplier of the material's relief: 0 flattens it, 2 deepens it. */
  relief?: number
  /**
   * LIVING water (`effects/water.ts`), read for the pool only: 1 = it ripples and casts its
   * caustics, 0 = it stays frozen. A maquette has poured-resin water, not swell.
   */
  flow?: number
}

export interface SurfaceLooks {
  wall: SurfaceLook
  wallInterior: SurfaceLook
  floor: SurfaceLook
  floors: Record<FloorStyle, SurfaceLook>
  roof: SurfaceLook
  /** The slab of a FLAT roof, if the style distinguishes it from the slope: otherwise, gravel (`materials.ts`). */
  roofFlat?: SurfaceLook
  terrain: SurfaceLook
  zones: Record<ZoneKind, SurfaceLook>
}

export interface GlassLook {
  opacity: number
  roughness: number
  metalness: number
  /** What the glass gives back from inside when night falls (a lit window is seen from the garden). */
  emissive: number
}

/**
 * The sky, in LINEAR values not bounded to 1: it serves as the environment map for
 * the whole scene. The overshoot above 1 is not a detail — a spot capped at 255 does not
 * make a reflection, it makes a gray spot; it is the overshoot that gives the bright point.
 */
export interface SkyLook {
  zenith: readonly [number, number, number]
  horizon: readonly [number, number, number]
  ground: readonly [number, number, number]
  /** Brightness of the solar disc, in multiples of white. 0 = overcast sky, no bright point. */
  sunGlare: number
  sunColor: readonly [number, number, number]
  /** What the sky brings to the materials (`scene.environmentIntensity`). */
  intensity: number
}

export interface LightRig {
  sunColor: Color
  sunIntensity: number
  hemiSky: Color
  hemiGround: Color
  hemiIntensity: number
  ambientIntensity: number
  /** Cast shadows fade under an overcast sky or a low moon: 0 turns them off. */
  shadowOpacity: number
}

export interface PostLook {
  toneMapping: 'aces' | 'agx' | 'neutral' | 'linear'
  /** Exposure: the aperture. It is the setting that decides whether the night is readable or black. */
  exposure: number
  /** Halo around what exceeds the threshold. `null` = no bloom pass. */
  bloom: { strength: number; radius: number; threshold: number } | null
  /** Ambient occlusion: what darkens inside corners and sets objects on their ground. */
  ao: { intensity: number; radius: number } | null
  /** Darkening of the image edges, 0 to 1. */
  vignette: number
  /**
   * TILT-SHIFT: a sharp band, the rest blurred — what makes a real house read as a
   * miniature. Absent (the case of every style), the effect does not exist: it is set ONLY from
   * the bench (`styles/tuning.ts`), because it is a taste and not a property of the light.
   */
  tiltShift?: TiltShiftLook | null
  /** Grading of the finished image (`GradeLook`). Absent = neutral: the style's image, identical. */
  grade?: GradeLook | null
}

/**
 * GRADING in display space, in the output pass: `gain × (c + lift × (1 − c))`, then
 * the power `1 / gamma`, then the saturation. Per channel (r, g, b): that is what tints an image
 * without touching any light — the blue of dawn, the orange of sunset.
 */
export interface GradeLook {
  /** Raises the blacks toward this color: 0 = neutral. */
  lift: readonly [number, number, number]
  /** > 1 lightens the midtones: 1 = neutral. */
  gamma: readonly [number, number, number]
  /** Multiplies the highlights: 1 = neutral. */
  gain: readonly [number, number, number]
  /** 1 = neutral, 0 = black and white. */
  saturation: number
}

/** See `PostLook.tiltShift`. The values are fractions of the image, the origin at the BOTTOM (like UVs). */
export interface TiltShiftLook {
  /** Strength of the blur outside the sharp band. */
  strength: number
  /** Position of the sharp band, 0 = bottom of the image, 1 = top. */
  center: number
  /** Half height of the sharp band. */
  width: number
  /** How much the DOM pills follow the blur (they are not in the canvas). */
  pills: number
}

/** The halo laid on a lit lamp, and what it lights around it. */
export interface GlowLook {
  /** Diameter (m) of the halo. */
  scale: number
  /** Opacity of the halo at full brightness. */
  opacity: number
  /** Intensity of a lamp's `PointLight` at full brightness. */
  lightIntensity: number
  /** Emissive share of the lamp's globe. */
  emissive: number
}

/**
 * The garden in this style (`three/garden/`). Absent = its NATURAL colors: the greens of the
 * families, those of the season, the colors specific to each species. Present, the style's palette
 * replaces all of that — a species keeps its silhouette, its seasons (remaining foliage) and its
 * fruit, but takes the style's tints.
 */
export interface GardenLook {
  /** Foliage tints; each element takes one, drawn by its seed. */
  leaf: readonly Color[]
  bark: Color
  stone: Color
  /** Fruit and flowers. `null` = the species'. */
  accent: Color | null
  /** EMITTED share of the foliage and fruit (neon); absent = nothing emits. */
  emissive?: number
  /** Remaining foliage, on top of the season's: < 1 thins it out (half-dead trees). */
  foliage?: number
}

/** Who parades around the house (`effects/parade.ts`). */
export type ParadeKind = 'noel' | 'halloween' | 'tatooine' | 'akira' | 'girlyversaire'

/** Everything the scene reads from a style, for a given ambience. */
export interface StyleLook {
  palette: ScenePalette
  surfaces: SurfaceLooks
  glass: GlassLook
  sky: SkyLook
  lighting: LightRig
  post: PostLook
  glow: GlowLook
  /**
   * Bats circling the house (`effects/bats.ts`). Absent or `count` 0 = none.
   * The tint belongs to the style: a black silhouette gets lost at night over a black garden.
   */
  bats?: { count: number; color: Color }
  /**
   * Mirror ball above the roof and spotlights sweeping the house (`effects/disco.ts`).
   * Absent or `spots` 0 = nothing. The spotlights go from one color of `colors` to the next.
   */
  disco?: { spots: number; colors: readonly Color[] }
  /**
   * Characters circling the house (`effects/parade.ts`): Santa's
   * sleigh, the Halloween ghosts and skeletons, X-wings, Kaneda's bike. Absent = nobody.
   */
  parade?: { kind: ParadeKind }
  garden?: GardenLook
}

export interface RenderStyle {
  readonly id: string
  /** i18n key of the displayed name (`scene.styles.<id>`). */
  readonly labelKey: string
  /**
   * Pack of photo materials (`textures/assets.ts`) that this style can carry, role for role, in
   * place of its procedural materials. Absent = fully computed style (the switch in
   * Settings is then grayed out).
   */
  readonly assets?: string
  look(ambience: SceneAmbience): StyleLook
}

// ---- style-writing tools ------------------------------------------------------------------------

/** A DECLARED palette: hexadecimals, easier to write and to reread than a `new Color`. */
export interface PaletteSpec {
  wall: string
  wallInterior: string
  floor: string
  floors: Record<FloorStyle, string>
  glass: string
  roof: string
  /** Absent = the roof color (`roof`). */
  roofFlat?: string
  terrain: string
  zones: Record<ZoneKind, string>
  slat: string
  device: string
}

const mixColor = (a: string, b: string, t: number) => new Color(a).lerp(new Color(b), t)
const mixRecord = <K extends string>(a: Record<K, string>, b: Record<K, string>, t: number) =>
  Object.fromEntries((Object.keys(a) as K[]).map((k) => [k, mixColor(a[k], b[k], t)])) as Record<K, Color>

/** A declared palette, as is: for a style whose materials do not change with the hour. */
export const toPalette = (p: PaletteSpec): ScenePalette => mixPalette(p, p, 0)

/**
 * Blends two declared palettes. `t` = 0 returns the first, 1 the second; the styles use it
 * to go from their night to their day with `dayFactor`, without writing the same structure twice.
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

/** Linear interpolation, the basic tool of a style that changes with the hour. */
export const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Same for a sky triplet. */
export function mixRgb(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
}

export const NEUTRAL_GRADE: GradeLook = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1 }
/** Sunset: orange highlights, slightly purplish blacks, bolder colors. */
const DUSK_GRADE: GradeLook = { lift: [0.012, 0, 0.03], gamma: [1.03, 1, 0.96], gain: [1.08, 0.97, 0.85], saturation: 1.1 }
/** Dawn: cold and pale, a blue that has not warmed up yet. */
const DAWN_GRADE: GradeLook = { lift: [0, 0.008, 0.03], gamma: [0.98, 1, 1.03], gain: [0.93, 0.99, 1.08], saturation: 0.94 }

/**
 * The grading of the HOUR: neutral in broad daylight and in the dead of night, orange when the sun skims
 * the horizon in the west, bluish when it is in the east. An overcast sky largely turns it off:
 * no sun, no sunset color. `strength` doses it per style.
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

/** All the material roles a look uses: they are the only ones to bake. */
export function rolesOf(s: SurfaceLooks): SurfaceRole[] {
  return [
    s.wall.texture, s.wallInterior.texture, s.floor.texture, s.roof.texture, s.terrain.texture,
    ...(s.roofFlat ? [s.roofFlat.texture] : []),
    ...Object.values<SurfaceLook>(s.floors).map((l) => l.texture),
    ...Object.values<SurfaceLook>(s.zones).map((l) => l.texture),
  ]
}
