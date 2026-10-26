import { describe, expect, it } from 'vitest'
import type { DeviceEnergyDays } from '@kasbah/shared'
import { recentEnergyDays } from './recentDays'

// Local midnights built with the Date constructor: the test holds in any time zone.
const day = (d: number) => new Date(2026, 2, d).getTime()

describe('recentEnergyDays', () => {
  // the 27th to today (31st), across the spring clock change (29 March)
  const full: DeviceEnergyDays = {
    deviceId: 'site', since: day(27), syncedAt: 1,
    days: [27, 28, 30, 31].map((d) => ({ t: day(d), source: 'local' as const, productionWh: d })),
    inverters: { from: day(27), syncedAt: 2, devices: [
      { externalId: 'A', lifetimeWh: 900, wh: [1, 2, 3, 4, 5], peakW: [10, 20, 30, 40, 50] },
      { externalId: 'B', wh: [6, 7, 8, 9, 10] },
    ] },
  }
  const now = new Date(2026, 2, 31, 14).getTime()

  it('keeps the last n calendar days, today included, whatever the clock change', () => {
    const r = recentEnergyDays(full, 3, now)
    expect(r.days.map((x) => x.t)).toEqual([day(30), day(31)])    // the 29th was never measured
    expect(r.inverters!.from).toBe(day(29))
    expect(r.inverters!.devices).toEqual([
      { externalId: 'A', lifetimeWh: 900, wh: [3, 4, 5], peakW: [30, 40, 50] },
      { externalId: 'B', wh: [8, 9, 10] },
    ])
    expect([r.since, r.syncedAt, r.inverters!.syncedAt]).toEqual([day(27), 1, 2])
  })

  it('a history shorter than asked comes whole', () => {
    expect(recentEnergyDays(full, 30, now)).toEqual(full)
  })
})
