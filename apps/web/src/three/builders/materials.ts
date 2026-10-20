import { BackSide, Color, DoubleSide, LinearSRGBColorSpace, Material, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import { FINISHES, type Finish, type FinishFamily, type FinishId, type FloorStyle, type OpeningMaterial, type ZoneKind } from '@kasbah/shared'
import type { SceneTheme } from '../core/theme'
import { createSurfaceTextures, type SurfaceRole, type SurfaceTexture, type SurfaceTextures } from '../textures/procedural'
import { rolesOf, type SkyLook, type StyleLook, type SurfaceLook } from '../styles/types'

// Materials SHARED per role: a change of hour or theme mutates ~15 materials, not N meshes.
// Floors receive one clone per room (individual highlighting) attached to its role.
//
// It is the RENDER STYLE (`three/styles/`) that says, for each surface, which procedural material
// dresses it and how it responds to light; the color comes from its palette. Changing style
// touches no geometry: we mutate the same materials and hand them other maps.

export interface MaterialSet {
  wall: MeshStandardMaterial
  wallInterior: MeshStandardMaterial
  floor: MeshStandardMaterial
  floors: Record<FloorStyle, MeshStandardMaterial>
  glass: MeshPhysicalMaterial
  roof: MeshStandardMaterial
  /** Slab of a flat roof: gravel, not tiles — a style can say otherwise (`SurfaceLooks.roofFlat`). */
  roofFlat: MeshStandardMaterial
  terrain: MeshStandardMaterial
  /** Infinite ground under the plot: UNLIT, the color of the sky's ground — it extends the horizon. */
  ground: MeshBasicMaterial
  zones: Record<ZoneKind, MeshStandardMaterial>
  ghost: MeshStandardMaterial
  slat: MeshStandardMaterial
  vehicle: MeshStandardMaterial
  /** Small neutral connected objects. */
  device: MeshStandardMaterial
  /** Architectural detail (`builders/details.ts`): light rails (sills, copings)… */
  trim: MeshStandardMaterial
  /** …dark joinery (opening surrounds)… */
  frame: MeshStandardMaterial
  /** …plinth of the exterior walls… */
  plinth: MeshStandardMaterial
  /** …and door leaves. Their colors are DERIVED from the palette, no style has to give them. */
  door: MeshStandardMaterial
  /** Walls and bottom of a pool, seen from inside (back faces): light tiling under the water. */
  poolBasin: MeshStandardMaterial
  /**
   * Opening joinery that is not content with the per-kind setting: one entry per
   * `role|material|color` combination requested by the survey (`joineryMaterial`). A house that
   * declares none has none, and keeps its two draw calls.
   */
  joinery: Map<string, MeshStandardMaterial>
  /**
   * Materials of the FINISHES laid by the house (floor, walls of a room, facade): one entry per
   * `surface|finish|tint|fallback` key (`finishMaterial`). A house without finishes has none.
   */
  finishes: Map<string, MeshStandardMaterial>
  /**
   * How the current style interprets the finishes: `honor` false = a "costume" style that
   * keeps its palette (the finish takes the look of the surface it replaces); `photos` =
   * the photos already loaded, absent when the user turned off photo materials.
   */
  finishMode: { honor: boolean; photos?: Partial<Record<FinishId, SurfaceTexture>> }
  /** Last style applied: a joinery created afterward must be able to take its tint right away. */
  applied: { theme: SceneTheme; look: StyleLook } | null
  /** The materials used by the current style. They belong to the CATALOG, not to this material set. */
  textures: SurfaceTextures
  all: Set<Material>
}

/**
 * A LINEAR sky color, as is. `new Color(hex)` would convert from sRGB; here the
 * values are already light values, they must above all not be re-curved a second time.
 */
const linear = (rgb: readonly [number, number, number], k = 1) =>
  new Color().setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, LinearSRGBColorSpace)

/** What is seen below the horizon line: between the sky's ground and the horizon itself. */
export const groundColor = (sky: SkyLook) => linear(sky.ground).lerp(linear(sky.horizon), 0.35)
/** What is seen above: the canvas background, which joins the disc seamlessly. */
export const backdropColor = (sky: SkyLook) => linear(sky.horizon).lerp(linear(sky.zenith), 0.35)

/** Applies a material and its PBR settings to an existing material. */
const WHITE = new Color(0xffffff)
const BLACK = new Color(0x000000)

function surface(m: MeshStandardMaterial, color: Color, look: SurfaceLook, tex: SurfaceTexture | undefined): void {
  // a photo material carries its own color: the style's palette does not tint it
  m.color.copy(tex?.colored ? WHITE : color)
  // Recompiling a shader is costly; it is only requested if the MAPS change (hence on a change
  // of style), not at every passing hour.
  const changed = m.map !== (tex?.map ?? null)
  m.map = tex?.map ?? null
  m.normalMap = tex?.normalMap ?? null
  m.roughnessMap = tex?.roughnessMap ?? null
  m.metalnessMap = tex?.metalnessMap ?? null
  const relief = (look.relief ?? 1) * (tex?.normalScale ?? 1)
  m.normalScale.set(relief, relief)
  m.roughness = look.roughness
  m.metalness = look.metalness ?? 0
  m.emissive.copy(color).multiplyScalar(look.emissive ?? 0)
  if (changed) m.needsUpdate = true
}

/** `surface` under another name, where a `surface` parameter (the kind of finish) shadows it. */
const surface_ = (m: MeshStandardMaterial, color: Color, look: SurfaceLook, tex: SurfaceTexture | undefined) => surface(m, color, look, tex)

const std = (extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}) =>
  new MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...extra })

/**
 * The three roles of a joinery: the fixed frame of an opening, the leaf of a door, and the CURTAIN
 * of a cover (shutter, gate) — that one belongs to a device and not to the structure, but it is
 * tinted the same way, material included (`HouseDevice.coverMaterial`).
 */
export type JoineryRole = 'frame' | 'door' | 'slat'
interface Pbr { roughness: number; metalness: number }
/** The PBR setting of each role, declared HERE so that the tinted variants start from the same one. */
const ROLE_PBR: Record<JoineryRole, Pbr> = {
  frame: { roughness: 0.45, metalness: 0.1 },
  door: { roughness: 0.5, metalness: 0 },
  slat: { roughness: 0.5, metalness: 0.2 },
}
/**
 * What each material does to light. GLASS has no line: it does not change the
 * joinery, it glazes the opening (`details.ts`) — the fixed frame of a bay window is already that of a
 * window. Metal is smooth and reflects; wood is matte and reflects nothing.
 */
const MATERIAL_PBR: Partial<Record<OpeningMaterial, Pbr>> = {
  wood: { roughness: 0.6, metalness: 0 },
  metal: { roughness: 0.3, metalness: 0.85 },
  // a canvas reflects NOTHING: it is the most matte material of the set, more than oiled wood
  fabric: { roughness: 1, metalness: 0 },
}
/** A GLASS curtain: smooth, and opaque enough that one can see it is there (glazed garage door). */
const GLASS_SLAT = { roughness: 0.15, metalness: 0, opacity: 0.45 }

export function createMaterials(theme: SceneTheme, look: StyleLook, textures: SurfaceTextures = {}): MaterialSet {
  const set: Omit<MaterialSet, 'all'> = {
    wall: std(), wallInterior: std(), floor: std(),
    floors: { wood: std(), tile: std(), carpet: std(), concrete: std() },
    glass: new MeshPhysicalMaterial({ transparent: true, side: DoubleSide, depthWrite: false }),
    roof: std({ side: DoubleSide }),
    roofFlat: std(),
    terrain: std(),
    ground: new MeshBasicMaterial(),
    // the water is TRANSLUCENT: it is the tiled bottom that gives it its color and depth
    zones: { lawn: std(), pool: std({ transparent: true, opacity: 0.72 }), driveway: std(), path: std(), bed: std(), terrace: std(), other: std() },
    textures,
    ghost: std({ transparent: true, opacity: 0.12, depthWrite: false }),
    slat: std({ roughness: 0.5, metalness: 0.2 }),
    // Car body paint: smooth and metallic enough to REFLECT. These values only make sense
    // with `scene.environment` — without an environment map, the metallic part has nothing to
    // send back and the car darkens instead of shining.
    vehicle: std({ roughness: 0.28, metalness: 0.55 }),
    device: std({ roughness: 0.6, metalness: 0.1 }),
    trim: std({ roughness: 0.55 }),
    frame: std(ROLE_PBR.frame),
    plinth: std({ roughness: 0.95 }),
    door: std(ROLE_PBR.door),
    poolBasin: std({ roughness: 0.35, side: BackSide }),
    joinery: new Map(),
    finishes: new Map(),
    finishMode: { honor: false },
    applied: null,
  }
  const all = new Set<Material>()
  for (const [k, v] of Object.entries(set)) {
    if (k === 'textures' || k === 'joinery' || k === 'finishes' || k === 'finishMode' || k === 'applied') continue
    if (v instanceof Material) all.add(v)
    else for (const m of Object.values(v as Record<string, Material>)) all.add(m)
  }
  // outdoors, at the height of a level: an indoor lamp would stain them through the facade
  for (const m of [set.terrain, set.roof, set.roofFlat, ...Object.values(set.zones)]) m.userData.noLamps = true
  const mats = { ...set, all }
  applyLook(mats, theme, look)
  return mats
}

/** Bakes the materials missing for the requested style, keeps those already there. */
function ensureTextures(textures: SurfaceTextures, roles: readonly SurfaceRole[]): void {
  const missing = roles.filter((r) => !textures[r])
  if (missing.length) Object.assign(textures, createSurfaceTextures(missing))
}

/**
 * Applies a style and an hour to the existing materials (no geometry touched). It is the only
 * path: creation included, which is only a first application.
 */
/** What the weather does to OUTDOOR surfaces (`core/ambience.ts`: `wetness`, `snow`). */
export interface SurfaceWeather { wetness: number; snow: number }
export const DRY: SurfaceWeather = { wetness: 0, snow: 0 }

/** Snow white, in sRGB: not a pure white, which would burn out in the sun. */
const SNOW = new Color(0xe9edf2)

/**
 * Wets or snows over a surface already dressed by `surface()`. Rain darkens and smooths it (the
 * reflection of the sky in a puddle is a roughness that drops); snow whitens it and makes it
 * matte. A photo material carries its color as a map: whitening it through its color can do nothing
 * (it is already at white), it is the emissive that lays the snow on it.
 */
function weathered(m: MeshStandardMaterial, look: SurfaceLook, tex: SurfaceTexture | undefined, w: SurfaceWeather): void {
  if (w.wetness <= 0 && w.snow <= 0) return
  const wet = Math.min(1, Math.max(0, w.wetness))
  const snow = Math.min(1, Math.max(0, w.snow))
  m.roughness = look.roughness + (0.18 - look.roughness) * wet * 0.85
  m.color.multiplyScalar(1 - 0.3 * wet)
  if (snow > 0) {
    m.roughness = m.roughness + (0.95 - m.roughness) * snow
    if (!tex?.colored) m.color.lerp(SNOW, 0.85 * snow)
    m.emissive.lerp(SNOW, tex?.colored ? 0.45 * snow : 0.12 * snow)
  }
}

export function applyLook(mats: MaterialSet, theme: SceneTheme, look: StyleLook, photos?: SurfaceTextures, weather: SurfaceWeather = DRY): void {
  const s = look.surfaces
  const roofFlat: SurfaceLook = s.roofFlat ?? { texture: 'gravel', roughness: 1 }
  ensureTextures(mats.textures, [...rolesOf(s), 'tile', 'poolTile', roofFlat.texture])
  // a material as images (`textures/assets.ts`) takes precedence over the procedural one of the same role
  const tex = (l: SurfaceLook) => photos?.[l.texture] ?? mats.textures[l.texture]
  // outdoors, the weather is applied after the material; indoors and on the water, it is not applied
  const outdoor = (m: MeshStandardMaterial, color: Color, l: SurfaceLook) => { surface(m, color, l, tex(l)); weathered(m, l, tex(l), weather) }

  surface(mats.wall, theme.wall, s.wall, tex(s.wall))
  surface(mats.wallInterior, theme.wallInterior, s.wallInterior, tex(s.wallInterior))
  surface(mats.floor, theme.floor, s.floor, tex(s.floor))
  for (const k of Object.keys(mats.floors) as FloorStyle[]) surface(mats.floors[k], theme.floors[k], s.floors[k], tex(s.floors[k]))
  outdoor(mats.roof, theme.roof, s.roof)
  outdoor(mats.roofFlat, theme.roofFlat, roofFlat)
  outdoor(mats.terrain, theme.terrain, s.terrain)
  for (const k of Object.keys(mats.zones) as ZoneKind[]) {
    if (k === 'pool') surface(mats.zones[k], theme.zones[k], s.zones[k], tex(s.zones[k]))
    else outdoor(mats.zones[k], theme.zones[k], s.zones[k])
  }

  mats.glass.color.copy(theme.glass)
  mats.glass.opacity = look.glass.opacity
  mats.glass.roughness = look.glass.roughness
  mats.glass.metalness = look.glass.metalness
  mats.glass.emissive.copy(theme.glass).multiplyScalar(look.glass.emissive)

  mats.ground.color.copy(groundColor(look.sky))
  mats.ghost.color.copy(theme.wall)
  mats.slat.color.copy(theme.slat)
  mats.vehicle.color.copy(theme.secondary)
  mats.device.color.copy(theme.device)
  // the architectural detail is derived from the palette: a rail lighter than the wall,
  // darker joinery and plinth, a leaf the color of the parquet — a monochrome style
  // stays monochrome. First rail at 0.55 toward white: it burned out in full sun.
  mats.trim.color.copy(theme.wall).lerp(WHITE, 0.4)
  mats.frame.color.copy(roleColor(theme, 'frame'))
  mats.plinth.color.copy(theme.wall).lerp(BLACK, 0.4)
  mats.door.color.copy(roleColor(theme, 'door'))
  // the tinted joineries follow: they are recomputed ENTIRELY from their key, so a
  // change of style or hour catches them even if they were born between two applications
  mats.applied = { theme, look }
  for (const [key, m] of mats.joinery) applyJoinery(m, key, theme)
  for (const [key, m] of mats.finishes) applyFinish(mats, m, key, theme, look)
  // the pool basin: fine earthenware (`poolTile`), not the large floor tiles of the house
  const basin: SurfaceLook = { texture: 'poolTile', roughness: 0.35 }
  surface(mats.poolBasin, theme.zones.pool.clone().lerp(WHITE, 0.55), basin, tex(basin))
}

/** The color of a joinery role when the survey does not impose one: derived from the palette. */
function roleColor(theme: SceneTheme, role: JoineryRole): Color {
  if (role === 'slat') return theme.slat.clone()
  return role === 'frame' ? theme.wall.clone().lerp(BLACK, 0.55) : theme.floors.wood.clone()
}

/** `role|material|color` — the key CARRIES everything needed to recompute the material. */
const joineryKey = (role: JoineryRole, material?: OpeningMaterial, color?: string) =>
  `${role}|${material ?? ''}|${color ?? ''}`

function applyJoinery(m: MeshStandardMaterial, key: string, theme: SceneTheme): void {
  const [role, material, color] = key.split('|') as [JoineryRole, OpeningMaterial | '', string]
  // The GLASS of a CURTAIN: where an opening gets glazed (`isGlazed`), a cover, for its part, becomes
  // translucent — that is what a glazed garage door is. It only makes sense for that role.
  const glazed = role === 'slat' && material === 'glass'
  const pbr = glazed ? GLASS_SLAT : (material ? MATERIAL_PBR[material] : undefined) ?? ROLE_PBR[role]
  m.roughness = pbr.roughness
  m.metalness = pbr.metalness
  // `transparent` decides the render pass: three wants to be told when it changes
  if (m.transparent !== glazed) { m.transparent = glazed; m.needsUpdate = true }
  m.opacity = glazed ? GLASS_SLAT.opacity : 1
  // the file's color takes precedence over the material, which takes precedence over the role: the wood of a
  // joinery is the style's parquet, unless the survey said which one
  if (color) m.color.set(color)
  else if (glazed) m.color.copy(theme.glass)
  else if (material === 'wood') m.color.copy(theme.floors.wood)
  else if (material === 'metal') m.color.copy(theme.wall).lerp(BLACK, 0.65)
  // a raw canvas: the style's wall, lightened — an awning without a chosen tint must read
  // as canvas, not as a section of facade
  else if (material === 'fabric') m.color.copy(theme.wall).lerp(WHITE, 0.3)
  else m.color.copy(roleColor(theme, role))
}

/**
 * The material of a joinery — of an opening, or of a cover. With neither a requested material NOR color, it is the role's shared
 * material that is returned as is: an ordinary house keeps its two draw calls, and
 * only the openings that ask for something else cost one more.
 *
 * The variant is born with its tint: the geometry is rebuilt at every house change, so
 * well after the last style application, and a material created black would have been seen.
 */
export function joineryMaterial(
  mats: MaterialSet, role: JoineryRole, material?: OpeningMaterial, color?: string,
): MeshStandardMaterial {
  if (!material && !color) return mats[role]
  const key = joineryKey(role, material, color)
  const known = mats.joinery.get(key)
  if (known) return known
  const m = mats[role].clone()
  mats.joinery.set(key, m)
  mats.all.add(m)
  if (mats.applied) applyJoinery(m, key, mats.applied.theme)
  return m
}

// ---- finishes (floor, walls of a room, facade) -------------------------------------------------

export type FinishSurfaceKind = 'floor' | 'wall' | 'facade'

/** The procedural material that stands in for a photo, per family. */
const FAMILY_ROLE: Record<FinishFamily, SurfaceRole> = {
  wood: 'wood', tile: 'tile', carpet: 'carpet', concrete: 'concrete',
  paint: 'plaster', stone: 'stone', siding: 'siding', pavers: 'pavers',
}
/** The floor setting of the style closest to a family (roughness, relief). */
const FAMILY_FLOOR: Partial<Record<FinishFamily, FloorStyle>> = { wood: 'wood', tile: 'tile', carpet: 'carpet', concrete: 'concrete', pavers: 'concrete' }

const finishKey = (surface: FinishSurfaceKind, f: Finish, fallback?: FloorStyle) => `${surface}|${f.id}|${f.tint ?? ''}|${fallback ?? ''}`

/**
 * The material of a finish. Like a tinted joinery: created on demand, shared by key, and
 * taken up again by `applyLook` at each style or hour. `fallback` = the floor the room declared before
 * (`style.floor`): it is the one shown in a style that does not interpret finishes.
 */
export function finishMaterial(mats: MaterialSet, surface: FinishSurfaceKind, finish: Finish, fallback?: FloorStyle): MeshStandardMaterial {
  const key = finishKey(surface, finish, fallback)
  const known = mats.finishes.get(key)
  if (known) return known
  const m = std()
  mats.finishes.set(key, m)
  mats.all.add(m)
  if (mats.applied) applyFinish(mats, m, key, mats.applied.theme, mats.applied.look)
  return m
}

function applyFinish(mats: MaterialSet, m: MeshStandardMaterial, key: string, theme: SceneTheme, look: StyleLook): void {
  const [surface, id, tint, fallback] = key.split('|') as [FinishSurfaceKind, FinishId, string, FloorStyle | '']
  const s = look.surfaces
  const tex = (l: SurfaceLook) => mats.textures[l.texture]
  if (!mats.finishMode.honor) {
    // "costume" style: the finish takes the look of the surface it replaces
    if (surface === 'floor') {
      const l = fallback ? s.floors[fallback] : s.floor
      surface_(m, fallback ? theme.floors[fallback] : theme.floor, l, tex(l))
    } else if (surface === 'wall') surface_(m, theme.wallInterior, s.wallInterior, tex(s.wallInterior))
    else surface_(m, theme.wall, s.wall, tex(s.wall))
    return
  }
  const spec = FINISHES[id]
  const fam = FAMILY_FLOOR[spec.family]
  const base = surface === 'floor' ? (fam ? s.floors[fam] : s.floor) : surface === 'wall' ? s.wallInterior : s.wall
  const l: SurfaceLook = { ...base, texture: FAMILY_ROLE[spec.family], emissive: 0 }
  ensureTextures(mats.textures, [l.texture])
  const photo = mats.finishMode.photos?.[id]
  surface_(m, new Color(tint || spec.color), l, photo ?? mats.textures[l.texture])
  // a chosen tint colors the photo (a photographed white plaster, repainted)
  if (photo && tint) m.color.set(tint)
}

/** The materials are NOT freed: they belong to the shared catalog (`textures/procedural.ts`). */
export function disposeMaterials(mats: MaterialSet): void {
  for (const m of mats.all) m.dispose()
  mats.joinery.clear()
  mats.finishes.clear()
}
