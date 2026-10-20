import { describe, expect, it } from 'vitest'
import { extractReported, mergeShadow } from './mqtt'

// The robot speaks in DELTAS: these two functions are all that makes them usable, and they are
// pure. The rest of `mqtt.ts` is just socket plumbing.

describe('mergeShadow', () => {
  it('merges a fragment into the shadow without losing the rest', () => {
    const base = { cleanMissionStatus: { cycle: 'clean', phase: 'run', error: 0 }, batPct: 84 }
    expect(mergeShadow(base, { cleanMissionStatus: { phase: 'hmMidMsn' } })).toEqual({
      cleanMissionStatus: { cycle: 'clean', phase: 'hmMidMsn', error: 0 },
      batPct: 84,
    })
  })

  it('replaces an array instead of extending it', () => {
    const base = { pmaps: [{ id: 'a' }, { id: 'b' }] }
    expect(mergeShadow(base, { pmaps: [{ id: 'c' }] })).toEqual({ pmaps: [{ id: 'c' }] })
  })

  it('leaves the shadow untouched when the fragment is not an object', () => {
    const base = { batPct: 84 }
    expect(mergeShadow(base, 'bruit')).toBe(base)
    expect(mergeShadow(base, null)).toBe(base)
    expect(mergeShadow(base, [1, 2])).toBe(base)
  })

  it('does not modify the previous shadow', () => {
    const base = { bin: { full: false, present: true } }
    const next = mergeShadow(base, { bin: { full: true } })
    expect(base.bin.full).toBe(false)
    expect(next).toEqual({ bin: { full: true, present: true } })
  })
})

describe('extractReported', () => {
  it('unwraps the AWS shadow shape', () => {
    expect(extractReported('{"state":{"reported":{"batPct":42}}}')).toEqual({ batPct: 42 })
  })

  it('accepts a state without `reported`', () => {
    expect(extractReported('{"state":{"batPct":42}}')).toEqual({ batPct: 42 })
  })

  it('accepts the bare object of the robot own topics', () => {
    expect(extractReported('{"batPct":42}')).toEqual({ batPct: 42 })
  })

  it('returns null on an unreadable topic rather than cutting the link', () => {
    expect(extractReported('pas du json')).toBeNull()
    expect(extractReported('"texte"')).toBeNull()
  })
})
