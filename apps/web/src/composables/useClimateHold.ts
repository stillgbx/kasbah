import type { DeviceId, DeviceState } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'
import { useHouseStore } from '../stores/house'

/**
 * The linked thermostat (`house.climateLinks`) that holds this one back, or null.
 *
 * Two thermostats in series on the same heating: a heat pump zone under its setpoint on its own
 * sensor asks for heat, but a Nest in front of it, satisfied, keeps the machine stopped. Its card
 * said "idle" with no reason, or worse "heating" (2026-11-04). Kasbah does not know the wiring: the
 * link the user declared is what says they are in series. Brand-blind: a member that is idle in
 * heat, colder than its setpoint, while another member of its group is idle in heat.
 */
export function heldBy(id: DeviceId, links: readonly (readonly DeviceId[])[] | undefined, stateOf: (id: DeviceId) => DeviceState | undefined): DeviceId | null {
  const idleInHeat = (s: DeviceState | undefined) => s?.kind === 'climate' && s.available && s.mode === 'heat' && s.action === 'idle'
  const s = stateOf(id)
  if (!idleInHeat(s) || s?.kind !== 'climate' || s.currentTempC >= s.targetTempC) return null
  return links?.find((g) => g.includes(id))?.find((other) => other !== id && idleInHeat(stateOf(other))) ?? null
}

/**
 * `heldBy` read in the stores: the NAME of the thermostat holding a device back, or null; and
 * whether the device is linked at all, for a screen that reserves the reason's place.
 */
export function useClimateHold() {
  const house = useHouseStore()
  const devices = useDevicesStore()
  return {
    heldByName(id: DeviceId): string | null {
      const holder = heldBy(id, house.house?.climateLinks, (x) => devices.states[x])
      return holder ? house.houseDeviceFor(holder)?.name ?? devices.descriptors[holder]?.name ?? holder : null
    },
    linked: (id: DeviceId): boolean => house.house?.climateLinks?.some((g) => g.includes(id)) ?? false,
  }
}
