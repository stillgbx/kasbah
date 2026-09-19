import { describe, expect, it } from 'vitest'
import { extractReported, mergeShadow } from './mqtt'

// Le robot parle en DELTAS : ces deux fonctions sont tout ce qui les rend exploitables, et elles
// sont pures. Le reste de `mqtt.ts` n'est que de la plomberie de socket.

describe('mergeShadow', () => {
  it('fond un fragment dans l ombre sans perdre le reste', () => {
    const base = { cleanMissionStatus: { cycle: 'clean', phase: 'run', error: 0 }, batPct: 84 }
    expect(mergeShadow(base, { cleanMissionStatus: { phase: 'hmMidMsn' } })).toEqual({
      cleanMissionStatus: { cycle: 'clean', phase: 'hmMidMsn', error: 0 },
      batPct: 84,
    })
  })

  it('remplace un tableau au lieu de le compléter', () => {
    const base = { pmaps: [{ id: 'a' }, { id: 'b' }] }
    expect(mergeShadow(base, { pmaps: [{ id: 'c' }] })).toEqual({ pmaps: [{ id: 'c' }] })
  })

  it('laisse l ombre intacte quand le fragment n est pas un objet', () => {
    const base = { batPct: 84 }
    expect(mergeShadow(base, 'bruit')).toBe(base)
    expect(mergeShadow(base, null)).toBe(base)
    expect(mergeShadow(base, [1, 2])).toBe(base)
  })

  it('ne modifie pas l ombre précédente', () => {
    const base = { bin: { full: false, present: true } }
    const next = mergeShadow(base, { bin: { full: true } })
    expect(base.bin.full).toBe(false)
    expect(next).toEqual({ bin: { full: true, present: true } })
  })
})

describe('extractReported', () => {
  it('déplie la forme d ombre AWS', () => {
    expect(extractReported('{"state":{"reported":{"batPct":42}}}')).toEqual({ batPct: 42 })
  })

  it('accepte un état sans `reported`', () => {
    expect(extractReported('{"state":{"batPct":42}}')).toEqual({ batPct: 42 })
  })

  it('accepte l objet nu des topics propres au robot', () => {
    expect(extractReported('{"batPct":42}')).toEqual({ batPct: 42 })
  })

  it('rend null sur un topic illisible plutôt que de couper la liaison', () => {
    expect(extractReported('pas du json')).toBeNull()
    expect(extractReported('"texte"')).toBeNull()
  })
})
