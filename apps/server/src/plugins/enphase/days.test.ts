import { describe, expect, it } from 'vitest'
import { EnergyDays, dayKey, keyStart, lifetimeEnergySchema } from './days'

// Local times built with the Date constructor: the tests hold in any time zone.
const at = (d: number, h: number, m = 0) => new Date(2026, 5, d, h, m).getTime()
const opts = { siteGapMs: 2 * 60_000 }

/** Readings every minute from `from` to `to` (inclusive), at constant power. */
function feed(days: EnergyDays, from: number, to: number, power: Parameters<EnergyDays['recordSite']>[0]) {
  for (let t = from; t <= to; t += 60_000) days.recordSite(power, t)
}
const dayOf = (days: EnergyDays, t: number) => days.snapshot(at(30, 12)).days.find((d) => d.t === keyStart(dayKey(t)))

describe('EnergyDays — local measurement', () => {
  it('counts each span at the power of the reading that opened it', () => {
    const days = new EnergyDays(opts)
    // 1 kW of solar, the house takes 400 W, 600 W go to the grid, for half an hour
    feed(days, at(10, 10), at(10, 10, 30), { productionW: 1000, consumptionW: 400, gridW: -600, batteryW: 0 })
    const d = dayOf(days, at(10, 10))!
    expect(d).toMatchObject({ source: 'local', productionWh: 500, consumptionWh: 200, exportWh: 300, solarHomeWh: 200 })
    expect(d.importWh).toBeUndefined()
    expect(d.gridHomeWh).toBeUndefined()
  })

  it('splits the house between the grid, the battery and the sun like the ring does', () => {
    const days = new EnergyDays(opts)
    // night: 1 kW in the house, 300 W from the grid, 700 W out of the battery
    feed(days, at(10, 22), at(10, 23), { productionW: 0, consumptionW: 1000, gridW: 300, batteryW: -700 })
    expect(dayOf(days, at(10, 22))).toMatchObject({ importWh: 300, dischargeWh: 700, batteryHomeWh: 700, gridHomeWh: 300 })
    expect(dayOf(days, at(10, 22))!.solarHomeWh).toBeUndefined()
  })

  it('does not count a gap longer than the allowed one, and a day with a gap is partial', () => {
    const days = new EnergyDays(opts)
    feed(days, at(10, 10), at(10, 10, 6), { productionW: 1000, consumptionW: 0, gridW: -1000, batteryW: 0 })
    days.recordSite({ productionW: 1000 }, at(10, 12)) // two hours without a reading: not counted
    expect(dayOf(days, at(10, 10))).toMatchObject({ partial: true, productionWh: 100 })
    // a day with no span at all is absent, not at zero
    expect(dayOf(days, at(9, 10))).toBeUndefined()
  })

  it('a reading that carries only some fields keeps the others', () => {
    const days = new EnergyDays(opts)
    days.recordSite({ productionW: 0, consumptionW: 600, gridW: 600, batteryW: 0 }, at(10, 20))
    days.recordSite({ batteryW: 0 }, at(10, 20, 1))
    days.recordSite({ batteryW: 0 }, at(10, 20, 2))
    expect(dayOf(days, at(10, 20))).toMatchObject({ importWh: 20, consumptionWh: 20 })
  })

  it('splits a span that crosses midnight between the two days', () => {
    const days = new EnergyDays(opts)
    days.recordSite({ productionW: 0, consumptionW: 600, gridW: 600, batteryW: 0 }, at(10, 23, 59))
    days.recordSite({ productionW: 0 }, at(11, 0, 1))
    expect(dayOf(days, at(10, 23))!.importWh).toBe(10)
    expect(dayOf(days, at(11, 0))!.importWh).toBe(10)
  })

  it('today is partial when the server has not watched it since midnight', () => {
    const days = new EnergyDays(opts)
    feed(days, at(10, 0), at(10, 12), { productionW: 0, consumptionW: 100, gridW: 100, batteryW: 0 })
    expect(days.snapshot(at(10, 12)).days[0]!.partial).toBeUndefined()
    const late = new EnergyDays(opts)
    feed(late, at(10, 11), at(10, 12), { productionW: 0, consumptionW: 100, gridW: 100, batteryW: 0 })
    expect(late.snapshot(at(10, 12)).days[0]!.partial).toBe(true)
  })

  it('a day watched from start to end is not partial', () => {
    const days = new EnergyDays(opts)
    feed(days, at(10, 0), at(11, 0), { productionW: 0, consumptionW: 100, gridW: 100, batteryW: 0 })
    expect(dayOf(days, at(10, 12))!.partial).toBeUndefined()
    expect(dayOf(days, at(10, 12))!.importWh).toBe(2400)
  })

  it("the gateway's day counters win over the integration for production and consumption", () => {
    const days = new EnergyDays(opts)
    feed(days, at(10, 10), at(10, 10, 30), { productionW: 1000, consumptionW: 400, gridW: -600, batteryW: 0 })
    days.recordCounters({ todayProductionWh: 4321, todayConsumptionWh: 1234 }, at(10, 10, 30))
    expect(dayOf(days, at(10, 10))).toMatchObject({ productionWh: 4321, consumptionWh: 1234, exportWh: 300 })
  })

  it('a counter not yet reset after midnight still belongs to yesterday', () => {
    const days = new EnergyDays(opts)
    days.recordCounters({ todayProductionWh: 30_000, todayConsumptionWh: 12_000 }, at(10, 23, 59))
    days.recordCounters({ todayProductionWh: 30_000, todayConsumptionWh: 12_050 }, at(11, 0, 1))
    days.recordCounters({ todayProductionWh: 0, todayConsumptionWh: 40 }, at(11, 0, 2))
    days.recordCounters({ todayProductionWh: 0, todayConsumptionWh: 90 }, at(11, 0, 3))
    expect(dayOf(days, at(10, 12))).toMatchObject({ productionWh: 30_000, consumptionWh: 12_050 })
    expect(dayOf(days, at(11, 12))).toMatchObject({ productionWh: 0, consumptionWh: 90 })
  })

  it("counts what the charger's session grew by, and a new session from zero", () => {
    const days = new EnergyDays(opts)
    days.recordChargerSession('EV1', 1000, at(10, 13)) // first reading: only a starting point
    days.recordChargerSession('EV1', 4000, at(10, 14))
    days.recordChargerSession('EV1', 4000, at(10, 15))
    days.recordChargerSession('EV1', 500, at(11, 9)) // new session
    expect(dayOf(days, at(10, 13))!.evseWh).toBe(3000)
    expect(dayOf(days, at(11, 9))!.evseWh).toBe(500)
  })
})

describe('EnergyDays — vendor history', () => {
  const lifetime = (start: string, production: (number | null)[], extra: Record<string, unknown> = {}) =>
    lifetimeEnergySchema.parse({ start_date: start, production, consumption: production.map((p) => (p === null ? null : p * 2)), ...extra })

  it('reads one day per value from the start date, a null leaves the day out, today stays local', () => {
    const days = new EnergyDays(opts)
    const now = at(4, 12)
    const r = days.importVendor(lifetime('2026-06-01', [1000, null, 3000, 9999]), now)
    expect(r).toEqual({ days: 2, since: '2026-06-01' })
    const snap = days.snapshot(now)
    expect(snap.since).toBe(keyStart('2026-06-01'))
    expect(snap.syncedAt).toBe(now)
    expect(snap.days).toEqual([
      { t: keyStart('2026-06-01'), source: 'vendor', productionWh: 1000, consumptionWh: 2000 },
      { t: keyStart('2026-06-03'), source: 'vendor', productionWh: 3000, consumptionWh: 6000 },
    ])
  })

  it('replaces the local days before the last report, keeps those after it', () => {
    const days = new EnergyDays(opts)
    days.recordCounters({ todayProductionWh: 111 }, at(2, 20))
    days.recordCounters({ todayProductionWh: 333 }, at(3, 20))
    const now = at(4, 1)
    // the cloud last heard from the gateway on the 3rd, at 18:00: the 3rd is not complete there
    days.importVendor(lifetime('2026-06-01', [1000, 2000, 3000], { last_report_date: at(3, 18) / 1000 }), now)
    const snap = days.snapshot(now).days
    expect(snap.find((d) => d.t === keyStart('2026-06-02'))).toMatchObject({ source: 'vendor', productionWh: 2000 })
    expect(snap.find((d) => d.t === keyStart('2026-06-03'))).toMatchObject({ source: 'local', productionWh: 333 })
  })

  it('takes an incomplete vendor day where nothing local exists, marked partial', () => {
    const days = new EnergyDays(opts)
    const now = at(4, 1)
    days.importVendor(lifetime('2026-06-02', [2000, 3000], { last_report_date: at(3, 18) / 1000 }), now)
    expect(days.snapshot(now).days.find((d) => d.t === keyStart('2026-06-03'))).toMatchObject({ source: 'vendor', partial: true })
  })

  it('local readings never overwrite a vendor day', () => {
    const days = new EnergyDays(opts)
    days.importVendor(lifetime('2026-06-01', [1000, 2000]), at(4, 12))
    days.recordCounters({ todayProductionWh: 5 }, at(2, 12))
    expect(days.snapshot(at(4, 12)).days.find((d) => d.t === keyStart('2026-06-02'))).toMatchObject({ source: 'vendor', productionWh: 2000 })
  })

  it('says where each day stands: complete, incomplete or missing', () => {
    const days = new EnergyDays(opts)
    feed(days, at(1, 0), at(2, 0), { productionW: 0, consumptionW: 100, gridW: 100, batteryW: 0 })
    feed(days, at(2, 12), at(2, 13), { productionW: 0, consumptionW: 100, gridW: 100, batteryW: 0 })
    days.importVendor(lifetime('2026-05-30', [1000]), at(4, 12))
    expect(days.dayStatus('2026-05-30', at(4, 12))).toBe('c')
    expect(days.dayStatus('2026-05-31', at(4, 12))).toBe('m')
    expect(days.dayStatus('2026-06-01', at(4, 12))).toBe('c')
    expect(days.dayStatus('2026-06-02', at(4, 12))).toBe('p')
  })

  it('the smart resync leaves a complete day as it is and takes the others', () => {
    const days = new EnergyDays(opts)
    feed(days, at(1, 0), at(2, 0), { productionW: 0, consumptionW: 100, gridW: 100, batteryW: 0 })
    feed(days, at(2, 12), at(2, 13), { productionW: 0, consumptionW: 100, gridW: 100, batteryW: 0 })
    const r = days.importVendor(lifetime('2026-06-01', [1000, 2000, 3000]), at(4, 12), { onlyIncomplete: true })
    expect(r.days).toBe(2)
    const snap = days.snapshot(at(4, 12)).days
    expect(snap.find((d) => d.t === keyStart('2026-06-01'))).toMatchObject({ source: 'local' })
    expect(snap.find((d) => d.t === keyStart('2026-06-02'))).toMatchObject({ source: 'vendor', productionWh: 2000 })
    // forced: every day again
    days.importVendor(lifetime('2026-06-01', [1000, 2000, 3000]), at(4, 12))
    expect(days.snapshot(at(4, 12)).days[0]).toMatchObject({ source: 'vendor', productionWh: 1000 })
  })

  it('maps every series of lifetime_energy', () => {
    const days = new EnergyDays(opts)
    const one = (v: number) => [v]
    days.importVendor(lifetimeEnergySchema.parse({
      start_date: '2026-06-01', production: one(1), consumption: one(2), import: one(3), export: one(4), charge: one(5),
      discharge: one(6), solar_home: one(7), battery_home: one(8), grid_home: one(9), evse: one(10), heatpump: [],
    }), at(2, 12))
    expect(days.snapshot(at(2, 12)).days[0]).toEqual({
      t: keyStart('2026-06-01'), source: 'vendor', productionWh: 1, consumptionWh: 2, importWh: 3, exportWh: 4, chargeWh: 5,
      dischargeWh: 6, solarHomeWh: 7, batteryHomeWh: 8, gridHomeWh: 9, evseWh: 10,
    })
  })
})

describe('EnergyDays — file', () => {
  it('restores what it saved, and refuses an unreadable file', () => {
    const days = new EnergyDays(opts)
    days.importVendor(lifetimeEnergySchema.parse({ start_date: '2026-06-01', production: [1000] }), at(2, 12))
    days.recordCounters({ todayProductionWh: 50 }, at(2, 12))
    const copy = new EnergyDays(opts)
    expect(copy.restore(JSON.parse(JSON.stringify(days)))).toBe(true)
    expect(copy.synced).toBe(true)
    expect(copy.snapshot(at(2, 12))).toEqual(days.snapshot(at(2, 12)))
    expect(new EnergyDays(opts).restore({ version: 2 })).toBe(false)
  })
})
