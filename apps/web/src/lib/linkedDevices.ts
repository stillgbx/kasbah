import type { DeviceEntry, DeviceId } from '@kasbah/shared'

/** Fan that declares `meta.linkedTo` toward this light (accessory → main link). */
export function fanLinkedTo(lightId: DeviceId | string, list: readonly DeviceEntry[]): DeviceEntry | undefined {
  return list.find((e) => e.descriptor.kind === 'fan' && e.descriptor.meta.linkedTo === lightId)
}

/** Light (or linked fan): the two functions of the same physical device. */
export function isLightWithFan(descriptorId: DeviceId | string, list: readonly DeviceEntry[]): boolean {
  return fanLinkedTo(descriptorId, list) !== undefined
}
