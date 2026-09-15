import { Color, DoubleSide, Material, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import type { FloorStyle, ZoneKind } from '@kasbah/shared'
import type { SceneTheme } from '../core/theme'
import { createSurfaceTextures, disposeSurfaceTextures, type SurfaceRole, type SurfaceTexture, type SurfaceTextures } from '../textures/procedural'

// Matériaux PARTAGÉS par rôle : un changement de thème mute ~15 matériaux, pas N maillages.
// Les sols reçoivent un clone par pièce (surbrillance individuelle) rattaché à son rôle.
// Chaque surface porte une matière par défaut (`textures/procedural.ts`) que sa couleur de thème
// teinte : la texture dit le grain, le thème dit la couleur.

export interface MaterialSet {
  wall: MeshStandardMaterial
  wallInterior: MeshStandardMaterial
  floor: MeshStandardMaterial
  floors: Record<FloorStyle, MeshStandardMaterial>
  glass: MeshPhysicalMaterial
  roof: MeshStandardMaterial
  terrain: MeshStandardMaterial
  /** Sol infini sous la parcelle : NON éclairé, exactement la couleur du fond de l'app. */
  ground: MeshBasicMaterial
  zones: Record<ZoneKind, MeshStandardMaterial>
  ghost: MeshStandardMaterial
  slat: MeshStandardMaterial
  vehicle: MeshStandardMaterial
  /** Petits objets connectés neutres. */
  device: MeshStandardMaterial
  /** Les matières partagées par les matériaux ci-dessus (libérées avec eux). */
  textures: SurfaceTextures
  all: Set<Material>
}

const std = (color: Color, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}) =>
  new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra })

/** Un matériau standard habillé d'une matière : couleur × carte, relief tiré de la même carte. */
const surfaced = (color: Color, t: SurfaceTexture, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}) =>
  std(color, { map: t.map, bumpMap: t.bumpMap, bumpScale: t.bumpScale, ...extra })

/** Quelle matière pour quelle surface : la seule table à changer pour en remplacer une. */
export const SURFACE_OF = {
  wall: 'plaster', wallInterior: 'plaster', floor: 'concrete', roof: 'roof', terrain: 'grass',
  floors: { wood: 'wood', tile: 'tile', carpet: 'carpet', concrete: 'concrete' },
  zones: { lawn: 'grass', pool: 'water', driveway: 'concrete', path: 'pavers', bed: 'soil', terrace: 'pavers', other: 'concrete' },
} as const satisfies { wall: SurfaceRole; wallInterior: SurfaceRole; floor: SurfaceRole; roof: SurfaceRole; terrain: SurfaceRole; floors: Record<FloorStyle, SurfaceRole>; zones: Record<ZoneKind, SurfaceRole> }

export function createMaterials(theme: SceneTheme, textures: SurfaceTextures = createSurfaceTextures()): MaterialSet {
  const tex = (role: SurfaceRole) => textures[role]
  const set: Omit<MaterialSet, 'all'> = {
    wall: surfaced(theme.wall, tex(SURFACE_OF.wall)),
    wallInterior: surfaced(theme.wallInterior, tex(SURFACE_OF.wallInterior)),
    floor: surfaced(theme.floor, tex(SURFACE_OF.floor)),
    floors: {
      wood: surfaced(theme.floors.wood, tex(SURFACE_OF.floors.wood), { roughness: 0.6 }),
      tile: surfaced(theme.floors.tile, tex(SURFACE_OF.floors.tile), { roughness: 0.35 }),
      carpet: surfaced(theme.floors.carpet, tex(SURFACE_OF.floors.carpet)),
      concrete: surfaced(theme.floors.concrete, tex(SURFACE_OF.floors.concrete)),
    },
    glass: new MeshPhysicalMaterial({ color: theme.glass, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0, side: DoubleSide, depthWrite: false }),
    roof: surfaced(theme.roof, tex(SURFACE_OF.roof), { side: DoubleSide, roughness: 0.85 }),
    terrain: surfaced(theme.terrain, tex(SURFACE_OF.terrain), { roughness: 1 }),
    ground: new MeshBasicMaterial({ color: theme.background }),
    zones: {
      lawn: surfaced(theme.zones.lawn, tex(SURFACE_OF.zones.lawn), { roughness: 1 }),
      // l'eau : lisse, un peu de métal pour que le ciel s'y pose
      pool: surfaced(theme.zones.pool, tex(SURFACE_OF.zones.pool), { roughness: 0.15, metalness: 0.15 }),
      driveway: surfaced(theme.zones.driveway, tex(SURFACE_OF.zones.driveway)),
      path: surfaced(theme.zones.path, tex(SURFACE_OF.zones.path), { roughness: 0.7 }),
      bed: surfaced(theme.zones.bed, tex(SURFACE_OF.zones.bed)),
      terrace: surfaced(theme.zones.terrace, tex(SURFACE_OF.zones.terrace), { roughness: 0.65 }),
      other: surfaced(theme.zones.other, tex(SURFACE_OF.zones.other)),
    },
    textures,
    ghost: std(theme.wall, { transparent: true, opacity: 0.12, depthWrite: false }),
    slat: std(theme.isDark ? new Color('#8a8f94') : new Color('#c9ced2'), { roughness: 0.5, metalness: 0.2 }),
    // Peinture de carrosserie : lisse et assez métallique pour RÉFLÉCHIR. Ces valeurs n'ont de sens
    // qu'avec la carte d'environnement que `HouseScene` vient y poser — sans elle, la part
    // métallique n'a rien à renvoyer et la voiture s'assombrit au lieu de briller.
    vehicle: std(theme.secondary, { roughness: 0.28, metalness: 0.55 }),
    device: std(theme.isDark ? new Color('#9aa4b2') : new Color('#5b6470'), { roughness: 0.6, metalness: 0.1 }),
  }
  const all = new Set<Material>()
  for (const [k, v] of Object.entries(set)) {
    if (k === 'textures') continue
    if (v instanceof Material) all.add(v)
    else for (const m of Object.values(v as Record<string, Material>)) all.add(m)
  }
  return { ...set, all }
}

/** Applique un nouveau thème aux matériaux existants (aucune géométrie touchée). */
export function applyTheme(mats: MaterialSet, theme: SceneTheme): void {
  mats.wall.color.copy(theme.wall)
  mats.wallInterior.color.copy(theme.wallInterior)
  mats.floor.color.copy(theme.floor)
  for (const k of Object.keys(mats.floors) as FloorStyle[]) mats.floors[k].color.copy(theme.floors[k])
  mats.glass.color.copy(theme.glass)
  mats.roof.color.copy(theme.roof)
  mats.terrain.color.copy(theme.terrain)
  mats.ground.color.copy(theme.background)
  for (const k of Object.keys(mats.zones) as ZoneKind[]) mats.zones[k].color.copy(theme.zones[k])
  mats.ghost.color.copy(theme.wall)
  mats.slat.color.set(theme.isDark ? '#8a8f94' : '#c9ced2')
  mats.vehicle.color.copy(theme.secondary)
  mats.device.color.set(theme.isDark ? '#9aa4b2' : '#5b6470')
}

export function disposeMaterials(mats: MaterialSet): void {
  for (const m of mats.all) m.dispose()
  disposeSurfaceTextures(mats.textures)
}
