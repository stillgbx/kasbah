import { BackSide, Color, DoubleSide, LinearSRGBColorSpace, Material, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import type { FloorStyle, OpeningMaterial, ZoneKind } from '@kasbah/shared'
import type { SceneTheme } from '../core/theme'
import { createSurfaceTextures, type SurfaceRole, type SurfaceTexture, type SurfaceTextures } from '../textures/procedural'
import { rolesOf, type SkyLook, type StyleLook, type SurfaceLook } from '../styles/types'

// Matériaux PARTAGÉS par rôle : un changement d'heure ou de thème mute ~15 matériaux, pas N maillages.
// Les sols reçoivent un clone par pièce (surbrillance individuelle) rattaché à son rôle.
//
// C'est le STYLE DE RENDU (`three/styles/`) qui dit, pour chaque surface, quelle matière procédurale
// l'habille et comment elle répond à la lumière ; la couleur vient de sa palette. Changer de style ne
// touche aucune géométrie : on mute les mêmes matériaux et on leur repasse d'autres cartes.

export interface MaterialSet {
  wall: MeshStandardMaterial
  wallInterior: MeshStandardMaterial
  floor: MeshStandardMaterial
  floors: Record<FloorStyle, MeshStandardMaterial>
  glass: MeshPhysicalMaterial
  roof: MeshStandardMaterial
  /** Dalle d'un toit plat : du gravillon, pas des tuiles — un style peut dire autrement (`SurfaceLooks.roofFlat`). */
  roofFlat: MeshStandardMaterial
  terrain: MeshStandardMaterial
  /** Sol infini sous la parcelle : NON éclairé, de la couleur du sol du ciel — il prolonge l'horizon. */
  ground: MeshBasicMaterial
  zones: Record<ZoneKind, MeshStandardMaterial>
  ghost: MeshStandardMaterial
  slat: MeshStandardMaterial
  vehicle: MeshStandardMaterial
  /** Petits objets connectés neutres. */
  device: MeshStandardMaterial
  /** Détail architectural (`builders/details.ts`) : lisses claires (appuis, couronnements)… */
  trim: MeshStandardMaterial
  /** …menuiseries sombres (encadrements des baies)… */
  frame: MeshStandardMaterial
  /** …soubassement des murs extérieurs… */
  plinth: MeshStandardMaterial
  /** …et vantaux des portes. Leurs couleurs se DÉDUISENT de la palette, aucun style n'a à les donner. */
  door: MeshStandardMaterial
  /** Parois et fond d'une piscine, vus de l'intérieur (faces arrière) : carrelage clair sous l'eau. */
  poolBasin: MeshStandardMaterial
  /**
   * Menuiseries d'ouvertures qui ne se contentent pas du réglage par nature : une entrée par
   * combinaison `rôle|matière|couleur` demandée par le relevé (`joineryMaterial`). Une maison qui
   * n'en déclare aucune n'en a aucune, et garde ses deux appels de dessin.
   */
  joinery: Map<string, MeshStandardMaterial>
  /** Dernier style appliqué : une menuiserie créée après coup doit pouvoir se teindre tout de suite. */
  applied: { theme: SceneTheme; look: StyleLook } | null
  /** Les matières employées par le style courant. Elles appartiennent au CATALOGUE, pas à ce jeu de matériaux. */
  textures: SurfaceTextures
  all: Set<Material>
}

/**
 * Une couleur LINÉAIRE du ciel, telle quelle. `new Color(hex)` convertirait depuis le sRGB ; ici les
 * valeurs sont déjà celles de la lumière, il ne faut surtout pas les recourber une seconde fois.
 */
const linear = (rgb: readonly [number, number, number], k = 1) =>
  new Color().setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k, LinearSRGBColorSpace)

/** Ce qu'on voit sous la ligne d'horizon : entre le sol du ciel et l'horizon lui-même. */
export const groundColor = (sky: SkyLook) => linear(sky.ground).lerp(linear(sky.horizon), 0.35)
/** Ce qu'on voit au-dessus : le fond du canvas, qui se raccorde au disque sans couture. */
export const backdropColor = (sky: SkyLook) => linear(sky.horizon).lerp(linear(sky.zenith), 0.35)

/** Pose une matière et ses réglages PBR sur un matériau existant. */
const WHITE = new Color(0xffffff)
const BLACK = new Color(0x000000)

function surface(m: MeshStandardMaterial, color: Color, look: SurfaceLook, tex: SurfaceTexture | undefined): void {
  // une matière photo porte sa couleur : la palette du style ne la teinte pas
  m.color.copy(tex?.colored ? WHITE : color)
  // Recompiler un shader coûte ; on ne le demande que si les CARTES changent (donc à un changement
  // de style), pas à chaque heure qui passe.
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

const std = (extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}) =>
  new MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...extra })

/** Les deux rôles d'une menuiserie : le dormant d'une baie, et le vantail d'une porte. */
export type JoineryRole = 'frame' | 'door'
interface Pbr { roughness: number; metalness: number }
/** Le réglage PBR de chaque rôle, déclaré ICI pour que les variantes teintées partent du même. */
const ROLE_PBR: Record<JoineryRole, Pbr> = {
  frame: { roughness: 0.45, metalness: 0.1 },
  door: { roughness: 0.5, metalness: 0 },
}
/**
 * Ce que chaque matière fait à la lumière. Le VERRE n'a pas de ligne : il ne change pas la
 * menuiserie, il vitre l'ouverture (`details.ts`) — le dormant d'une baie est déjà celui d'une
 * fenêtre. Le métal est lisse et réfléchit ; le bois est mat et ne réfléchit rien.
 */
const MATERIAL_PBR: Partial<Record<OpeningMaterial, Pbr>> = {
  wood: { roughness: 0.6, metalness: 0 },
  metal: { roughness: 0.3, metalness: 0.85 },
}

export function createMaterials(theme: SceneTheme, look: StyleLook, textures: SurfaceTextures = {}): MaterialSet {
  const set: Omit<MaterialSet, 'all'> = {
    wall: std(), wallInterior: std(), floor: std(),
    floors: { wood: std(), tile: std(), carpet: std(), concrete: std() },
    glass: new MeshPhysicalMaterial({ transparent: true, side: DoubleSide, depthWrite: false }),
    roof: std({ side: DoubleSide }),
    roofFlat: std(),
    terrain: std(),
    ground: new MeshBasicMaterial(),
    // l'eau est TRANSLUCIDE : c'est le fond carrelé qui lui donne sa couleur et sa profondeur
    zones: { lawn: std(), pool: std({ transparent: true, opacity: 0.72 }), driveway: std(), path: std(), bed: std(), terrace: std(), other: std() },
    textures,
    ghost: std({ transparent: true, opacity: 0.12, depthWrite: false }),
    slat: std({ roughness: 0.5, metalness: 0.2 }),
    // Peinture de carrosserie : lisse et assez métallique pour RÉFLÉCHIR. Ces valeurs n'ont de sens
    // qu'avec `scene.environment` — sans carte d'environnement, la part métallique n'a rien à
    // renvoyer et la voiture s'assombrit au lieu de briller.
    vehicle: std({ roughness: 0.28, metalness: 0.55 }),
    device: std({ roughness: 0.6, metalness: 0.1 }),
    trim: std({ roughness: 0.55 }),
    frame: std(ROLE_PBR.frame),
    plinth: std({ roughness: 0.95 }),
    door: std(ROLE_PBR.door),
    poolBasin: std({ roughness: 0.35, side: BackSide }),
    joinery: new Map(),
    applied: null,
  }
  const all = new Set<Material>()
  for (const [k, v] of Object.entries(set)) {
    if (k === 'textures' || k === 'joinery' || k === 'applied') continue
    if (v instanceof Material) all.add(v)
    else for (const m of Object.values(v as Record<string, Material>)) all.add(m)
  }
  const mats = { ...set, all }
  applyLook(mats, theme, look)
  return mats
}

/** Cuit les matières qui manquent au style demandé, garde celles déjà là. */
function ensureTextures(textures: SurfaceTextures, roles: readonly SurfaceRole[]): void {
  const missing = roles.filter((r) => !textures[r])
  if (missing.length) Object.assign(textures, createSurfaceTextures(missing))
}

/**
 * Applique un style et une heure aux matériaux existants (aucune géométrie touchée). C'est l'unique
 * chemin : création comprise, qui n'est qu'une première application.
 */
/** Ce que la météo fait aux surfaces DEHORS (`core/ambience.ts` : `wetness`, `snow`). */
export interface SurfaceWeather { wetness: number; snow: number }
export const DRY: SurfaceWeather = { wetness: 0, snow: 0 }

/** Blanc de neige, en sRGB : pas un blanc pur, qui brûlerait au soleil. */
const SNOW = new Color(0xe9edf2)

/**
 * Mouille ou enneige une surface déjà habillée par `surface()`. La pluie la fonce et la lisse (le
 * reflet du ciel dans une flaque, c'est une rugosité qui tombe) ; la neige la blanchit et la
 * matifie. Une matière photo porte sa couleur en carte : la blanchir par sa couleur ne peut rien
 * (elle est déjà à blanc), c'est l'émissif qui pose la neige dessus.
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
  ensureTextures(mats.textures, [...rolesOf(s), 'tile', roofFlat.texture])   // le bassin est carrelé quel que soit le style
  // une matière en images (`textures/assets.ts`) passe devant la procédurale du même rôle
  const tex = (l: SurfaceLook) => photos?.[l.texture] ?? mats.textures[l.texture]
  // dehors, la météo passe après la matière ; dedans et sur l'eau, elle ne passe pas
  const outdoor = (m: MeshStandardMaterial, color: Color, l: SurfaceLook) => { surface(m, color, l, tex(l)); weathered(m, l, tex(l), weather) }

  surface(mats.wall, theme.wall, s.wall, tex(s.wall))
  surface(mats.wallInterior, theme.wallInterior, s.wallInterior, tex(s.wallInterior))
  surface(mats.floor, theme.floor, s.floor, tex(s.floor))
  for (const k of Object.keys(mats.floors) as FloorStyle[]) surface(mats.floors[k], theme.floors[k], s.floors[k], tex(s.floors[k]))
  outdoor(mats.roof, theme.roof, s.roof)
  outdoor(mats.roofFlat, theme.roof, roofFlat)
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
  // le détail architectural se déduit de la palette : une lisse plus claire que le mur, des
  // menuiseries et un soubassement plus sombres, un vantail de la couleur du parquet — un style
  // monochrome le reste. Première lisse à 0,55 vers le blanc : elle brûlait en plein soleil.
  mats.trim.color.copy(theme.wall).lerp(WHITE, 0.4)
  mats.frame.color.copy(roleColor(theme, 'frame'))
  mats.plinth.color.copy(theme.wall).lerp(BLACK, 0.4)
  mats.door.color.copy(roleColor(theme, 'door'))
  // les menuiseries teintées suivent : elles se recalculent ENTIÈREMENT depuis leur clé, donc un
  // changement de style ou d'heure les rattrape même si elles sont nées entre deux applications
  mats.applied = { theme, look }
  for (const [key, m] of mats.joinery) applyJoinery(m, key, theme)
  // le bassin : la couleur de l'eau du style, très éclaircie — l'eau translucide par-dessus la rend
  const basin: SurfaceLook = { texture: 'tile', roughness: 0.35 }
  surface(mats.poolBasin, theme.zones.pool.clone().lerp(WHITE, 0.55), basin, tex(basin))
}

/** La couleur d'un rôle de menuiserie quand le relevé n'en impose pas : déduite de la palette. */
function roleColor(theme: SceneTheme, role: JoineryRole): Color {
  return role === 'frame' ? theme.wall.clone().lerp(BLACK, 0.55) : theme.floors.wood.clone()
}

/** `rôle|matière|couleur` — la clé PORTE tout ce qu'il faut pour recalculer le matériau. */
const joineryKey = (role: JoineryRole, material?: OpeningMaterial, color?: string) =>
  `${role}|${material ?? ''}|${color ?? ''}`

function applyJoinery(m: MeshStandardMaterial, key: string, theme: SceneTheme): void {
  const [role, material, color] = key.split('|') as [JoineryRole, OpeningMaterial | '', string]
  const pbr = (material ? MATERIAL_PBR[material] : undefined) ?? ROLE_PBR[role]
  m.roughness = pbr.roughness
  m.metalness = pbr.metalness
  // la couleur du fichier passe devant la matière, qui passe devant le rôle : le bois d'une
  // menuiserie est celui du parquet du style, sauf si le relevé a dit lequel
  if (color) m.color.set(color)
  else if (material === 'wood') m.color.copy(theme.floors.wood)
  else if (material === 'metal') m.color.copy(theme.wall).lerp(BLACK, 0.65)
  else m.color.copy(roleColor(theme, role))
}

/**
 * Le matériau d'une menuiserie d'ouverture. Sans matière NI couleur voulue, c'est le matériau
 * partagé du rôle qu'on rend tel quel : une maison ordinaire garde ses deux appels de dessin, et
 * seules les ouvertures qui demandent autre chose en coûtent un de plus.
 *
 * La variante naît teinte comprise : la géométrie se rebâtit à chaque changement de maison, donc
 * bien après la dernière application de style, et un matériau créé noir se serait vu.
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

/** Les matières ne sont PAS libérées : elles appartiennent au catalogue partagé (`textures/procedural.ts`). */
export function disposeMaterials(mats: MaterialSet): void {
  for (const m of mats.all) m.dispose()
  mats.joinery.clear()
}
