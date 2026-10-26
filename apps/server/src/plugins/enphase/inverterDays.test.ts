import { describe, expect, it } from 'vitest'
import { InverterDays, arrayLayoutSchema, deviceDataSchema, peaksOfTimeSeries } from './inverterDays'
import { keyStart } from './days'

// Local times built with the Date constructor: the tests hold in any time zone.
const at = (d: number, h: number, m = 0) => new Date(2026, 5, d, h, m).getTime()

/** `/ivp/pdm/device_data`, shape of the real gateway (D8.3), invented serials and values. */
const deviceData = (a: { today: number; joules: number }, b: { today: number; joules: number }) => deviceDataSchema.parse({
  '1001': { devName: 'pcu', sn: '100000000001', active: true, channels: [{ wattHours: { today: a.today, yesterday: 0, week: 0 }, watts: { now: 0 }, lifetime: { createdTime: 1, duration: 1, joulesProduced: a.joules } }] },
  '1002': { devName: 'pcu', sn: '100000000002', active: true, channels: [{ wattHours: { today: b.today, yesterday: 0, week: 0 }, watts: { now: 0 }, lifetime: { createdTime: 1, duration: 1, joulesProduced: b.joules } }] },
  '1003': { devName: 'eim', sn: '100000000003EIM1', active: true, channels: [{}] },
  deviceCount: 3,
})

describe('InverterDays', () => {
  it('reads the micro-inverters of device_data only, the lifetime counter turned from joules into Wh', () => {
    const r = deviceData({ today: 100, joules: 3_600_000 }, { today: 200, joules: 7_200_000 })
    expect(r).toEqual([
      { serial: '100000000001', todayWh: 100, lifetimeWh: 1000 },
      { serial: '100000000002', todayWh: 200, lifetimeWh: 2000 },
    ])
  })

  it("each inverter's day is its day counter; a counter not yet reset after midnight is yesterday's", () => {
    const inv = new InverterDays()
    inv.recordGateway(deviceData({ today: 1500, joules: 0 }, { today: 1400, joules: 0 }), at(10, 23, 55))
    inv.recordGateway(deviceData({ today: 1500, joules: 0 }, { today: 1400, joules: 0 }), at(11, 0, 5))
    inv.recordGateway(deviceData({ today: 0, joules: 0 }, { today: 0, joules: 0 }), at(11, 0, 10))
    inv.recordGateway(deviceData({ today: 40, joules: 0 }, { today: 30, joules: 0 }), at(11, 9))
    const snap = inv.snapshot(at(11, 12))!
    expect(snap.from).toBe(keyStart('2026-06-10'))
    expect(snap.devices).toEqual([
      { externalId: '100000000001', lifetimeWh: 0, wh: [1500, 40] },
      { externalId: '100000000002', lifetimeWh: 0, wh: [1400, 30] },
    ])
  })

  it('takes a vendor day through the id ↔ serial map, never today, and yesterday only where nothing local exists', () => {
    const inv = new InverterDays()
    const serialOf = arrayLayoutSchema.parse({ system_id: 1, arrays: [{ modules: [
      { module_id: 1, inverter: { inverter_id: 900000001, serial_num: '100000000001' } },
      { module_id: 2, inverter: { inverter_id: 900000002, serial_num: '100000000002' } },
    ] }] })
    const now = at(12, 10)
    expect(inv.importVendorDay('2026-06-08', { 900000001: 300, 900000002: 410 }, serialOf, now)).toBe(true)
    expect(inv.importVendorDay('2026-06-12', { 900000001: 1 }, serialOf, now)).toBe(false)
    inv.recordGateway(deviceData({ today: 999, joules: 0 }, { today: 888, joules: 0 }), at(11, 20))
    expect(inv.importVendorDay('2026-06-11', { 900000001: 1, 900000002: 2 }, serialOf, now)).toBe(false)
    expect(inv.dayStatus('2026-06-08')).toBe('c')
    expect(inv.dayStatus('2026-06-09')).toBe('m')
    const snap = inv.snapshot(now)!
    expect(snap.devices[0]!.wh).toEqual([300, null, null, 999, null])
    expect(snap.devices[1]!.wh).toEqual([410, null, null, 888, null])
  })

  it('a local day is complete only when the gateway was read near its end', () => {
    const inv = new InverterDays()
    inv.recordGateway(deviceData({ today: 900, joules: 0 }, { today: 800, joules: 0 }), at(10, 23, 50))
    inv.recordGateway(deviceData({ today: 400, joules: 0 }, { today: 300, joules: 0 }), at(11, 15))
    expect(inv.dayStatus('2026-06-10')).toBe('c')
    expect(inv.dayStatus('2026-06-11')).toBe('p')
    // a counter read just after midnight, not yet reset, completes the day before
    const late = new InverterDays()
    late.recordGateway(deviceData({ today: 500, joules: 0 }, { today: 400, joules: 0 }), at(10, 20))
    expect(late.dayStatus('2026-06-10')).toBe('p')
    late.recordGateway(deviceData({ today: 600, joules: 0 }, { today: 500, joules: 0 }), at(11, 0, 5))
    expect(late.dayStatus('2026-06-10')).toBe('c')
  })

  it('restores what it saved', () => {
    const inv = new InverterDays()
    inv.recordGateway(deviceData({ today: 10, joules: 36_000 }, { today: 20, joules: 72_000 }), at(10, 12))
    inv.markSynced(at(10, 12))
    const copy = new InverterDays()
    expect(copy.restore(JSON.parse(JSON.stringify(inv)))).toBe(true)
    expect(copy.synced).toBe(true)
    expect(copy.snapshot(at(10, 13))).toEqual(inv.snapshot(at(10, 13)))
  })
})

describe('InverterDays — a day Enphase has nothing for', () => {
  const serialOf = new Map([['900000001', '100000000001']])
  it('is remembered as known empty, not asked again — except yesterday, which the cloud may not have yet', () => {
    const inv = new InverterDays()
    const now = at(12, 10)
    expect(inv.importVendorDay('2026-06-05', {}, serialOf, now)).toBe(false)
    expect(inv.importVendorDay('2026-06-06', { 900000001: null }, serialOf, now)).toBe(false)
    expect(inv.importVendorDay('2026-06-11', {}, serialOf, now)).toBe(false)
    expect(inv.dayStatus('2026-06-05')).toBe('e')
    expect(inv.dayStatus('2026-06-06')).toBe('e')
    expect(inv.dayStatus('2026-06-11')).toBe('m')
    // a later answer with values replaces it
    expect(inv.importVendorDay('2026-06-05', { 900000001: 50 }, serialOf, now)).toBe(true)
    expect(inv.dayStatus('2026-06-05')).toBe('c')
  })
})

describe('InverterDays — peaks of the day', () => {
  const serialOf = new Map([['900000001', '100000000001'], ['900000002', '100000000002']])
  /** `inverter_data_x/time_series.json` over a range, shape of the real answer, invented values. */
  const series = peaksOfTimeSeries({
    '2026-06-10': {
      900000001: { POWR: [[1781071200, 0, 900], [1781074800, 312.4, 900], [1781078400, 250.1, 900]] },
      900000002: { POWR: [[1781071200, 0, 900], [1781074800, 298.6, 900]] },
    },
    '2026-06-11': { 900000001: { POWR: [] } },
    haiku: 'not a day',
  })

  it('keeps the highest quarter hour of each inverter, day by day, and skips what is not a day', () => {
    expect([...series.keys()]).toEqual(['2026-06-10', '2026-06-11'])
    expect(series.get('2026-06-10')).toEqual({ 900000001: 312.4, 900000002: 298.6 })
    expect(series.get('2026-06-11')).toEqual({})
  })

  it('serves them by serial alongside the Wh, and only asks again for the days that have none', () => {
    const inv = new InverterDays()
    const now = at(12, 10)
    inv.importVendorDay('2026-06-10', { 900000001: 1800, 900000002: 1700 }, serialOf, now)
    expect(inv.snapshot(now)!.devices[0]).not.toHaveProperty('peakW')   // no peak kept yet: the payload is unchanged
    inv.importVendorPeaks('2026-06-10', series.get('2026-06-10')!, serialOf, now)
    inv.importVendorPeaks('2026-06-12', { 900000001: 140 }, serialOf, now)   // today, so far
    const snap = inv.snapshot(now)!
    expect(snap.devices[0]!.peakW).toEqual([312, null, 140])
    expect(snap.devices[1]!.peakW).toEqual([299, null, null])
    expect(inv.peaklessDays('2026-06-09', '2026-06-11')).toEqual(['2026-06-09', '2026-06-11'])
    // the record is the best day of the whole history; an inverter never seen has none
    expect(inv.recordOf('100000000001')).toBe(312)
    expect(inv.recordOf('100000000002')).toBe(299)
    expect(inv.recordOf('100000000009')).toBeUndefined()
  })

  it('an empty day is known empty before yesterday only: the cloud may not have the recent days yet', () => {
    const inv = new InverterDays()
    const now = at(12, 10)
    inv.importVendorPeaks('2026-06-05', {}, serialOf, now)
    inv.importVendorPeaks('2026-06-11', {}, serialOf, now)
    expect(inv.peaklessDays('2026-06-05', '2026-06-11')).toEqual(['2026-06-06', '2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11'])
  })

  it('restores a file written before peaks were kept', () => {
    const inv = new InverterDays()
    expect(inv.restore({ version: 1, syncedAt: null, days: {}, lifetimeWh: {} })).toBe(true)
    expect(inv.peaklessDays('2026-06-10', '2026-06-10')).toEqual(['2026-06-10'])
  })
})
