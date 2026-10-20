import type { DeviceDescriptor } from './descriptor'
import type { DeviceState, StateFor } from './state'

// "Business" reading of a state: is the device ACTIVE? Pure rules, shared since the
// server needs them too (automations: "a light is on in the room", "the
// TV is running"). They used to live in `apps/web/src/lib/deviceState.ts` and `cover.ts`, which
// re-export them: the behavior is that of the interface, identical.

/**
 * The player is broadcasting something: a playback, or an app on screen of which nothing more is known
 * (`on`, native Netflix) — the screen is indeed busy. Used for the switch, the pulsing dot, the tint of
 * the icon and the wave of the 3D scene; the "streaming" counter of the header, for its part, only counts `playing`.
 */
export function isMediaActive(s: StateFor<'media_player'>): boolean {
  return s.playback === 'playing' || s.playback === 'on'
}

/**
 * Vocabulary of a cover. The command is the same (`cover.open` / `cover.close`), the words are not:
 * a shutter OPENS and CLOSES, a blind RAISES and LOWERS. The choice comes from
 * `meta.cover.deviceClass`, set by the plugin from what the vendor declares — never from a
 * heuristic on the device name.
 *
 * The value serves as an i18n prefix: `cover.openClose.*` or `cover.upDown.*`.
 */
export type CoverWords = 'openClose' | 'upDown'

/** An awning, a sunshade or a screen are operated vertically; the rest opens. */
const UP_DOWN = new Set<string>(['awning', 'blind'])

type Coverish = { meta: { cover?: { deviceClass: string } } }

export function coverWords(descriptor: Coverish): CoverWords {
  return UP_DOWN.has(descriptor.meta.cover?.deviceClass ?? '') ? 'upDown' : 'openClose'
}

/**
 * Cover that deploys FLAT: an awning, a sunshade advance above a terrace, where
 * a shutter, a gate stand upright in their opening. Same list as the vocabulary ("lowers"
 * rather than "closes"): a single source, so that the drawn shape, the spoken words and
 * the highlighted state never contradict one another.
 */
export function isFlatCover(descriptor: Coverish | undefined): boolean {
  return !!descriptor && coverWords(descriptor) === 'upDown'
}

/**
 * Is the cover AT REST? It is the state where it asks nothing of anyone: **closed** for what
 * stands upright (shutter, gate), **raised** for an awning — an awning at rest is retracted, not
 * deployed (it is when deployed that it fears the wind, see `coverActivity`).
 *
 * **An unknown position is ASSUMED at rest.** A one-way radio never says where it
 * stands, and doubt must lean to the safe side: without this assumption, a silent gate was enough to
 * make people believe the house was not secured, and the next press would have opened it. It is not
 * an ASSERTION — the labels keep saying "Unknown" — it is a default decision.
 */
export function coverAtRest(descriptor: Coverish | undefined, position: number | undefined): boolean {
  if (position === undefined) return true
  return isFlatCover(descriptor) ? position >= 100 : position <= 0
}

/**
 * Share of the cover that GETS NOTICED, from 0 (nothing to report) to 1. It is the inverse from one kind to
 * the other, and that is intended: of a shutter we remember that it is OPEN, of an awning that it is DEPLOYED —
 * it is when deployed that it fears the wind, and when folded that there is nothing to watch.
 *
 * Used for everything that highlights a cover: icon tint, gauge of the Covers view, pill
 * of the 3D marker. Unknown position = 0: nothing is asserted about a motor that has said nothing.
 */
export function coverActivity(descriptor: Coverish | undefined, position: number | undefined): number {
  if (position === undefined) return 0
  return isFlatCover(descriptor) ? 1 - position / 100 : position / 100
}

/**
 * True if the device is "active": light on, shutter open, playback in progress, robot at work…
 *
 * `descriptor`: only a COVER needs it, and only for its kind — a shutter gets noticed
 * open, an awning deployed (see `coverActivity`). Without a descriptor, it is the shutter rule.
 */
export function isDeviceOn(s: DeviceState, descriptor?: DeviceDescriptor): boolean {
  if (!s.available) return false
  switch (s.kind) {
    case 'light': return s.on
    // unknown position (RTS without feedback): neither active nor inactive, the icon is not tinted
    case 'cover': return coverActivity(descriptor, s.position) > 0
    case 'media_player': return isMediaActive(s)
    case 'climate': return s.mode !== 'off'
    case 'vacuum': return s.activity === 'cleaning'
    case 'mower': return s.activity === 'mowing'
    case 'ev_charger': return s.status === 'charging'
    case 'vehicle': return s.charging
    case 'energy': return s.productionW > 0
    case 'sensor': return false
    case 'camera': return false
    case 'weather': return false
    case 'water': return false
      // a portion BEING dispensed: the only moment when a feeder does something
    case 'pet_feeder': return s.feeding === true
    case 'pet_fountain': return s.on
    case 'fan': return s.on
  }
}

/**
 * Declared nature of a device, whatever its kind (shutter or awning, TV or speaker, doorbell,
 * heat pump…): what an automation filters on when it targets "all the shutters" rather
 * than "all the covers". The CONTRACT defaults apply: a player silent about its nature
 * is a speaker, a climate a thermostat. Absent = the kind has no nature.
 */
export function deviceClassOf(descriptor: DeviceDescriptor): string | undefined {
  const m = descriptor.meta
  switch (descriptor.kind) {
    case 'cover': return m.cover?.deviceClass
    case 'media_player': return m.mediaPlayer?.deviceClass ?? 'speaker'
    case 'camera': return m.camera?.deviceClass
    case 'sensor': return m.sensor?.deviceClass
    case 'climate': return m.climate?.deviceClass ?? 'thermostat'
    default: return undefined
  }
}
