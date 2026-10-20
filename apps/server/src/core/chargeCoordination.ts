import { HOME_RADIUS_M, geoDistance, type CHARGER_STATUSES, type Command, type DeviceEntry, type DeviceId, type DeviceState } from '@kasbah/shared'

type ChargerStatus = (typeof CHARGER_STATUSES)[number]

/**
 * "Start charging" on a car plugged into a charger that gives no current does nothing: the Enphase charger
 * in green charging mode, without sun, leaves the car plugged in without charging (seen on
 * 2026-10-01). So the server ALSO forces the charger, for the interface as for an automation.
 *
 * Which charger? None says which car is at the end of its cable (the one at the real house thinks
 * it is hooked to a Renault when it is the Tesla). Hence a cautious rule: the car says it is
 * plugged in and not charging, it is at home (unknown position = we believe it), and ONE SINGLE
 * controllable charger has a cable plugged in without charging. Two chargers in that case: we don't
 * guess.
 *
 * Stopping is relayed only for a vehicle that cannot stop itself (`chargerToStop`): stopping the
 * Enphase charger locks it until unplugging, sun or not.
 */
export function chargerToForce(vehicleId: DeviceId, command: Command, devices: DeviceEntry[], site: { lat: number; lon: number }): DeviceId | undefined {
  if (command.type !== 'vehicle.start_charge') return undefined
  const v = devices.find((d) => d.descriptor.id === vehicleId)?.state
  if (v?.kind !== 'vehicle' || !v.pluggedIn || v.charging) return undefined
  return onlyCharger(devices, 'connected', v.location, site)
}

/**
 * "Stop charging" for a vehicle that cannot stop it remotely (`meta.vehicle.stopViaCharger`, the
 * R5): it is the charger it charges on that we stop, in its place — the user's choice of
 * 2026-10-01, made knowingly: the Enphase charger then stays locked until unplugging.
 * Same caution as for forcing: plugged in, at home, and ONE SINGLE controllable charger charging. We
 * don't require the vehicle to say it is charging: the R5 sometimes reports "waiting" while charging.
 */
export function chargerToStop(vehicleId: DeviceId, command: Command, devices: DeviceEntry[], site: { lat: number; lon: number }): DeviceId | undefined {
  if (command.type !== 'vehicle.stop_charge') return undefined
  const entry = devices.find((d) => d.descriptor.id === vehicleId)
  const v = entry?.state
  if (v?.kind !== 'vehicle' || !v.pluggedIn || entry!.descriptor.meta.vehicle?.stopViaCharger !== true) return undefined
  return onlyCharger(devices, 'charging', v.location, site)
}

/**
 * A car whose charger Kasbah forced has reached its limit: the charger must then go back to the
 * mode it had before forcing (the user's choice of 2026-10-02), without waiting for unplugging.
 * Reached = level at least at the target AND no longer charging: the R5 on 2026-10-02 stopped at
 * 51 % for 50 %, a car still charging at its target has not finished.
 */
export function chargeLimitReached(state: DeviceState): boolean {
  if (state.kind !== 'vehicle' || state.charging === true) return false
  return state.soc !== undefined && state.chargeLimit != null && state.soc >= state.chargeLimit
}

/**
 * A car that says it is charging while no charger of the house is charging: we contradict it.
 * The user's choice of 2026-10-02: the R5 reported "charging" from a 14:00 frame (remaining time
 * dated from the frame, `chargingStatus` 0.3) while the charger, in green charging without sun,
 * gave nothing. Caution: the car is plugged in, at home (KNOWN position, otherwise it may be
 * charging elsewhere), it does not measure its own power (Tesla gives it: it knows better than we
 * do), and ALL chargers are reachable and not charging. A charging charger contradicts nothing: none
 * says which car is at the end of the cable. Wrong if the car charges on an outlet Kasbah does not
 * see — accepted risk.
 */
export function chargingRefuted(vehicle: DeviceState, devices: DeviceEntry[], site: { lat: number; lon: number }): boolean {
  if (vehicle.kind !== 'vehicle' || vehicle.charging !== true || vehicle.pluggedIn !== true) return false
  if ((vehicle.chargePowerW ?? 0) > 0) return false
  if (!vehicle.location || geoDistance(vehicle.location, site) > HOME_RADIUS_M) return false
  const chargers = devices.filter((d) => d.state.kind === 'ev_charger')
  return chargers.length > 0 && chargers.every((d) => d.state.available && d.state.kind === 'ev_charger' && d.state.status !== 'charging')
}

function onlyCharger(devices: DeviceEntry[], status: ChargerStatus, location: { lat: number; lon: number } | undefined, site: { lat: number; lon: number }): DeviceId | undefined {
  if (location && geoDistance(location, site) > HOME_RADIUS_M) return undefined
  const found = devices.filter((d) => d.state.kind === 'ev_charger' && d.state.available
    && d.state.status === status && d.descriptor.capabilities.includes('charge_control'))
  return found.length === 1 ? found[0]!.descriptor.id : undefined
}
