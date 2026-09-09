import type { DeviceDescriptor, HouseDevice } from '@kasbah/shared'

// Appareils qui REGARDENT quelque part : leur `yaw` (0 = face à +y) a un sens, on le règle depuis le
// panneau (ligne « Orientation ») et on le montre dans la scène (cône « regarde vers » en mode
// « Déplacer »). Une enceinte ou une lampe n'ont pas d'orientation utile.

export function isOrientable(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  if (!descriptor) return device.yaw !== undefined
  if (descriptor.kind === 'media_player') {
    const cls = descriptor.meta.mediaPlayer?.deviceClass
    return cls === 'tv' || cls === 'display'
  }
  return descriptor.kind === 'camera' || descriptor.kind === 'vehicle'
}

/** Cap en radians pour Three (rotation autour de Z), depuis les degrés du JSON. */
export function yawToRad(yaw: number | undefined): number {
  return ((yaw ?? 0) * Math.PI) / 180
}
