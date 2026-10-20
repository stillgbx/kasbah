import type { DeviceDescriptor, HouseDevice } from '@kasbah/shared'
import { isFlatCover } from './cover'

// Devices whose `yaw` (0 = facing +y) is meaningful: it is set from the panel ("Orientation"
// row) and shown in the scene ("looks toward" cone in "Move" mode).
//
// Three families, for three different reasons. What LOOKS somewhere: a screen, a camera,
// a vehicle. What has a FACE, placed against a wall: a charger, a battery, a
// gateway's case, a thermostat's dial — their back touches the wall, and a cabinet turned
// backwards shows. And what
// BLOCKS a passage: a gate, a garage door, drawn as a panel that cannot
// be placed across its entrance. A speaker or a lamp has no useful orientation either
// way.

export function isOrientable(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  if (!descriptor) return device.yaw !== undefined
  if (descriptor.kind === 'media_player') {
    const cls = descriptor.meta.mediaPlayer?.deviceClass
    if (cls === 'tv' || cls === 'display') return true
    // a bar or an alarm-clock block has a direction; cylinder and pebble have none
    return (cls === 'speaker' || cls === undefined)
      && (device.speakerShape === 'bar' || device.speakerShape === 'block')
  }
  if (descriptor.kind === 'cover') return isFreeCover(device)
  return descriptor.kind === 'camera' || descriptor.kind === 'vehicle'
    || descriptor.kind === 'ev_charger' || descriptor.kind === 'energy' || descriptor.kind === 'climate'
    || descriptor.kind === 'water'
}

/**
 * Cover drawn as a FREE object, therefore to be oriented and sized by hand: a gate, a
 * garage door. A cover linked to an opening (`openingId`) needs neither of the two
 * — its apron already follows the window's rectangle, in the wall's plane.
 */
function isFreeCover(device: HouseDevice): boolean {
  return !device.openingId
}

/**
 * Footprint adjustable from the panel ("Size" row): free covers (gate, blind)
 * and TVs — the scene has nothing else to size the screen.
 */
export function isSizable(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  const kind = descriptor?.kind ?? device.kind
  if (kind === 'cover') return isFreeCover(device)
  return isTv(descriptor)
}

/** TV: its size is set as a diagonal (inches), not in meters. */
export function isTv(descriptor: DeviceDescriptor | undefined): boolean {
  return descriptor?.kind === 'media_player' && descriptor.meta.mediaPlayer?.deviceClass === 'tv'
}

/**
 * Footprint drawn by default (m), when the JSON gives none. The second dimension is read
 * according to the nature: the HEIGHT of a standing gate, the PROJECTION of an awning deployed flat; for a
 * TV, width × height derived from a 16:9 diagonal (45″ by default).
 */
export const DEFAULT_COVER_SIZE = { width: 0.6, height: 0.5 } as const
export const DEFAULT_AWNING_SIZE = { width: 3, height: 2 } as const
/** Default TV diagonal (inches) — common commercial size, ≈ the old 1 × 0.56 m marker. */
export const DEFAULT_TV_INCHES = 45
const INCH_M = 0.0254
/** Hypotenuse of the 16×9 rectangle: a TV is sold by diagonal, the panel is always 16:9. */
const TV_DIAG_RATIO = Math.hypot(16, 9)

/** Panel (m) from the commercial diagonal (inches), 16:9 aspect. */
export function tvSizeFromInches(inches: number): { width: number; height: number } {
  const d = inches * INCH_M
  return {
    width: Math.round(((d * 16) / TV_DIAG_RATIO) * 1000) / 1000,
    height: Math.round(((d * 9) / TV_DIAG_RATIO) * 1000) / 1000,
  }
}

/** Commercial diagonal (inches, whole) from the panel stored in meters. */
export function tvInchesFromSize(size: { width: number; height: number }): number {
  return Math.round(Math.hypot(size.width, size.height) / INCH_M)
}

export const DEFAULT_TV_SIZE = tvSizeFromInches(DEFAULT_TV_INCHES)

export function defaultCoverSize(descriptor: DeviceDescriptor | undefined): { width: number; height: number } {
  if (isTv(descriptor)) return DEFAULT_TV_SIZE
  return isFlatCover(descriptor) ? DEFAULT_AWNING_SIZE : DEFAULT_COVER_SIZE
}

/**
 * Leaves of a STANDING free cover: what moves apart when it opens. The JSON decides; failing that,
 * a gate has two (the two-leaf gate is the rule) and everything else just one — a garage
 * door is one piece.
 */
export function coverLeaves(device: HouseDevice, descriptor: DeviceDescriptor | undefined): 1 | 2 {
  if (device.leaves) return device.leaves
  return descriptor?.meta.cover?.deviceClass === 'gate' ? 2 : 1
}

/**
 * Cover whose leaves are counted: everything that STANDS — an awning deploys, it has none.
 * A gate's leaves move apart, a shutter's panels only cut up its
 * apron: two drawings for the same number, and the same question to ask the user.
 */
export function hasLeaves(device: HouseDevice, descriptor: DeviceDescriptor | undefined): boolean {
  return (descriptor?.kind ?? device.kind) === 'cover' && !isFlatCover(descriptor)
}

/** Drawn footprint (free cover or TV): the JSON's, otherwise the default of its nature. */
export function coverSize(device: HouseDevice, descriptor: DeviceDescriptor | undefined): { width: number; height: number } {
  return device.size ?? defaultCoverSize(descriptor)
}

/** Heading in radians for Three (rotation around Z), from the JSON's degrees. */
export function yawToRad(yaw: number | undefined): number {
  return ((yaw ?? 0) * Math.PI) / 180
}
