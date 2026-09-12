import { computed } from 'vue'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'

// Lampes d'une pièce, telles que les voient ses deux contrôles d'ensemble : l'interrupteur maître
// (`RoomLightsToggle`) et le curseur de luminosité (`RoomBrightness`). Ils partagent la même lecture
// pour ne jamais se contredire — l'un allumé, l'autre qui prétend qu'il n'y a rien à régler.
//
// L'INVENTAIRE décide de la présence des contrôles, pas la joignabilité : un pont qui ne répond plus
// ne doit pas faire apparaître et disparaître un interrupteur sous le doigt (règle « rien ne bouge »).

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
