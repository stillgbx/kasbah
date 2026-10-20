import { describe, expect, it } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { StateFor } from '@kasbah/shared'
import { Bus } from './bus'
import { EnergyHistory } from './history'

const energy = (productionW: number, consumptionW: number): StateFor<'energy'> =>
  ({ kind: 'energy', updatedAt: 0, available: true, productionW, consumptionW, gridW: consumptionW - productionW })

describe('EnergyHistory', () => {
  it('averages samples per hour and keeps chronological order', () => {
    const clock = new ManualClock(Date.UTC(2026, 8, 7, 10, 5))
    const bus = new Bus()
    const h = new EnergyHistory(bus, clock, 24)
    bus.emit('state', 'mock:e', energy(1000, 500))
    clock.advance(10 * 60_000)
    bus.emit('state', 'mock:e', energy(3000, 500))
    clock.advance(60 * 60_000)
    bus.emit('state', 'mock:e', energy(4000, 1000))
    const pts = h.points('mock:e', 24)
    expect(pts).toHaveLength(2)
    expect(pts[0]).toMatchObject({ productionW: 2000, consumptionW: 500, samples: 2 })
    expect(pts[1]).toMatchObject({ productionW: 4000, gridW: -3000, samples: 1 })
    expect(pts[0]!.t).toBe(Date.UTC(2026, 8, 7, 10))
  })
  it('ignores non-energy and unavailable states, prunes old buckets', () => {
    const clock = new ManualClock(Date.UTC(2026, 8, 7, 0))
    const bus = new Bus()
    const h = new EnergyHistory(bus, clock, 2)
    bus.emit('state', 'mock:l', { kind: 'light', updatedAt: 0, available: true, on: true })
    bus.emit('state', 'mock:e', { ...energy(1, 1), available: false })
    expect(h.points('mock:e')).toHaveLength(0)
    for (let i = 0; i < 5; i++) { bus.emit('state', 'mock:e', energy(i, 0)); clock.advance(3_600_000) }
    expect(h.points('mock:e', 48).length).toBeLessThanOrEqual(3)   // inclusive retention window
  })
})
