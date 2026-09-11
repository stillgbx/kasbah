import type { DeviceDescriptor, DeviceEntry } from '@kasbah/shared'

// Une installation publie PLUSIEURS appareils `energy` : le site, qui mesure production,
// consommation et réseau, et une batterie par unité de stockage. Prendre « le premier `energy`
// trouvé » donnait donc une batterie dès qu'il y en avait une, et la vue Énergie affichait 0 W de
// production avec une charge à 100 %. Ce qui distingue le site, c'est qu'il mesure le RÉSEAU.

/** Le site d'une installation : lui seul déclare `grid`. Une batterie n'a que `storage`. */
export function isEnergySite(descriptor: DeviceDescriptor): boolean {
  return descriptor.kind === 'energy' && descriptor.capabilities.includes('grid')
}

/**
 * Le site parmi les appareils connus. Repli sur le premier `energy` venu si aucun ne déclare le
 * réseau : une passerelle sans compteur vaut mieux que rien du tout.
 */
export function findEnergySite(list: readonly DeviceEntry[]): DeviceEntry | undefined {
  return list.find((e) => isEnergySite(e.descriptor)) ?? list.find((e) => e.descriptor.kind === 'energy')
}

/** Les unités de stockage : des `energy` qui ne mesurent pas le réseau. */
export function findBatteries(list: readonly DeviceEntry[]): DeviceEntry[] {
  return list.filter((e) => e.descriptor.kind === 'energy' && !isEnergySite(e.descriptor))
}
