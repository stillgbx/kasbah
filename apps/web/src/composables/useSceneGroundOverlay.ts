import { computed, watch, type Ref } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { offsetLocation, type LatLon } from '../lib/map'
import { sceneGroundShapes, siteMapAnchor, siteMapFeatures } from '../lib/siteMap'
import type { GroundShape } from '../three/builders/groundOverlay'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useSceneZonesStore } from '../stores/sceneZones'

// The mowers' terrain map PAINTED in the scene, for those where it was requested (mower
// panel, `stores/sceneZones`). It is placed by its station on the robot's base (WITHOUT `mapOffset`,
// see below), failing that on the robot when it is at the station — last anchor kept,
// a robot gone mowing does not make its map disappear. The scene only repaints if the shapes
// changed: the position of a mowing robot triggers recomputing, not repainting.

type MowerEntry = DeviceEntry & { state: StateFor<'mower'> }

export function useSceneGroundOverlay(scene: { ready: Ref<boolean>; setGroundOverlay: (shapes: readonly GroundShape[]) => void }): void {
  const devices = useDevicesStore()
  const house = useHouseStore()
  const zones = useSceneZonesStore()
  const lastAnchors = new Map<string, LatLon>()

  const shownMowers = computed(() => devices.list.filter((e): e is MowerEntry =>
    e.state.kind === 'mower' && e.descriptor.capabilities.includes('site_map') && zones.isShown(e.descriptor.id)))

  // the map of each shown robot, re-requested when its zones change (drawn, removed, renamed)
  const mapKeys = computed(() => shownMowers.value.map((m) =>
    `${m.descriptor.id}|${(m.state.workAreas ?? []).map((a) => `${a.id}:${a.name}`).join(',')}|${(m.state.stayOutZones ?? []).map((z) => `${z.id}:${z.name}`).join(',')}`))
  watch(mapKeys, (keys, old) => {
    for (const key of keys) if (!old?.includes(key)) void zones.load(key.slice(0, key.indexOf('|')))
  }, { immediate: true })

  const shapes = computed<GroundShape[]>(() => {
    const origin = house.house?.origin
    if (!origin) return []
    return shownMowers.value.flatMap((m) => {
      const id = m.descriptor.id
      const map = zones.maps[id]
      if (!map) return []
      const hd = house.houseDeviceFor(id)
      const loc = m.state.location
      const location = loc && hd?.gpsOffset ? offsetLocation(origin, loc, hd.gpsOffset) : loc
      // NO `mapOffset` here: it realigns the map on the satellite PHOTO, that is, it compensates
      // the error of the house's alignment on the world (`origin`). In the scene, everything is in the
      // house's frame and the robot's base is right there: applying it shifted the map by as much
      // (observed on the real house: the station several meters from the base).
      const anchor = siteMapAnchor({
        origin, dock: house.dockFor(id)?.center, location,
        atStation: m.state.activity === 'parked' || m.state.activity === 'charging',
      }) ?? lastAnchors.get(id)
      if (!anchor) return []
      lastAnchors.set(id, anchor)
      return sceneGroundShapes(siteMapFeatures(map, anchor, m.state.stayOutZones, m.state.workAreas), origin, zones.hiddenFor(id))
    })
  })

  // not `immediate` alone: the scene is built at mount — `ready` replays the state when it is there
  let painted = ''
  watch([shapes, scene.ready], ([s, ready]) => {
    if (!ready) return
    const key = JSON.stringify(s)
    if (key === painted) return
    painted = key
    scene.setGroundOverlay(s)
  }, { immediate: true })
}
