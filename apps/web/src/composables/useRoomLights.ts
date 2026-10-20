import { computed } from 'vue'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'

// Lights of a room, as seen by its two overall controls: the master switch
// (`RoomLightsToggle`) and the brightness slider (`RoomBrightness`). They share the same reading
// so as never to contradict each other — one on, the other claiming there is nothing to set.
//
// The INVENTORY decides whether the controls are present, not reachability: a bridge that no longer answers
// must not make a switch appear and disappear under the finger ("nothing moves" rule).

export interface RoomLight {
  id: string
  descriptor: DeviceDescriptor | undefined
  state: StateFor<'light'>
}

export function useRoomLights(deviceIds: () => (string | undefined)[]) {
  const devices = useDevicesStore()
  const lights = computed<RoomLight[]>(() => deviceIds()
    .map((id) => (id ? { id, descriptor: devices.descriptors[id], state: devices.states[id] } : null))
    .filter((l): l is RoomLight => l?.state?.kind === 'light'))
  const reachable = computed(() => lights.value.filter((l) => l.state.available))
  const on = computed(() => reachable.value.filter((l) => l.state.on))
  return { lights, reachable, on }
}
