import { Color, DoubleSide, Material, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import type { FloorStyle, ZoneKind } from '@kasbah/shared'
import type { SceneTheme } from '../core/theme'

// Matériaux PARTAGÉS par rôle : un changement de thème mute ~15 matériaux, pas N maillages.
// Les sols reçoivent un clone par pièce (surbrillance individuelle) rattaché à son rôle.

export interface MaterialSet {
  wall: MeshStandardMaterial
  wallInterior: MeshStandardMaterial
  floor: MeshStandardMaterial
  floors: Record<FloorStyle, MeshStandardMaterial>
  glass: MeshPhysicalMaterial
  roof: MeshStandardMaterial
  terrain: MeshStandardMaterial
  zones: Record<ZoneKind, MeshStandardMaterial>
  ghost: MeshStandardMaterial
  slat: MeshStandardMaterial
  vehicle: MeshStandardMaterial
  /** Petits objets connectés neutres. */
  device: MeshStandardMaterial
  all: Set<Material>
}

const std = (color: Color, extra: ConstructorParameters<typeof MeshStandardMaterial>[0] = {}) =>
  new MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra })

export function createMaterials(theme: SceneTheme): MaterialSet {
  const set: Omit<MaterialSet, 'all'> = {
    wall: std(theme.wall),
    wallInterior: std(theme.wallInterior),
    floor: std(theme.floor),
    floors: {
      wood: std(theme.floors.wood, { roughness: 0.7 }),
      tile: std(theme.floors.tile, { roughness: 0.4 }),
      carpet: std(theme.floors.carpet),
      concrete: std(theme.floors.concrete),
    },
    glass: new MeshPhysicalMaterial({ color: theme.glass, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0, side: DoubleSide, depthWrite: false }),
    roof: std(theme.roof, { side: DoubleSide, roughness: 0.8 }),
    terrain: std(theme.terrain, { roughness: 1 }),
    zones: {
      lawn: std(theme.zones.lawn, { roughness: 1 }),
      pool: std(theme.zones.pool, { roughness: 0.2, metalness: 0.1 }),
      driveway: std(theme.zones.driveway),
      path: std(theme.zones.path),
      bed: std(theme.zones.bed),
      terrace: std(theme.zones.terrace, { roughness: 0.6 }),
      other: std(theme.zones.other),
    },
    ghost: std(theme.wall, { transparent: true, opacity: 0.12, depthWrite: false }),
    slat: std(theme.isDark ? new Color('#8a8f94') : new Color('#c9ced2'), { roughness: 0.5, metalness: 0.2 }),
    vehicle: std(theme.secondary, { roughness: 0.4, metalness: 0.3 }),
    device: std(theme.isDark ? new Color('#9aa4b2') : new Color('#5b6470'), { roughness: 0.6, metalness: 0.1 }),
  }
  const all = new Set<Material>()
  for (const v of Object.values(set)) {
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
  for (const k of Object.keys(mats.zones) as ZoneKind[]) mats.zones[k].color.copy(theme.zones[k])
  mats.ghost.color.copy(theme.wall)
  mats.slat.color.set(theme.isDark ? '#8a8f94' : '#c9ced2')
  mats.vehicle.color.copy(theme.secondary)
  mats.device.color.set(theme.isDark ? '#9aa4b2' : '#5b6470')
}

export function disposeMaterials(mats: MaterialSet): void {
  for (const m of mats.all) m.dispose()
}
