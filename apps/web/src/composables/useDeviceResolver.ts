import { computed, type Ref } from 'vue'
import type { DeviceDescriptor, DeviceState, HouseDevice } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

export interface ResolvedDevice {
  key: string
  houseDevice: HouseDevice | undefined
  deviceId: string | undefined
  descriptor: DeviceDescriptor | undefined
  state: DeviceState | undefined
  name: string
}

/**
 * A selection "key" is either the id of a house device (linked to a plugin or not),
 * or directly the id of an unplaced plugin device. We resolve to descriptor + state.
 */
export function resolveDevice(key: string): ResolvedDevice {
  const house = useHouseStore()
  const devices = useDevicesStore()
  const houseDevice = house.index?.devicesById.get(key)
  const deviceId = houseDevice ? houseDevice.deviceId : (devices.descriptors[key] ? key : undefined)
  const descriptor = deviceId ? devices.descriptors[deviceId] : undefined
  const state = deviceId ? devices.states[deviceId] : undefined
  return { key, houseDevice, deviceId, descriptor, state, name: houseDevice?.name ?? descriptor?.name ?? key }
}

export function useDeviceResolver(key: Ref<string | null>) {
  return computed<ResolvedDevice | null>(() => (key.value ? resolveDevice(key.value) : null))
}
