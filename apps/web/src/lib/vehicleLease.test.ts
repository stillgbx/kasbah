import { describe, expect, it } from 'vitest'
import { leaseOverPace, leaseProgress, leaseYearMarks } from './vehicleLease'

const LEASE = { start: '2025-01-01', end: '2027-01-01', km: 20000 }
const at = (iso: string) => Date.parse(`${iso}T12:00:00Z`)

describe('leaseProgress', () => {
  it('autorise le forfait au prorata du temps écoulé', () => {
    const p = leaseProgress(LEASE, 9000, at('2026-01-01'))!
    expect(p.elapsedShare).toBeCloseTo(0.5, 2)
    expect(p.allowedKm).toBeCloseTo(10000, -2)
    expect(p.drivenKm).toBe(9000)
    expect(leaseOverPace(p)).toBe(false)
    expect(p.projectedKm).toBeCloseTo(18000, -2)
    expect(p.ended).toBe(false)
  })

  it('compte depuis le compteur à la remise des clés', () => {
    const p = leaseProgress({ ...LEASE, startKm: 500 }, 11500, at('2026-01-01'))!
    expect(p.drivenKm).toBe(11000)
    expect(leaseOverPace(p)).toBe(true)
  })

  it('ne projette rien le premier mois', () => {
    expect(leaseProgress(LEASE, 800, at('2025-01-10'))!.projectedKm).toBeNull()
  })

  it('reste borné avant le début et après la fin', () => {
    expect(leaseProgress(LEASE, 0, at('2024-12-01'))!.allowedKm).toBe(0)
    const after = leaseProgress(LEASE, 21000, at('2027-06-01'))!
    expect(after.allowedKm).toBe(20000)
    expect(after.ended).toBe(true)
    expect(after.usedShare).toBeCloseTo(1.05)
  })

  it('ne suit rien sans compteur lu', () => {
    expect(leaseProgress(LEASE, undefined, at('2026-01-01'))).toBeNull()
  })
})

describe('leaseYearMarks', () => {
  it('un repère par anniversaire, avant l échéance', () => {
    const marks = leaseYearMarks({ start: '2025-03-01', end: '2028-04-01', km: 45000 })
    expect(marks.map((y) => y.date)).toEqual(['2026-03-01', '2027-03-01', '2028-03-01'])
    expect(marks[0]!.share).toBeCloseTo(365 / 1127, 3)
    expect(marks[0]!.km).toBe(Math.round(45000 * 365 / 1127))
  })

  it('pas de repère sur l échéance elle-même', () => {
    expect(leaseYearMarks(LEASE)).toHaveLength(1)
  })
})
