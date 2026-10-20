import {
  assignParkings, atRest, autoPlaceDevices, indexHouse, resolveDeviceLevelId, sitePosition,
  type DeviceEntry, type House, type HouseIndex, type ParkingCandidate,
} from '@kasbah/shared'
import type { LoadedHouse } from '../../config/house'
import type { DeviceRegistry } from '../registry'

// What a predicate needs to know about the world, taken at one instant: the devices, the EFFECTIVE
// house (the one from the file, plus the devices that auto-placement attaches to a room based on
// what their vendor declares — the same one the interface sees, `apps/web/src/stores/house.ts`),
// and who is parked where.

export interface EvalContext {
  now: number
  house: House
  index: HouseIndex
  /** The device, if it is in the registry. */
  device(id: string): DeviceEntry | undefined
  /** Has it published a state since it appeared? Otherwise its values are the defaults: unknown. */
  fresh(id: string): boolean
  entries(): DeviceEntry[]
  roomOf(id: string): string | undefined
  levelOf(id: string): string | undefined
  zoneOf(id: string): string | undefined
  /** Parking spot where the machine is stored, if it is. */
  parkingOf(id: string): string | undefined
}

/**
 * Index of the effective house, recomputed only when the house changes (`updateHouseFile`
 * REASSIGNS `loaded.house`: a reference comparison is enough) or when the device list changes
 * (`invalidate`, wired to the bus `devices` event).
 */
export class HouseView {
  private cache: { house: House; version: number; effective: House; index: HouseIndex } | null = null
  private version = 0

  constructor(private readonly loaded: LoadedHouse, private readonly registry: DeviceRegistry) {}

  invalidate(): void { this.version++ }

  private indexed(): { effective: House; index: HouseIndex } {
    const house = this.loaded.house
    if (this.cache?.house === house && this.cache.version === this.version) return this.cache
    const base = indexHouse(house)
    const placeable = this.registry.list().map((e) => ({ id: e.descriptor.id, kind: e.descriptor.kind, room: e.descriptor.meta.room }))
    const { placed } = autoPlaceDevices(house, placeable, base)
    const effective = placed.length ? { ...house, devices: [...house.devices, ...placed] } : house
    const index = placed.length ? indexHouse(effective) : base
    this.cache = { house, version: this.version, effective, index }
    return this.cache
  }

  context(now: number, fresh: (id: string) => boolean): EvalContext {
    const { effective, index } = this.indexed()
    const registry = this.registry
    const bound = (id: string) => index.devicesByBinding.get(id)
    let parkings: Map<string, string> | null = null
    return {
      now, house: effective, index, fresh,
      device: (id) => registry.get(id),
      entries: () => registry.list(),
      roomOf: (id) => bound(id)?.roomId,
      levelOf: (id) => { const d = bound(id); return d ? resolveDeviceLevelId(d, index.roomsById) ?? undefined : undefined },
      zoneOf: (id) => bound(id)?.zoneId,
      parkingOf: (id) => (parkings ??= parkingFixes(effective, index, registry.list())).get(id),
    }
  }
}

/**
 * Who is parked where, for all located machines at once — the 3D scene's rule
 * (`HouseScene.computeParkingFixes`): a device whose position the house writes is not a candidate,
 * its spot is authoritative.
 */
function parkingFixes(house: House, index: HouseIndex, entries: DeviceEntry[]): Map<string, string> {
  const out = new Map<string, string>()
  if (!house.site.parkings.length) return out
  const candidates: ParkingCandidate[] = []
  for (const { descriptor, state } of entries) {
    if (state.kind !== 'vehicle' && state.kind !== 'mower') continue
    if (!state.location) continue
    const hd = index.devicesByBinding.get(descriptor.id)
    if (hd?.position) continue
    const xyz = sitePosition(house, state.location, hd?.gpsOffset)
    if (!xyz) continue
    candidates.push({ key: descriptor.id, kind: descriptor.kind, deviceId: descriptor.id, point: [xyz[0], xyz[1]], atRest: atRest(state) })
  }
  for (const [key, fix] of assignParkings(house.site.parkings, candidates)) out.set(key, fix.parkingId)
  return out
}
