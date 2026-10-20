import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_ID, BATTERY_CHARGING, CONTRACTS, BATTERY_CHARGING_LIAR, BATTERY_UNPLUGGED, BATTERY_WAITING, BATTERY_WAITING_FRESH_ETA, COCKPIT_V1, COCKPIT_V2_EASTER_EGG,
  EV_SETTINGS, HVAC_STATUS, LOCATION, PERSON, SOC_LEVELS, VEHICLES, VIN,
} from './__fixtures__/kamereon'
import { chargeStartPayload, commandSummary, inWindow, socTargetPayload, toAccounts, toDescriptor, toStatePatch, toMileageContracts, toVehicleLinks, vehicleName, wakePayload, CLIMATE_FEATURES, climateSettingsPayload, hvacStartPayload, hvacSocThreshold, levelRising, trackLevel, type LevelTrack } from './mapping'

// This whole file works on the CAPTURE of 2026-09-14, not on the documentation. Three pitfalls that
// only the capture reveals are tested by name: the prankster `cockpit` v2, the float of
// `chargingStatus`, and the fact that no missing value must become a zero.

const NOW = Date.UTC(2026, 8, 14, 10, 30)

describe('accounts and vehicles', () => {
  it('keeps the connected services account, not the CRM record', () => {
    const accounts = toAccounts(PERSON)
    expect(accounts).toHaveLength(2)
    // choosing MYRENAULT happens in the plugin; here we check that both come through
    expect(accounts.map((a) => a.accountType)).toEqual(['MYRENAULT', 'SFDC'])
    expect(accounts[0]!.accountId).toBe(ACCOUNT_ID)
  })

  it('publishes one device per VIN, named by its plate', () => {
    const links = toVehicleLinks(VEHICLES)
    expect(links).toHaveLength(1)
    const d = toDescriptor(links[0]!)
    expect(d).toMatchObject({ id: `renault:${VIN}`, externalId: VIN, kind: 'vehicle', name: 'AA123BB' })
    // the charge target and the climate: nothing else, the UI grays out the rest
    expect(d.capabilities).toEqual(['soc', 'range', 'location', 'charge_limit', 'charging', 'climate_precondition'])
    expect(d.meta.vehicle?.stopViaCharger).toBe(true)
    expect(d.meta.vehicle?.climate).toEqual(CLIMATE_FEATURES)
  })

  it('reads the paint color from the configuration reference, and never guesses', () => {
    const links = toVehicleLinks(VEHICLES)
    expect(toDescriptor(links[0]!).meta.vehicle?.color).toBe('#14171a')       // TEGNE = Noir Étoilé

    // A paint code that no real car has confirmed publishes NOTHING: the scene falls back on its
    // theme color, and the user decides. Better nothing than an invented color.
    const inconnu = { vin: VIN, vehicleDetails: { assets: [{ assetType: 'PICTURE', renditions: [{ url: 'https://3dv.renault.com/x?configuration=PAVEH%2FTEZZZ%2FMET05' }] }] } }
    expect(toDescriptor(inconnu).meta.vehicle?.color).toBeUndefined()

    // Services contract expired: no `vehicleDetails`, no images, no color — and above all no crash.
    expect(toDescriptor({ vin: VIN }).meta.vehicle?.color).toBeUndefined()
  })

  it('falls back on the model then the VIN when the plate is missing', () => {
    expect(vehicleName({ vin: VIN, vehicleDetails: { brand: { label: 'RENAULT' }, model: { label: 'RENAULT 5' } } }))
      .toBe('RENAULT RENAULT 5')
    expect(vehicleName({ vin: VIN })).toBe(VIN)
  })

  it('ignores an unreadable vehicle without losing the others', () => {
    const links = toVehicleLinks({ vehicleLinks: [{ pasDeVin: true }, VEHICLES.vehicleLinks[0]] })
    expect(links).toHaveLength(1)
    expect(links[0]!.vin).toBe(VIN)
  })
})

describe('climate', () => {
  it('reads setpoint, front seats and steering wheel from the preconditioning settings', () => {
    const patch = toStatePatch({ settings: { ...EV_SETTINGS, preconditioningHeatedLeftSeat: true } }, NOW)
    expect(patch).toMatchObject({ climateTargetC: 21, seatHeat: { fl: 1, fr: 0 }, steeringWheelHeat: false })
  })

  it('rewrites the settings AS THEY ARE, only the named fields change', () => {
    const body = climateSettingsPayload(EV_SETTINGS, { type: 'vehicle.climate_set', seatHeat: { fr: 1 }, steeringWheelHeat: true }, NOW)!
    expect(body).toMatchObject({ preconditioningHeatedRightSeat: true, preconditioningHeatedStrgWheel: true, preconditioningHeatedLeftSeat: false, preconditioningTemperature: 21 })
    expect(body.programs).toEqual(EV_SETTINGS.programs)
    expect(body.chargeTimeStart).toBe(EV_SETTINGS.chargeTimeStart)
    expect(body.lastSettingsUpdateTimestamp).not.toBe(EV_SETTINGS.lastSettingsUpdateTimestamp)
  })

  it('the hvac-start body: the setpoint on start, nothing on cancel', () => {
    expect(hvacStartPayload('start', 20)).toEqual({ data: { type: 'HvacStart', attributes: { action: 'start', targetTemperature: 20 } } })
    expect(hvacStartPayload('cancel')).toEqual({ data: { type: 'HvacStart', attributes: { action: 'cancel' } } })
    expect(hvacSocThreshold(HVAC_STATUS)).toBe(15)
  })
})

describe('readings → state', () => {
  it('maps a full round', () => {
    const patch = toStatePatch(
      { battery: BATTERY_WAITING, cockpit: COCKPIT_V1, location: LOCATION, hvac: HVAC_STATUS, socLevels: SOC_LEVELS },
      NOW,
    )
    expect(patch).toEqual({
      // the time the CAR spoke, not the time of our call
      readAt: Date.parse('2026-09-14T08:19:43Z'),
      soc: 58,
      rangeKm: 218,
      pluggedIn: true,
      charging: false,
      odometerKm: 12500,
      location: { lat: 47.32, lon: 5.04, at: Date.parse('2026-09-14T08:18:31Z') },
      insideTempC: 37,
      climateOn: false,
      chargeLimit: 80,
      socMin: 20,
      // the car is not charging: the remaining time it has carried since two days before is CLEARED
      chargeMinutesRemaining: null,
    })
  })

  it('plugged in but WAITING is not "charging" (chargingStatus 0.3)', () => {
    const patch = toStatePatch({ battery: BATTERY_WAITING }, NOW)
    expect(patch.pluggedIn).toBe(true)
    expect(patch.charging).toBe(false)
  })

  it('recognizes a charge in progress (chargingStatus 1.0, and only that)', () => {
    expect(toStatePatch({ battery: BATTERY_CHARGING }, NOW).charging).toBe(true)
    expect(toStatePatch({ battery: BATTERY_UNPLUGGED }, NOW)).toMatchObject({ pluggedIn: false, charging: false })
  })

  /**
   * On 2026-09-19, the car served a `0.3` ("waiting for current") for hours while it was drawing
   * 5.5 kW. Two fields of the SAME frame contradicted it — hence the second-witness rule. Without
   * it, the UI lies and the charge wake-up shakes a car that is already charging.
   */
  it('unmasks a lying `chargingStatus` thanks to the remaining time dated from the frame AND the rising level', () => {
    const patch = toStatePatch({ battery: BATTERY_CHARGING_LIAR }, NOW, { levelRising: true })
    expect(patch.charging).toBe(true)
    expect(patch.chargeMinutesRemaining).toBe(52)

    // the same body, but the remaining time LINGERS from a previous frame: we don't cry wolf
    const attrs = { ...BATTERY_CHARGING_LIAR.data.attributes, chargingRemainingTimeLastUpdateDateTime: '2026-09-17T14:45:35Z' }
    const stale = toStatePatch({ battery: { data: { id: 'VF1', attributes: attrs } } }, NOW, { levelRising: true })
    expect(stale.charging).toBe(false)
    expect(stale.chargeMinutesRemaining).toBeNull()
  })

  /**
   * On 2026-10-02, the R5 was really waiting for current (green charging, no sun, 0 W at the
   * charger) with a remaining time dated from the frame: the second witness alone said it was
   * charging. What sets it apart from the liar of 09/19 is the level that doesn't rise.
   */
  it('`0.3` and a fresh remaining time, level not rising: WAITING, not charging', () => {
    const patch = toStatePatch({ battery: BATTERY_WAITING_FRESH_ETA }, NOW)
    expect(patch).toMatchObject({ pluggedIn: true, charging: false, chargeMinutesRemaining: null })
    expect(toStatePatch({ battery: BATTERY_CHARGING_LIAR }, NOW).charging).toBe(false)
    // the plain yes needs no witness
    expect(toStatePatch({ battery: BATTERY_CHARGING }, NOW).charging).toBe(true)
  })

  describe('the rising level (`trackLevel`)', () => {
    const MIN = 60_000
    const T = Date.parse('2026-10-02T12:00:07Z')
    const run = (frames: [number, number][]) => {
      let track: LevelTrack | undefined
      return frames.map(([at, soc]) => levelRising(track = trackLevel(track, at, soc)))
    }

    it('a rise between two close frames, and as long as the next one falls within the hour', () => {
      expect(run([[T, 63], [T + 10 * MIN, 64], [T + 25 * MIN, 64], [T + 50 * MIN, 65]])).toEqual([false, true, true, true])
    })
    it('not a rise spread over more than an hour (the 51 → 52 % of 2026-10-02, 11:44 → 14:00)', () => {
      expect(run([[T - 136 * MIN, 51], [T, 52]])).toEqual([false, false])
    })
    it('drops back an hour after the last rise; the same frame re-read keeps its verdict', () => {
      expect(run([[T, 60], [T + 10 * MIN, 61], [T + 10 * MIN, 61], [T + 75 * MIN, 61]])).toEqual([false, true, true, false])
    })
    it('a falling level is not a charge', () => {
      expect(run([[T, 60], [T + 10 * MIN, 59]])).toEqual([false, false])
    })
  })

  it('keeps the remaining charge time ONLY while charging', () => {
    expect(toStatePatch({ battery: BATTERY_CHARGING }, NOW).chargeMinutesRemaining).toBe(43)
    expect(toStatePatch({ battery: BATTERY_UNPLUGGED }, NOW).chargeMinutesRemaining).toBeNull()
  })

  it('survives the prankster cockpit v2: no mileage rather than a zero', () => {
    const patch = toStatePatch({ battery: BATTERY_WAITING, cockpit: COCKPIT_V2_EASTER_EGG }, NOW)
    expect(patch.odometerKm).toBeUndefined()
    expect(patch.soc).toBe(58)                    // the rest of the round doesn't suffer from it
  })

  it('dates the state from the CAR, not from our call — and falls back on ours without battery', () => {
    // Kamereon returns the last state reported: on a sleeping car, it's hours old. Dating it from
    // the moment of the call would make the UI say "read 4 min ago" about midday figures.
    expect(toStatePatch({ battery: BATTERY_WAITING }, NOW).readAt).toBe(Date.parse('2026-09-14T08:19:43Z'))
    expect(toStatePatch({}, NOW).readAt).toBe(NOW)
  })

  it('never invents a zero when a reading is missing', () => {
    const patch = toStatePatch({}, NOW)
    expect(patch).toEqual({ readAt: NOW })
    for (const k of ['soc', 'rangeKm', 'pluggedIn', 'charging', 'odometerKm', 'location', 'insideTempC', 'chargeLimit']) {
      expect(patch).not.toHaveProperty(k)
    }
  })

  it('publishes nothing the R5 does not give', () => {
    const patch = toStatePatch(
      { battery: BATTERY_WAITING, cockpit: COCKPIT_V1, location: LOCATION, hvac: HVAC_STATUS, socLevels: SOC_LEVELS },
      NOW,
    )
    for (const k of ['locked', 'chargePowerW', 'headingDeg', 'tirePressureBar', 'speedKmh', 'gear', 'outsideTempC', 'sleepState']) {
      expect(patch).not.toHaveProperty(k)
    }
  })

  it('dates the position from the reading when Renault does not date it', () => {
    const patch = toStatePatch({ location: { data: { attributes: { gpsLatitude: 47.32, gpsLongitude: 5.04 } } } }, NOW)
    expect(patch.location).toEqual({ lat: 47.32, lon: 5.04, at: NOW })
  })
})

describe('charge target', () => {
  it('changes ONLY the target: the floor is the user setting', () => {
    const body = socTargetPayload(SOC_LEVELS, 70, NOW)!
    expect(body.socTarget).toBe(70)
    expect(body.socMin).toBe(SOC_LEVELS.socMin)
    expect(body.lastEnergyUpdateTimestamp).toBe(new Date(NOW).toISOString())
  })

  it('invents nothing when the levels are not an object', () => {
    expect(socTargetPayload(null, 70, NOW)).toBeNull()
    expect(socTargetPayload([80], 70, NOW)).toBeNull()
  })
})

describe('starting the charge', () => {
  it('disables the ACTIVE charge programs, keeps everything else, new timestamp', () => {
    const active = { ...EV_SETTINGS, programs: [{ ...EV_SETTINGS.programs[0]!, programActivationStatus: true }, { ...EV_SETTINGS.programs[0]!, programDepartureTime: '07:00:00' }] }
    const { body, deactivated } = chargeStartPayload(active, NOW)!
    expect(deactivated).toBe(1)
    const programs = body.programs as { programActivationStatus: boolean; programDepartureTime: string }[]
    expect(programs.map((p) => p.programActivationStatus)).toEqual([false, false])
    expect(programs.map((p) => p.programDepartureTime)).toEqual(['20:00:00', '07:00:00'])
    expect(body).toMatchObject({ chargeTimeStart: '12:00', chargeDuration: 420, chargeModeRq: 'SCHEDULED', preconditioningTemperature: 21 })
    expect(body.lastSettingsUpdateTimestamp).toBe(new Date(NOW).toISOString())
  })

  it('no active program: nothing disabled, the settings replayed as is', () => {
    const { body, deactivated } = chargeStartPayload(EV_SETTINGS, NOW)!
    expect(deactivated).toBe(0)
    expect(body.programs).toEqual(EV_SETTINGS.programs)
    expect(chargeStartPayload(null, NOW)).toBeNull()
  })
})

describe('charge wake-up', () => {
  it('replays the car settings IDENTICALLY, new timestamp', () => {
    const body = wakePayload(EV_SETTINGS, NOW)!
    // everything is kept: the start time, duration and temperature are the user's CHOICES, made
    // in their car — overwriting them would be the hidden cost of the wake-up
    expect(body.chargeTimeStart).toBe('12:00')
    expect(body.chargeDuration).toBe(420)
    expect(body.preconditioningTemperature).toBe(21)
    expect(body.chargeModeRq).toBe('SCHEDULED')
    expect(body.programs).toEqual(EV_SETTINGS.programs)
    // only the timestamp changes: it's the WRITE that wakes, not its content
    expect(body.lastSettingsUpdateTimestamp).toBe(new Date(NOW).toISOString())
    expect(body.lastSettingsUpdateTimestamp).not.toBe(EV_SETTINGS.lastSettingsUpdateTimestamp)
  })

  it('invents nothing when the settings are not an object', () => {
    expect(wakePayload(null, NOW)).toBeNull()
    expect(wakePayload('nope', NOW)).toBeNull()
    expect(wakePayload([1, 2], NOW)).toBeNull()
  })

  it('summarizes the COMMAND returned by Renault, and throws nothing on anything else', () => {
    // real response of 2026-09-19: it's not a save, it's a filed command
    expect(commandSummary({ commandId: 'abc', type: 'HVAC_CHARGE_SYNCH', status: 'CREATED' }))
      .toBe('HVAC_CHARGE_SYNCH CREATED abc')
    expect(commandSummary({ status: 'CREATED' })).toBe('CREATED')
    expect(commandSummary({})).toBeNull()
    expect(commandSummary(null)).toBeNull()
    expect(commandSummary('nope')).toBeNull()
  })

  it('the time window confines the wake-up to daytime', () => {
    const at = (h: number, m = 0) => new Date(2026, 8, 14, h, m)
    expect(inWindow(at(12), '08:00', '20:00')).toBe(true)
    expect(inWindow(at(8), '08:00', '20:00')).toBe(true)      // lower bound included
    expect(inWindow(at(20), '08:00', '20:00')).toBe(false)    // upper bound excluded
    expect(inWindow(at(3), '08:00', '20:00')).toBe(false)
    // a window straddling midnight reads on both sides
    expect(inWindow(at(23), '22:00', '06:00')).toBe(true)
    expect(inWindow(at(2), '22:00', '06:00')).toBe(true)
    expect(inWindow(at(12), '22:00', '06:00')).toBe(false)
    // equal or unreadable bounds = never: it's the way to turn the feature off
    expect(inWindow(at(12), '08:00', '08:00')).toBe(false)
    expect(inWindow(at(12), 'midi', '20:00')).toBe(false)
  })
})

describe('contracts', () => {
  it('keeps only maintenance capped in km, not the battery warranty', () => {
    expect(toMileageContracts(CONTRACTS)).toEqual([
      { description: 'EASYPACK 49MOIS EXEMPLE', start: '2025-03-01', end: '2029-03-31', maxKm: 40000 },
    ])
  })

  it('returns an empty list for an unreadable response', () => {
    expect(toMileageContracts({ errors: [] })).toEqual([])
    expect(toMileageContracts([{ type: 'WARRANTY_MAINTENANCE_CONTRACTS', conditions: [{ unlimitedMileage: true }] }])).toEqual([])
  })
})
