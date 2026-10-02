import { describe, expect, it } from 'vitest'
import { dayOf, delayUntil } from './vehicleSoftware'

// Heures LOCALES : on construit les dates comme l'utilisateur les lit, quel que soit le fuseau de la machine.
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime()

describe('programmer une installation', () => {
  it('une heure pas encore passée tombe aujourd’hui, une heure passée demain', () => {
    expect(delayUntil('02:00', at(2, 1, 30))).toBe(30 * 60)
    expect(delayUntil('02:00', at(2, 14))).toBe(12 * 3600)
  })
  it('à la milliseconde près, le délai tombe À l’heure choisie, pas une seconde avant', () => {
    const now = at(2, 1, 30) + 400
    const target = new Date(now + delayUntil('02:00', now) * 1000)
    expect([target.getHours(), target.getMinutes()]).toEqual([2, 0])
  })
  it('l’heure qu’il est vaut demain : « maintenant » est un autre bouton', () => {
    expect(delayUntil('14:00', at(2, 14))).toBe(24 * 3600)
  })
  it('aujourd’hui, demain, plus tard', () => {
    expect(dayOf(at(2, 23), at(2, 8))).toBe('today')
    expect(dayOf(at(3, 2), at(2, 23))).toBe('tomorrow')
    expect(dayOf(at(5, 2), at(2, 23))).toBe('later')
  })
})
