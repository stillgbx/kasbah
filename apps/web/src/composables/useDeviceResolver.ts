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
 * Une « clé » de sélection est soit l'id d'un appareil de la maison (lié ou non à un plugin),
 * soit directement l'id d'un appareil de plugin non placé. On résout vers descripteur + état.
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
