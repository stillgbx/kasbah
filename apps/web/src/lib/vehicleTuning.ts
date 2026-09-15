import type { DeviceDescriptor, HouseDevice, VehicleFinish } from '@kasbah/shared'
import { modelsFor } from '../three/models/catalog'

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
 * La couleur à peindre sur la carrosserie, dans l'ordre de ce qui fait autorité :
 *  1. celle que l'utilisateur a RÉGLÉE — un covering, une repeinte ou un simple goût contredisent
 *     l'usine, et c'est lui qui regarde la scène ;
 *  2. celle que le plugin a su DÉDUIRE du relevé (`meta.vehicle.color`) ;
 *  3. rien — et la scène applique alors sa couleur de véhicule, qui suit le thème.
 *
 * Effacer le réglage manuel fait donc retomber sur ce qu'on sait du véhicule, pas sur le gris de la
 * scène : c'est tout l'intérêt de garder les deux.
 */
export const bodyColorOf = (
  descriptor: DeviceDescriptor | undefined,
  houseDevice: Pick<HouseDevice, 'bodyColor'> | undefined,
): string | undefined => houseDevice?.bodyColor ?? descriptor?.meta.vehicle?.color

/** Même règle que la couleur, pour l'aspect. Défaut : celui du matériau de la scène, donc rien ne change. */
export const bodyFinishOf = (
  descriptor: DeviceDescriptor | undefined,
  houseDevice: Pick<HouseDevice, 'bodyFinish'> | undefined,
): VehicleFinish => houseDevice?.bodyFinish ?? descriptor?.meta.vehicle?.finish ?? SCENE_FINISH

/**
 * Ce que chaque aspect vaut pour un matériau PBR. Ces valeurs n'ont de sens qu'avec la carte
 * d'environnement des véhicules : sans reflet, la part métallique ne rend rien et les trois se
 * ressemblent.
 */
/** L'aspect que porte DÉJÀ le matériau de véhicule de la scène : s'y tenir, c'est pouvoir le partager. */
export const SCENE_FINISH: VehicleFinish = 'metallic'

export const FINISH_MATERIAL: Record<VehicleFinish, { metalness: number; roughness: number }> = {
  // laquée non métallisée : brillante, mais c'est le vernis qui brille, pas la poudre
  solid: { metalness: 0.15, roughness: 0.3 },
  metallic: { metalness: 0.55, roughness: 0.28 },
  // mate : elle DIFFUSE, donc pas de ciel net dessus — c'est là que l'écart se voit le plus
  matte: { metalness: 0.25, roughness: 0.85 },
}

/**
 * Décalage et rotation ne concernent qu'une voiture posée par son GPS : celle qu'on a PLACÉE à la
 * main dans la maison tient déjà sa place et son cap du JSON. Sans aucun réglage à offrir, la
 * section — et le bouton qui la déplie — disparaissent.
 *
 * La carrosserie 3D, elle, se choisit pour TOUT véhicule dont le plugin en livre une, placé à la
 * main ou non : c'est un choix d'apparence, sans rapport avec la façon dont la voiture trouve sa
 * place.
 */
export const tunableVehicle = (descriptor: DeviceDescriptor, houseDevice: HouseDevice | undefined): boolean =>
  houseDevice?.position === undefined || needsCapacity(descriptor) || modelsFor(descriptor.pluginId, descriptor.meta.manufacturer).length > 0
