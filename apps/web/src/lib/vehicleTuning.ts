import type { DeviceDescriptor, HouseDevice } from '@kasbah/shared'

// Ce qu'il reste à régler à la main sur un véhicule. Deux surfaces posent la question — la carte de
// la vue Véhicules, pour n'offrir « Régler » qu'à qui a quelque chose à régler, et le panneau de
// l'appareil sélectionné, qui affiche la section ou rien — d'où ces règles écrites une seule fois.

/**
 * La capacité ne se demande qu'à qui en a besoin : un véhicule qui DIT sa puissance de charge
 * (capacité `charge_power`) n'a rien à faire estimer, et un champ qui ne sert à rien est un champ
 * de trop.
 */
export const needsCapacity = (descriptor: DeviceDescriptor): boolean => !descriptor.capabilities.includes('charge_power')

/**
 * Décalage et rotation ne concernent qu'une voiture posée par son GPS : celle qu'on a PLACÉE à la
 * main dans la maison tient déjà sa place et son cap du JSON. Sans aucun réglage à offrir, la
 * section — et le bouton qui la déplie — disparaissent.
 */
export const tunableVehicle = (descriptor: DeviceDescriptor, houseDevice: HouseDevice | undefined): boolean =>
  houseDevice?.position === undefined || needsCapacity(descriptor)
