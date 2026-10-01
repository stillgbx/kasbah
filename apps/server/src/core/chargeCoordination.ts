import { HOME_RADIUS_M, geoDistance, type Command, type DeviceEntry, type DeviceId } from '@kasbah/shared'

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
 * Seul le démarrage est relayé. Arrêter la borne Enphase la bloque jusqu'au débranchement, soleil ou
 * pas : arrêter la voiture suffit, et la borne repasse seule en charge verte au débranchement.
 */
export function chargerToForce(vehicleId: DeviceId, command: Command, devices: DeviceEntry[], site: { lat: number; lon: number }): DeviceId | undefined {
  if (command.type !== 'vehicle.start_charge') return undefined
  const v = devices.find((d) => d.descriptor.id === vehicleId)?.state
  if (v?.kind !== 'vehicle' || !v.pluggedIn || v.charging) return undefined
  if (v.location && geoDistance(v.location, site) > HOME_RADIUS_M) return undefined
  const idle = devices.filter((d) => d.state.kind === 'ev_charger' && d.state.available
    && d.state.status === 'connected' && d.descriptor.capabilities.includes('charge_control'))
  return idle.length === 1 ? idle[0]!.descriptor.id : undefined
}
