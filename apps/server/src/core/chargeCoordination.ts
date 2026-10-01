import { HOME_RADIUS_M, geoDistance, type CHARGER_STATUSES, type Command, type DeviceEntry, type DeviceId } from '@kasbah/shared'

type ChargerStatus = (typeof CHARGER_STATUSES)[number]

/**
 * « Charger » une voiture branchée sur une borne qui ne donne pas de courant ne fait rien : la borne
 * Enphase en charge verte, sans soleil, laisse la voiture branchée sans charger (constaté le
 * 2026-10-01). Le serveur force donc AUSSI la borne, pour l'interface comme pour une automatisation.
 *
 * Quelle borne ? Aucune ne dit quelle voiture est au bout de son câble (celle de la maison réelle se
 * croit attelée à une Renault quand c'est la Tesla). D'où une règle prudente : la voiture se dit
 * branchée et pas en charge, elle est à la maison (position inconnue = on la croit), et UNE SEULE
 * borne pilotable a un câble branché sans charger. Deux bornes dans ce cas : on ne devine pas.
 *
 * L'arrêt n'est relayé que pour un véhicule qui ne sait pas s'arrêter lui-même (`chargerToStop`) :
 * arrêter la borne Enphase la bloque jusqu'au débranchement, soleil ou pas.
 */
export function chargerToForce(vehicleId: DeviceId, command: Command, devices: DeviceEntry[], site: { lat: number; lon: number }): DeviceId | undefined {
  if (command.type !== 'vehicle.start_charge') return undefined
  const v = devices.find((d) => d.descriptor.id === vehicleId)?.state
  if (v?.kind !== 'vehicle' || !v.pluggedIn || v.charging) return undefined
  return onlyCharger(devices, 'connected', v.location, site)
}

/**
 * « Arrêter la charge » d'un véhicule qui ne sait pas l'arrêter à distance (`meta.vehicle.stopViaCharger`,
 * la R5) : c'est la borne où il charge qu'on arrête, à sa place — choix de l'utilisateur du
 * 2026-10-01, en connaissance de cause : la borne Enphase reste alors bloquée jusqu'au débranchement.
 * Même prudence que pour forcer : branché, à la maison, et UNE SEULE borne pilotable en charge. On ne
 * demande pas au véhicule de se dire en charge : la R5 annonce parfois « en attente » en chargeant.
 */
export function chargerToStop(vehicleId: DeviceId, command: Command, devices: DeviceEntry[], site: { lat: number; lon: number }): DeviceId | undefined {
  if (command.type !== 'vehicle.stop_charge') return undefined
  const entry = devices.find((d) => d.descriptor.id === vehicleId)
  const v = entry?.state
  if (v?.kind !== 'vehicle' || !v.pluggedIn || entry!.descriptor.meta.vehicle?.stopViaCharger !== true) return undefined
  return onlyCharger(devices, 'charging', v.location, site)
}

function onlyCharger(devices: DeviceEntry[], status: ChargerStatus, location: { lat: number; lon: number } | undefined, site: { lat: number; lon: number }): DeviceId | undefined {
  if (location && geoDistance(location, site) > HOME_RADIUS_M) return undefined
  const found = devices.filter((d) => d.state.kind === 'ev_charger' && d.state.available
    && d.state.status === status && d.descriptor.capabilities.includes('charge_control'))
  return found.length === 1 ? found[0]!.descriptor.id : undefined
}
