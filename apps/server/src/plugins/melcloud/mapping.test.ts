import { describe, expect, it } from 'vitest'
import { DEVICE_GET, LIST_DEVICES } from './__fixtures__/melcloud'
import { lastSeenAt, toDescriptors, toDeviceLinks, toStatePatch, toSystem, toZones, unitAvailable } from './mapping'

// Two families of cases, and the difference matters.
//
// `__fixtures__/melcloud.ts` is the CAPTURE of the real account: it is authoritative, and the last
// block of this file replays it as is.
//
// The payloads below, on the other hand, are MADE UP, and deliberately stay out of `__fixtures__/`
// so they are never mistaken for captured data. They serve only one thing the capture cannot prove
// on its own: that the walk finds the devices WITHOUT assuming anything about their path. The real
// house files its own under `Structure.Devices`, but an installation with floors or areas files it
// two levels lower, and nobody here has such an installation at hand to check it.

/** A machine placed directly under the building's structure. */
const AT_ROOT = {
  ID: 1, Name: 'Maison', Structure: {
    Devices: [{ DeviceID: 111, BuildingID: 1, DeviceName: 'Ecodan Nord', Device: { DeviceType: 1 } }],
    Areas: [], Floors: [],
  },
}

/** The same, filed under an area of a floor — two levels lower. */
const IN_FLOOR_AREA = {
  ID: 2, Name: 'Annexe', Structure: {
    Devices: [], Areas: [],
    Floors: [{ ID: 9, Name: 'RDC', Areas: [{ ID: 8, Devices: [{ DeviceID: 222, BuildingID: 2, DeviceName: 'Ecodan Sud', Device: { DeviceType: 1 } }] }], Devices: [] }],
  },
}

describe('MELCloud — inventory', () => {
  it('finds the devices wherever they are filed in the structure', () => {
    const links = toDeviceLinks([AT_ROOT, IN_FLOOR_AREA])
    expect(links.map((l) => l.deviceId)).toEqual(['111', '222'])
    expect(links.map((l) => l.buildingName)).toEqual(['Maison', 'Annexe'])
  })

  it('recognizes an Ecodan as an air-to-water machine', () => {
    const [link] = toDeviceLinks([AT_ROOT])
    expect(link).toMatchObject({ deviceId: '111', buildingId: '1', name: 'Ecodan Nord', family: 'atw', deviceType: 1 })
  })

  it('does not count twice a machine whose sub-object repeats its id', () => {
    const repeated = {
      ID: 3, Name: 'Maison', Structure: {
        Devices: [{ DeviceID: 333, BuildingID: 3, DeviceName: 'Ecodan', Device: { DeviceID: 333, DeviceType: 1 } }],
      },
    }
    expect(toDeviceLinks([repeated]).map((l) => l.deviceId)).toEqual(['333'])
  })

  it('keeps the other machines when one of them has an unexpected shape', () => {
    const mixed = {
      ID: 4, Name: 'Maison', Structure: {
        Devices: [
          { DeviceID: { oops: true }, DeviceName: 'machine illisible' },
          { DeviceID: 444, BuildingID: 4, DeviceName: 'Ecodan Est', Device: { DeviceType: 1 } },
        ],
      },
    }
    expect(toDeviceLinks([mixed]).map((l) => l.deviceId)).toEqual(['444'])
  })

  it('accepts a device type placed at the root rather than in the sub-object', () => {
    const flat = { ID: 5, Name: 'Maison', Structure: { Devices: [{ DeviceID: 555, BuildingID: 5, DeviceType: 1 }] } }
    expect(toDeviceLinks([flat])[0]).toMatchObject({ family: 'atw', name: 'MELCloud 555' })
  })

  it('returns an empty list on an empty or unexpected response, without throwing', () => {
    expect(toDeviceLinks([])).toEqual([])
    expect(toDeviceLinks(null)).toEqual([])
    expect(toDeviceLinks({ unexpected: 'shape' })).toEqual([])
  })
})

describe('MELCloud — the capture of the real account', () => {
  it('finds the single machine of the real installation', () => {
    const links = toDeviceLinks(LIST_DEVICES)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ name: 'Chauffage', family: 'atw', deviceType: 1, buildingName: 'Maison' })
  })

  /**
   * Three physical machines (a cascade of Zubadan behind a single FTC) do NOT show up as three
   * devices: MELCloud only shows one. The mapping must therefore never assume that one device is
   * one machine — this test is here so the assumption does not creep back in the day someone reads
   * "3 heat pumps" somewhere.
   */
  it('sees only one device where there are three machines', () => {
    expect(toDeviceLinks(LIST_DEVICES)).toHaveLength(1)
  })
})

/** Reference instant: two minutes after the capture's last report (18:55 local). */
const NOW = new Date('2026-09-17T18:57:00').getTime()

describe('MELCloud — the two zones, read on the capture', () => {
  const link = toDeviceLinks(LIST_DEVICES)[0]!

  it('reads zone 1 on room temperature and zone 2 on flow water', () => {
    const [z1, z2] = toZones(link.fields)
    expect(z1).toMatchObject({ zone: 1, control: 'room', currentTempC: 23, targetTempC: 19.5, bounds: [0, 40] })
    expect(z2).toMatchObject({ zone: 2, control: 'flow', currentTempC: 20, targetTempC: 45, bounds: [30, 60] })
  })

  /**
   * THE trap of this installation: zone 2 has no room sensor and MELCloud returns -39, not a
   * `null`. A naive read would publish a room at -39 °C all year round.
   */
  it('never publishes the -39 sentinel of the missing sensor', () => {
    const z2 = toZones(link.fields)[1]!
    expect(link.fields.RoomTemperatureZone2).toBe(-39)   // what the vendor sends
    expect(z2.currentTempC).toBe(20)                      // what we publish of it
  })

  it('falls back on the flow if a room-temperature zone’s sensor goes haywire', () => {
    const broken = { ...link.fields, RoomTemperatureZone1: -39 }
    expect(toZones(broken)[0]).toMatchObject({ control: 'flow', currentTempC: 20.5, targetTempC: 60 })
  })

  it('publishes one climate per zone, read-only and without offering cooling', () => {
    const [d1, d2] = toDescriptors(link)
    expect(d1).toMatchObject({ id: 'melcloud:111111-z1', kind: 'climate', name: 'Chauffage', capabilities: ['current_temp'] })
    expect(d2!.id).toBe('melcloud:111111-z2')
    // `CanCool: false`: "Cool" must not appear among the announced modes
    expect(d1!.meta.climate?.modes).not.toContain('cool')
    expect(d1!.meta.climate?.control).toBe('room')
    expect(d2!.meta.climate?.control).toBe('flow')
    expect(d2!.meta.targetTempC).toEqual([30, 60])
  })

  /** On but idle: that is the September state, and `mode` alone could not tell. */
  it('tells "on" from "heating"', () => {
    const zones = toZones(link.fields)
    for (const z of zones) {
      expect(toStatePatch(link.fields, z, NOW)).toMatchObject({ available: true, mode: 'heat', action: 'idle' })
    }
  })

  it('turns the zones off when the machine is off', () => {
    const off = { ...link.fields, Power: false }
    expect(toStatePatch(off, toZones(off)[0]!, NOW)).toMatchObject({ mode: 'off', action: 'off' })
  })
})

describe('MELCloud — the machine’s state', () => {
  const link = toDeviceLinks(LIST_DEVICES)[0]!

  it('sums up what the Heating view needs to show', () => {
    expect(toSystem(link, NOW)).toMatchObject({
      name: 'Chauffage', power: true, offline: false,
      outdoorTempC: 22, flowTempC: 20.5, returnTempC: 20.5, condensingTempC: 40.57, demandPercent: 100,
      defrosting: false, boosterHeater: false, immersionHeater: false, valve3Way: false,
      pumps: [false, false, false, false],
    })
  })

  /** `ErrorCode` IS 8000 at rest: reading it as a boolean would put the house in failure for life. */
  it('does not take error code 8000 for a failure', () => {
    const s = toSystem(link, NOW)
    expect(s.error.code).toBe(8000)
    expect(s.error.hasError).toBe(false)
  })

  /** Without a meter, the view must be able to OMIT the consumption rather than show zeros. */
  it('says this machine has no energy meter', () => {
    expect(toSystem(link, NOW).energyMeter).toBe(false)
  })
})

describe('MELCloud — the fields that are not where you think', () => {
  /**
   * `LastCommunication` ONLY exists in `Device/Get`. Polling reads `ListDevices`, which carries
   * `LastTimeStamp`: reading the former on the latter gave a permanently null field, without the
   * slightest error to signal it. Exactly the kind of trap only a capture reveals.
   */
  it('dates the last report with the field ListDevices REALLY carries', () => {
    const link = toDeviceLinks(LIST_DEVICES)[0]!
    expect(link.fields.LastCommunication).toBeUndefined()
    expect(toSystem(link, NOW).lastSeen).toBe(new Date('2026-09-17T18:55:00').getTime())
    expect(toSystem(link, NOW).wifi).toBe('NORMAL')
  })

  it('can still read a machine coming from the detailed read', () => {
    const link = toDeviceLinks(LIST_DEVICES)[0]!
    const fromDetail = { ...link, fields: { ...DEVICE_GET } }
    // and that route's UTC is brought back to the same instant, not shifted by the time zone
    expect(toSystem(fromDetail, NOW).lastSeen).toBe(Date.parse('2026-09-17T16:55:49.844Z'))
  })
})

describe('MELCloud — reachable or not: the vendor’s flag lies', () => {
  const link = toDeviceLinks(LIST_DEVICES)[0]!
  const seen = new Date('2026-09-17T18:55:00').getTime()

  /**
   * Observed on the REAL machine: `Offline: true` while the timestamp moved forward every minute,
   * the next report was announced in sixty seconds, the Wi-Fi module said `NORMAL` and no error was
   * reported. Trusting it greyed out the house's two zones, fresh data notwithstanding. This is the
   * bug this test keeps from coming back.
   */
  it('stays reachable when MELCloud says it is offline but still talks', () => {
    const lying = { ...link.fields, Offline: true }
    expect(unitAvailable(lying, seen + 60_000)).toBe(true)
    expect(toStatePatch(lying, toZones(lying)[0]!, seen + 60_000).available).toBe(true)
  })

  it('becomes unreachable when the machine really goes silent', () => {
    expect(unitAvailable(link.fields, seen + 60 * 60_000)).toBe(false)
    expect(toSystem(link, seen + 60 * 60_000).stale).toBe(true)
  })

  /** Without any timestamp, only the vendor's word remains: we take it for want of anything better. */
  it('falls back on the vendor’s flag when no date is given', () => {
    const { LastTimeStamp: _a, LastCommunication: _b, ...mute } = link.fields
    expect(unitAvailable({ ...mute, Offline: false }, seen)).toBe(true)
    expect(unitAvailable({ ...mute, Offline: true }, seen)).toBe(false)
  })

  /** The two routes do not write their time in the same base: 17:58 UTC IS 19:58 local. */
  it('brings the vendor’s two timestamps back to the same instant', () => {
    expect(lastSeenAt({ LastTimeStamp: '2026-09-17T19:58:00' }))
      .toBe(new Date('2026-09-17T19:58:00').getTime())
    expect(lastSeenAt({ LastCommunication: '2026-09-17T17:58:00.522' }))
      .toBe(Date.parse('2026-09-17T17:58:00.522Z'))
  })
})
