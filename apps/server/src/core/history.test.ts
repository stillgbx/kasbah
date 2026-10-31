import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ManualClock } from '@kasbah/mock-sim'
import type { StateFor } from '@kasbah/shared'
import { Bus } from './bus'
import { EnergyHistory } from './history'

const energy = (productionW: number, consumptionW: number): StateFor<'energy'> =>
  ({ kind: 'energy', updatedAt: 0, available: true, productionW, consumptionW, gridW: consumptionW - productionW })

describe('EnergyHistory', () => {
  it('keeps the highest draw of each phase within the hour, an export counting as nothing', () => {
    const clock = new ManualClock(Date.UTC(2026, 8, 7, 10, 5))
    const bus = new Bus()
    const h = new EnergyHistory(bus, clock)
    const phases = (...va: number[]) => ({ ...energy(0, 0), gridPhases: va.map((v) => ({ w: v, va: v })) })
    bus.emit('state', 'mock:e', phases(4000, -500, 1000))
    clock.advance(10_000)
    bus.emit('state', 'mock:e', phases(9500, 200, 800))
    clock.advance(10_000)
    bus.emit('state', 'mock:e', phases(3000, 100, 1200))
    expect(h.points('mock:e')[0]!.phasePeakVa).toEqual([9500, 200, 1200])
  })
  it('survives a restart: the hour that explains a cut is still there afterwards', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kasbah-history-')), 'energy-history.json')
    const clock = new ManualClock(Date.UTC(2026, 8, 7, 10, 5))
    const first = new EnergyHistory(new Bus(), clock, { file })
    first.record('mock:e', { ...energy(1000, 500), gridPhases: [{ w: 9800, va: 10_200 }] })
    await new Promise((r) => setTimeout(r, 50))           // the write is queued, not awaited
    const again = new EnergyHistory(new Bus(), clock, { file })
    expect(again.points('mock:e')[0]).toMatchObject({ productionW: 1000, phasePeakVa: [10_200] })
  })
  it('writes at once only a peak close to the limit; the rest waits for the five-minute save', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'kasbah-history-')), 'energy-history.json')
    const clock = new ManualClock(Date.UTC(2026, 8, 7, 10, 5))
    const h = new EnergyHistory(new Bus(), clock, { file })
    const drawing = (va: number) => ({ ...energy(0, 0), phaseLimitVa: 12_000, gridPhases: [{ w: va, va }] })
    const saved = async () => {
      await new Promise((r) => setTimeout(r, 50))
      return new EnergyHistory(new Bus(), clock, { file }).points('mock:e')[0]?.phasePeakVa
    }
    h.record('mock:e', drawing(3000))                     // first record: the periodic save is due
    expect(await saved()).toEqual([3000])
    clock.advance(10_000)
    h.record('mock:e', drawing(6000))                     // rises, but far from the limit: waits
    expect(await saved()).toEqual([3000])
    clock.advance(10_000)
    h.record('mock:e', drawing(10_000))                   // past 80 % of 12 kVA: written at once
    expect(await saved()).toEqual([10_000])
    clock.advance(10_000)
    h.record('mock:e', drawing(10_500))
    clock.advance(5 * 60_000)
    h.record('mock:e', drawing(500))                      // five minutes on: the periodic save
    expect(await saved()).toEqual([10_500])
  })
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
