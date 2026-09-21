import type { DeviceEntry, DeviceId } from '@kasbah/shared'

/** Ventilateur qui déclare `meta.linkedTo` vers cette lumière (lien accessoire → principal). */
export function fanLinkedTo(lightId: DeviceId | string, list: readonly DeviceEntry[]): DeviceEntry | undefined {
  return list.find((e) => e.descriptor.kind === 'fan' && e.descriptor.meta.linkedTo === lightId)
}

/** Lumière (ou ventilateur lié) : les deux fonctions du même appareil physique. */
export function isLightWithFan(descriptorId: DeviceId | string, list: readonly DeviceEntry[]): boolean {
  return fanLinkedTo(descriptorId, list) !== undefined
}
