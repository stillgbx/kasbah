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
    if (cls === 'tv' || cls === 'display') return true
    // une barre ou un bloc-réveil a un sens ; cylindre et galet n'en ont pas
    return (cls === 'speaker' || cls === undefined)
      && (device.speakerShape === 'bar' || device.speakerShape === 'block')
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

/**
 * Encombrement réglable depuis le panneau (ligne « Taille ») : ouvrants libres (portail, store)
 * et téléviseurs — la scène n'a rien d'autre pour dimensionner l'écran.
 */
export function isSizable(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  const kind = descriptor?.kind ?? device.kind
  if (kind === 'cover') return isFreeCover(device)
  return isTv(descriptor)
}

/** Téléviseur : sa taille se règle en diagonale (pouces), pas en mètres. */
export function isTv(descriptor: DeviceDescriptor | undefined): boolean {
  return descriptor?.kind === 'media_player' && descriptor.meta.mediaPlayer?.deviceClass === 'tv'
}

/**
 * Encombrement dessiné par défaut (m), quand le JSON n'en donne pas. La seconde dimension se lit
 * selon la nature : la HAUTEUR d'un portail debout, l'AVANCÉE d'un store déployé à plat ; pour une
 * TV, largeur × hauteur dérivées d'une diagonale 16:9 (45″ par défaut).
 */
export const DEFAULT_COVER_SIZE = { width: 0.6, height: 0.5 } as const
export const DEFAULT_AWNING_SIZE = { width: 3, height: 2 } as const
/** Diagonale TV par défaut (pouces) — taille commerciale courante, ≈ l'ancien marqueur 1 × 0,56 m. */
export const DEFAULT_TV_INCHES = 45
const INCH_M = 0.0254
/** Hypoténuse du rectangle 16×9 : une TV se vend en diagonale, la dalle est toujours 16:9. */
const TV_DIAG_RATIO = Math.hypot(16, 9)

/** Dalle (m) depuis la diagonale commerciale (pouces), aspect 16:9. */
export function tvSizeFromInches(inches: number): { width: number; height: number } {
  const d = inches * INCH_M
  return {
    width: Math.round(((d * 16) / TV_DIAG_RATIO) * 1000) / 1000,
    height: Math.round(((d * 9) / TV_DIAG_RATIO) * 1000) / 1000,
  }
}

/** Diagonale commerciale (pouces, entière) depuis la dalle stockée en mètres. */
export function tvInchesFromSize(size: { width: number; height: number }): number {
  return Math.round(Math.hypot(size.width, size.height) / INCH_M)
}

export const DEFAULT_TV_SIZE = tvSizeFromInches(DEFAULT_TV_INCHES)

export function defaultCoverSize(descriptor: DeviceDescriptor | undefined): { width: number; height: number } {
  if (isTv(descriptor)) return DEFAULT_TV_SIZE
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

/**
 * Ouvrant dont les vantaux se comptent : tout ce qui se tient DEBOUT — un store se déploie, il n'en
 * a pas. Les battants d'un portail s'écartent, les panneaux d'un volet ne font que découper son
 * tablier : deux dessins pour un même nombre, et la même question à poser à l'utilisateur.
 */
export function hasLeaves(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  return (descriptor?.kind ?? device.kind) === 'cover' && !isFlatCover(descriptor)
}

/** Encombrement dessiné (ouvrant libre ou TV) : celui du JSON, sinon le défaut de sa nature. */
export function coverSize(device: HouseDevice, descriptor: DeviceDescriptor | undefined): { width: number; height: number } {
  return device.size ?? defaultCoverSize(descriptor)
}

/** Cap en radians pour Three (rotation autour de Z), depuis les degrés du JSON. */
export function yawToRad(yaw: number | undefined): number {
  return ((yaw ?? 0) * Math.PI) / 180
}
