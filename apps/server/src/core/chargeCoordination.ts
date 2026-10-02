import { HOME_RADIUS_M, geoDistance, type CHARGER_STATUSES, type Command, type DeviceEntry, type DeviceId, type DeviceState } from '@kasbah/shared'

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

/**
 * Une voiture dont Kasbah a forcé la borne est arrivée à sa limite : la borne doit alors reprendre le
 * mode d'avant le forçage (choix de l'utilisateur du 2026-10-02), sans attendre le débranchement.
 * Arrivée = niveau au moins à la cible ET plus en charge : la R5 du 2026-10-02 s'est arrêtée à 51 %
 * pour 50 %, une voiture qui charge encore à sa cible n'a pas fini.
 */
export function chargeLimitReached(state: DeviceState): boolean {
  if (state.kind !== 'vehicle' || state.charging === true) return false
  return state.soc !== undefined && state.chargeLimit != null && state.soc >= state.chargeLimit
}

/**
 * Une voiture qui se dit en charge, alors qu'aucune borne de la maison ne charge : on la dément.
 * Choix de l'utilisateur du 2026-10-02 : la R5 annonçait « en charge » depuis une trame de 14:00
 * (temps restant daté de la trame, `chargingStatus` 0.3) pendant que la borne, en charge verte sans
 * soleil, ne donnait rien. Prudence : la voiture est branchée, à la maison (position CONNUE, sinon
 * elle peut charger ailleurs), elle ne mesure pas sa propre puissance (Tesla la donne : elle sait
 * mieux que nous), et TOUTES les bornes sont joignables et ne chargent pas. Une borne qui charge ne
 * dément rien : aucune ne dit quelle voiture est au bout du câble. Faux si la voiture charge sur une
 * prise que Kasbah ne voit pas — risque accepté.
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
