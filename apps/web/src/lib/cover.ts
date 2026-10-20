import { coverWords, isFlatCover } from '@kasbah/shared'

// DISPLAY convention of covers, isolated here because it is the inverse of the contract.
//
// The contract (`packages/shared`) measures an OPENING: `position` 0 = closed, 100 = open. This is
// what the JSON, the protocol, the plugins and `isDeviceOn` see ("an open shutter is active").
// The interface, for its part, shows a CLOSURE: 0 % = open, 100 % = closed — more intuitive for a
// shutter, and it is also the vendor's convention (`core:ClosureState` at Overkiz).
//
// The contract was NOT inverted: `position` serves `isDeviceOn`, the "open shutters" count
// of the summary, the tint of the 3D markers and all the plugins. Inverting the model would have
// propagated the change everywhere; inverting the display confines it to these two functions.

// Rules shared with the server (automations): they live in `@kasbah/shared`, this
// file re-exports them so that the interface's callers have nothing to change.
export { coverActivity, coverAtRest, coverWords, isFlatCover, type CoverWords } from '@kasbah/shared'

type Coverish = { meta: { cover?: { deviceClass: string } } }

/** Contract position (opening) → displayed percentage (closure). */
export function toClosure(position: number): number {
  return 100 - position
}

/** Displayed percentage (closure) → contract position (opening). */
export function fromClosure(closure: number): number {
  return 100 - closure
}

/** A gate, a garage door open onto the street: a group gesture never OPENS them. */
const PASSAGE = new Set<string>(['gate', 'garage'])

export function isPassageCover(descriptor: Coverish | undefined): boolean {
  return PASSAGE.has(descriptor?.meta.cover?.deviceClass ?? '')
}

/**
 * Cover that EXPECTS an opening: a shutter, an interior blind, a curtain, a motorized window
 * make no sense without the window or door they dress. As long as no opening is
 * assigned to them, they are to be placed — this is the case for all those that a plugin's discovery has just
 * brought, when the house was drawn before that plugin was activated.
 *
 * An AWNING is excluded from it, although it is operated like an interior blind: it unfolds
 * above a terrace, not in a bay. It CAN be assigned to an opening if the installation
 * wants it (`canTakeOpening` accepts it), but its lack of an opening is not overdue work.
 */
const EXPECTS_OPENING = new Set<string>(['shutter', 'blind', 'curtain', 'window'])

export function expectsOpening(descriptor: Coverish | undefined): boolean {
  return EXPECTS_OPENING.has(descriptor?.meta.cover?.deviceClass ?? '')
}

/**
 * Cover that we have the RIGHT to assign to an opening — everything except a GATE. Wider
 * than `expectsOpening` on purpose: an awning placed above a bay is a real case, we do not
 * forbid it; we simply do not demand it.
 *
 * A GARAGE door is part of it, although it opens onto the street: when the garage is raised,
 * it IS the panel of an opening of the facade — linking it gives it the bay's measurements, and the
 * shell then stops drawing its own leaf there (`dressedOpenings`). A gate, for its part, stands
 * in the garden: no wall carries it.
 */
export function canTakeOpening(descriptor: Coverish | undefined): boolean {
  return !!descriptor && descriptor.meta.cover?.deviceClass !== 'gate'
}

/**
 * i18n key of the word that describes this cover's REST: "Closed" for what stands upright,
 * "Raised" for a blind. Serves to SHOW the assumed state when the position is unknown — the word
 * alone would be an assertion, so it is always accompanied by its "(assumed)".
 */
export function coverRestKey(descriptor: Coverish): string {
  return `cover.${coverWords(descriptor)}.${isFlatCover(descriptor) ? 'open' : 'closed'}`
}
