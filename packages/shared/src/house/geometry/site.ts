import type { Site } from '../schema'
import { parseRelief, type Footprint } from './relief'
import type { TerrainDescriptor, ZoneDescriptor } from './types'
import type { Vec2 } from './vec2'

export function computeTerrain(site: Site, pads: Vec2[][] = [], footprints: Footprint[] = []): TerrainDescriptor {
  return { polygon: [...site.terrain], z: site.elevation, relief: parseRelief(site.relief), pads, footprints }
}

export function computeZones(site: Site): ZoneDescriptor[] {
  return site.zones.map((z) => ({ zoneId: z.id, kind: z.kind, polygon: [...z.polygon], z: site.elevation }))
}
