import type { DeviceDescriptor, HouseDevice } from '@kasbah/shared'

// Appareils dont le `yaw` (0 = face à +y) a un sens : on le règle depuis le panneau (ligne
// « Orientation ») et on le montre dans la scène (cône « regarde vers » en mode « Déplacer »).
//
// Deux familles, pour deux raisons différentes. Ce qui REGARDE quelque part : un écran, une caméra,
// un véhicule. Et ce qui a une FACE, posé contre un mur : une borne de recharge, une batterie, le
// boîtier d'une passerelle — leur dos touche le mur, et un coffret tourné à l'envers se voit. Une
// enceinte ou une lampe n'ont d'orientation utile ni dans un sens ni dans l'autre.

export function isOrientable(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  if (!descriptor) return device.yaw !== undefined
  if (descriptor.kind === 'media_player') {
    const cls = descriptor.meta.mediaPlayer?.deviceClass
    return cls === 'tv' || cls === 'display'
  }
  return descriptor.kind === 'camera' || descriptor.kind === 'vehicle'
    || descriptor.kind === 'ev_charger' || descriptor.kind === 'energy'
}

/** Cap en radians pour Three (rotation autour de Z), depuis les degrés du JSON. */
export function yawToRad(yaw: number | undefined): number {
  return ((yaw ?? 0) * Math.PI) / 180
}
