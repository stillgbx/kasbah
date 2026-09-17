import type { DeviceDescriptor, HouseDevice } from '@kasbah/shared'
import { isFlatCover } from './cover'

// Appareils dont le `yaw` (0 = face à +y) a un sens : on le règle depuis le panneau (ligne
// « Orientation ») et on le montre dans la scène (cône « regarde vers » en mode « Déplacer »).
//
// Trois familles, pour trois raisons différentes. Ce qui REGARDE quelque part : un écran, une caméra,
// un véhicule. Ce qui a une FACE, posé contre un mur : une borne de recharge, une batterie, le
// boîtier d'une passerelle, le cadran d'un thermostat — leur dos touche le mur, et un coffret tourné
// à l'envers se voit. Et ce
// qui BARRE un passage : un portail, une porte de garage, dessinés comme un panneau qu'on ne peut
// pas poser en travers de son entrée. Une enceinte ou une lampe n'ont d'orientation utile ni dans
// un sens ni dans l'autre.

export function isOrientable(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  if (!descriptor) return device.yaw !== undefined
  if (descriptor.kind === 'media_player') {
    const cls = descriptor.meta.mediaPlayer?.deviceClass
    return cls === 'tv' || cls === 'display'
  }
  if (descriptor.kind === 'cover') return isFreeCover(device)
  return descriptor.kind === 'camera' || descriptor.kind === 'vehicle'
    || descriptor.kind === 'ev_charger' || descriptor.kind === 'energy' || descriptor.kind === 'climate'
    || descriptor.kind === 'water'
}

/**
 * Ouvrant dessiné comme un objet LIBRE, donc à orienter et à dimensionner soi-même : un portail, une
 * porte de garage. Un ouvrant lié à une ouverture (`openingId`) n'en a besoin ni de l'un ni de
 * l'autre — son tablier épouse déjà le rectangle de la fenêtre, dans le plan du mur.
 */
function isFreeCover(device: HouseDevice): boolean {
  return !device.openingId
}

/** Encombrement réglable depuis le panneau (ligne « Taille ») : seuls les ouvrants libres en ont un. */
export function isSizable(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  return (descriptor?.kind ?? device.kind) === 'cover' && isFreeCover(device)
}

/**
 * Encombrement dessiné par défaut (m), quand le JSON n'en donne pas. La seconde dimension se lit
 * selon la nature : la HAUTEUR d'un portail debout, l'AVANCÉE d'un store déployé à plat.
 */
export const DEFAULT_COVER_SIZE = { width: 0.6, height: 0.5 } as const
export const DEFAULT_AWNING_SIZE = { width: 3, height: 2 } as const

export function defaultCoverSize(descriptor: DeviceDescriptor | undefined): { width: number; height: number } {
  return isFlatCover(descriptor) ? DEFAULT_AWNING_SIZE : DEFAULT_COVER_SIZE
}

/**
 * Battants d'un ouvrant libre DEBOUT : ce qui s'écarte quand il s'ouvre. Le JSON décide ; à défaut,
 * un portail en a deux (le portail à deux vantaux est la règle) et tout le reste un seul — une porte
 * de garage est d'une pièce.
 */
export function coverLeaves(device: HouseDevice, descriptor: DeviceDescriptor | undefined): 1 | 2 {
  if (device.leaves) return device.leaves
  return descriptor?.meta.cover?.deviceClass === 'gate' ? 2 : 1
}

/** Ouvrant dont les battants se comptent : debout et libre (un store se déploie, il n'en a pas). */
export function hasLeaves(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  return isSizable(device, descriptor) && !isFlatCover(descriptor)
}

/** Encombrement d'un ouvrant libre : celui du JSON, sinon le défaut de sa nature. */
export function coverSize(device: HouseDevice, descriptor: DeviceDescriptor | undefined): { width: number; height: number } {
  return device.size ?? defaultCoverSize(descriptor)
}

/** Cap en radians pour Three (rotation autour de Z), depuis les degrés du JSON. */
export function yawToRad(yaw: number | undefined): number {
  return ((yaw ?? 0) * Math.PI) / 180
}
