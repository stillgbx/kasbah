import type { Site } from '../schema'
import type { TerrainDescriptor, ZoneDescriptor } from './types'

export function computeTerrain(site: Site): TerrainDescriptor {
  return { polygon: [...site.terrain], z: site.elevation }
}

export function computeZones(site: Site): ZoneDescriptor[] {
  return site.zones.map((z) => ({ zoneId: z.id, kind: z.kind, polygon: [...z.polygon], z: site.elevation }))
}
