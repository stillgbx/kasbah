import {
  assignParkings, atRest, autoPlaceDevices, indexHouse, resolveDeviceLevelId, sitePosition,
  type DeviceEntry, type House, type HouseIndex, type ParkingCandidate,
} from '@kasbah/shared'
import type { LoadedHouse } from '../../config/house'
import type { DeviceRegistry } from '../registry'

// Ce qu'un prédicat a besoin de savoir du monde, pris à un instant : les appareils, la maison
// EFFECTIVE (celle du fichier, plus les appareils que l'auto-placement rattache à une pièce d'après
// ce que déclare leur fabricant — la même que voit l'interface, `apps/web/src/stores/house.ts`),
// et qui est garé où.

export interface EvalContext {
  now: number
  house: House
  index: HouseIndex
  /** L'appareil, s'il est dans le registre. */
  device(id: string): DeviceEntry | undefined
  /** A-t-il publié un état depuis qu'il est apparu ? Sinon ses valeurs sont celles par défaut : inconnues. */
  fresh(id: string): boolean
  entries(): DeviceEntry[]
  roomOf(id: string): string | undefined
  levelOf(id: string): string | undefined
  zoneOf(id: string): string | undefined
  /** Place où l'engin est rangé, s'il l'est. */
  parkingOf(id: string): string | undefined
}

/**
 * Index de la maison effective, recalculé seulement quand la maison change (`updateHouseFile`
 * RÉASSIGNE `loaded.house` : une comparaison de référence suffit) ou quand la liste des appareils
 * change (`invalidate`, branché sur l'événement `devices` du bus).
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
 * Qui est rangé où, pour tous les engins localisés d'un coup — la règle de la scène 3D
 * (`HouseScene.computeParkingFixes`) : un appareil dont la maison écrit la position n'est pas
 * candidat, sa place fait foi.
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
