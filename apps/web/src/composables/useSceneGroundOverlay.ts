import { computed, watch, type Ref } from 'vue'
import type { DeviceEntry, StateFor } from '@kasbah/shared'
import { offsetLocation, type LatLon } from '../lib/map'
import { sceneGroundShapes, siteMapAnchor, siteMapFeatures } from '../lib/siteMap'
import type { GroundShape } from '../three/builders/groundOverlay'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'
import { useSceneZonesStore } from '../stores/sceneZones'

// La carte du terrain des tondeuses PEINTE dans la scène, pour celles où on l'a demandé (panneau de la
// tondeuse, `stores/sceneZones`). Elle se pose par sa station sur la base du robot (SANS `mapOffset`,
// voir plus bas), à défaut sur le robot quand il est à la station — dernier ancrage gardé,
// un robot parti tondre ne fait pas disparaître sa carte. La scène ne repeint que si les formes ont
// changé : la position d'un robot qui tond fait recalculer, pas repeindre.

type MowerEntry = DeviceEntry & { state: StateFor<'mower'> }

export function useSceneGroundOverlay(scene: { ready: Ref<boolean>; setGroundOverlay: (shapes: readonly GroundShape[]) => void }): void {
  const devices = useDevicesStore()
  const house = useHouseStore()
  const zones = useSceneZonesStore()
  const lastAnchors = new Map<string, LatLon>()

  const shownMowers = computed(() => devices.list.filter((e): e is MowerEntry =>
    e.state.kind === 'mower' && e.descriptor.capabilities.includes('site_map') && zones.isShown(e.descriptor.id)))

  // la carte de chaque robot montré, redemandée quand ses zones changent (tracées, retirées, renommées)
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
      // PAS de `mapOffset` ici : il recale la carte sur la PHOTO satellite, c'est-à-dire qu'il compense
      // l'erreur de calage de la maison sur le monde (`origin`). Dans la scène, tout est dans le repère
      // de la maison et la base du robot y est juste : l'appliquer décalait la carte d'autant
      // (constaté sur la vraie maison : la station à plusieurs mètres de la base).
      const anchor = siteMapAnchor({
        origin, dock: house.dockFor(id)?.center, location,
        atStation: m.state.activity === 'parked' || m.state.activity === 'charging',
      }) ?? lastAnchors.get(id)
      if (!anchor) return []
      lastAnchors.set(id, anchor)
      return sceneGroundShapes(siteMapFeatures(map, anchor, m.state.stayOutZones, m.state.workAreas), origin, zones.hiddenFor(id))
    })
  })

  // pas `immediate` seul : la scène se construit au montage — `ready` rejoue l'état quand elle est là
  let painted = ''
  watch([shapes, scene.ready], ([s, ready]) => {
    if (!ready) return
    const key = JSON.stringify(s)
    if (key === painted) return
    painted = key
    scene.setGroundOverlay(s)
  }, { immediate: true })
}
