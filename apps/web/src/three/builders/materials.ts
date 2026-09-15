import { Color, DoubleSide, LinearSRGBColorSpace, Material, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import type { FloorStyle, ZoneKind } from '@kasbah/shared'
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
  terrain: MeshStandardMaterial
  /** Sol infini sous la parcelle : NON éclairé, de la couleur du sol du ciel — il prolonge l'horizon. */
  ground: MeshBasicMaterial
  zones: Record<ZoneKind, MeshStandardMaterial>
  ghost: MeshStandardMaterial
  slat: MeshStandardMaterial
  vehicle: MeshStandardMaterial
  /** Petits objets connectés neutres. */
  device: MeshStandardMaterial
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

export function createMaterials(theme: SceneTheme, look: StyleLook, textures: SurfaceTextures = {}): MaterialSet {
  const set: Omit<MaterialSet, 'all'> = {
    wall: std(), wallInterior: std(), floor: std(),
    floors: { wood: std(), tile: std(), carpet: std(), concrete: std() },
    glass: new MeshPhysicalMaterial({ transparent: true, side: DoubleSide, depthWrite: false }),
    roof: std({ side: DoubleSide }),
    terrain: std(),
    ground: new MeshBasicMaterial(),
    zones: { lawn: std(), pool: std(), driveway: std(), path: std(), bed: std(), terrace: std(), other: std() },
    textures,
    ghost: std({ transparent: true, opacity: 0.12, depthWrite: false }),
    slat: std({ roughness: 0.5, metalness: 0.2 }),
    // Peinture de carrosserie : lisse et assez métallique pour RÉFLÉCHIR. Ces valeurs n'ont de sens
    // qu'avec `scene.environment` — sans carte d'environnement, la part métallique n'a rien à
    // renvoyer et la voiture s'assombrit au lieu de briller.
    vehicle: std({ roughness: 0.28, metalness: 0.55 }),
    device: std({ roughness: 0.6, metalness: 0.1 }),
  }
  const all = new Set<Material>()
  for (const [k, v] of Object.entries(set)) {
    if (k === 'textures') continue
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
export function applyLook(mats: MaterialSet, theme: SceneTheme, look: StyleLook, photos?: SurfaceTextures): void {
  const s = look.surfaces
  ensureTextures(mats.textures, rolesOf(s))
  // une matière en images (`textures/assets.ts`) passe devant la procédurale du même rôle
  const tex = (l: SurfaceLook) => photos?.[l.texture] ?? mats.textures[l.texture]

  surface(mats.wall, theme.wall, s.wall, tex(s.wall))
  surface(mats.wallInterior, theme.wallInterior, s.wallInterior, tex(s.wallInterior))
  surface(mats.floor, theme.floor, s.floor, tex(s.floor))
  for (const k of Object.keys(mats.floors) as FloorStyle[]) surface(mats.floors[k], theme.floors[k], s.floors[k], tex(s.floors[k]))
  surface(mats.roof, theme.roof, s.roof, tex(s.roof))
  surface(mats.terrain, theme.terrain, s.terrain, tex(s.terrain))
  for (const k of Object.keys(mats.zones) as ZoneKind[]) surface(mats.zones[k], theme.zones[k], s.zones[k], tex(s.zones[k]))

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
}

/** Les matières ne sont PAS libérées : elles appartiennent au catalogue partagé (`textures/procedural.ts`). */
export function disposeMaterials(mats: MaterialSet): void {
  for (const m of mats.all) m.dispose()
}
