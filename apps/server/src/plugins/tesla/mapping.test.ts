import { describe, expect, it } from 'vitest'
import { defaultState, deviceDescriptorSchema, deviceStateSchema, mergeState, releaseNotesLang, stateKeys, type StateFor } from '@kasbah/shared'
import { RELEASE_NOTES_INSTALLED, VEHICLES_ASLEEP, VEHICLES_ONLINE, VEHICLE_DATA_CHARGING, VEHICLE_DATA_DRIVING, VEHICLE_DATA_PARKED } from './__fixtures__/fleet'
import {
  bodyColor, CLIMATE_FEATURES, bodyFinish, compareVersions, isResting, modelFromVin, notesByVersion, parseReleaseNotes, toDataPatch,
  toDescriptor, toSleepPatch, toSleepState, urlExpiresAt, withoutExpiredImages,
} from './mapping'
import { releaseNotesResponseSchema, vehicleDataSchema, vehicleSummarySchema, vehiclesListSchema } from './types'

// Fleet API mapping, tested on a response CAPTURED on the real account (2017 Model S, MCU2): see
// the header of `__fixtures__/fleet.ts`.

const MILE = 1.609344
const summary = vehicleSummarySchema.parse(vehiclesListSchema.parse(VEHICLES_ASLEEP).response[0])
const parked = vehicleDataSchema.parse(VEHICLE_DATA_PARKED).response
const driving = vehicleDataSchema.parse(VEHICLE_DATA_DRIVING).response
const charging = vehicleDataSchema.parse(VEHICLE_DATA_CHARGING).response

/** A patch is only good if the registry accepts it: the kind's keys, then a valid full state. */
function accepted(patch: ReturnType<typeof toDataPatch>) {
  for (const k of Object.keys(patch)) expect(stateKeys('vehicle').has(k), `clé ${k}`).toBe(true)
  const merged = mergeState(defaultState('vehicle') as StateFor<'vehicle'>, patch, 1)
  expect(deviceStateSchema.safeParse(merged).success).toBe(true)
  return merged
}

describe('descriptor', () => {
  it('one vehicle = one `vehicle` device identified by its VIN, named as in the Tesla app', () => {
    const d = toDescriptor(summary)
    expect(deviceDescriptorSchema.safeParse(d).success).toBe(true)
    expect(d).toMatchObject({ id: 'tesla:5YJSA7E20HF000001', externalId: '5YJSA7E20HF000001', kind: 'vehicle', name: 'Kasbah S' })
    // climate is declared up front: the shared UI grays out what isn't there
    expect(d.meta).toEqual({ manufacturer: 'Tesla', model: 'Model S', vehicle: { climate: CLIMATE_FEATURES } })
    // phase 1: read-only — neither `lock` nor `charging`, so the UI doesn't have to offer those buttons.
    // `charge_power` is not a command: it says the car GIVES its charging power, and spares the UI
    // from estimating it (hence from asking for the battery capacity).
    // `release_notes` is read, `software_update` is written (scheduling an update's installation)
    expect(d.capabilities).toEqual(['soc', 'range', 'location', 'charge_power', 'release_notes', 'charge_limit', 'charging', 'climate_precondition', 'software_update'])
  })

  it('the model line is read from the 4th VIN character, and serves as the fallback name', () => {
    expect(modelFromVin('5YJ3E1EA1JF000001')).toBe('Model 3')
    expect(modelFromVin('7SAYGDEE0PF000001')).toBe('Model Y')
    expect(modelFromVin('XXXQ0000000000000')).toBeUndefined()
    expect(toDescriptor({ ...summary, display_name: '  ' }).name).toBe('Model S')
    expect(toDescriptor({ ...summary, display_name: null, vin: 'XXXQ0000000000000' }).name).toBe('Tesla')
  })
})

describe('sleep state', () => {
  it('the list gives the sleep state without waking: `asleep` is a state, not unavailability', () => {
    expect(toSleepPatch(summary)).toEqual({ sleepState: 'asleep' })
    expect(toSleepPatch(vehiclesListSchema.parse(VEHICLES_ONLINE).response[0] as { state: string })).toEqual({ sleepState: 'online' })
  })
  it('a value unknown from the vendor ("waking") is read as awake rather than rejecting the list', () => {
    expect(toSleepState('waking')).toBe('online')
    expect(toSleepState(undefined)).toBe('online')
    expect(toSleepState('offline')).toBe('offline')
  })
})

describe('body color (`vehicle_config`)', () => {
  it('the color chosen IN the car wins over the factory paint', () => {
    // Real reading of 2026-09-15: PearlWhite from the factory, but the dashboard screen shows a
    // blue the owner chose. That's the one they have in mind, hence the one we paint.
    expect(bodyColor(parked)).toBe('#285ac8')

    // Without an override, the factory paint name, approximated by the table.
    expect(bodyColor({ vehicle_config: { exterior_color: 'SteelGrey' } })).toBe('#5c6063')
    expect(bodyColor({ vehicle_config: { exterior_color: 'pearlwhite' } })).toBe('#f2f3f5')

    // A name outside the table, an unreadable override, or no section at all: nothing. The scene
    // keeps its theme color and the user decides — never an invented color.
    expect(bodyColor({ vehicle_config: { exterior_color: 'ChartreuseSparkle' } })).toBeUndefined()
    expect(bodyColor({ vehicle_config: { paint_color_override: 'bleu' } })).toBeUndefined()
    expect(bodyColor({})).toBeUndefined()
  })

  it('classifies the three finishes, each recorded on the real car', () => {
    // Three switches on the dashboard screen, three readings on 2026-09-15. No invented finish.
    expect(bodyFinish(parked)).toBe('matte')                                                        // 0.9 / 0.30
    expect(bodyFinish({ vehicle_config: { paint_color_override: '40,90,200,0.9,0.01' } })).toBe('metallic')
    expect(bodyFinish({ vehicle_config: { paint_color_override: '40,90,200,0.7,0.04' } })).toBe('solid')

    // The two axes are INDEPENDENT: roughness decides matte, metalness separates the two glossy
    // ones. A first version only read the fourth number and answered "matte" no matter what; a
    // second only read the fifth and couldn't say "solid".
    expect(bodyFinish({ vehicle_config: { paint_color_override: '0,0,0,0.7,0.30' } })).toBe('matte')
    expect(bodyFinish({ vehicle_config: { paint_color_override: '0,0,0,0.9,0.04' } })).toBe('metallic')

    // No fifth number, or no section: nothing to say about the finish.
    expect(bodyFinish({ vehicle_config: { paint_color_override: '10,20,30,0.9' } })).toBeUndefined()
    expect(bodyFinish({})).toBeUndefined()
  })
})

describe('full reading (`vehicle_data`)', () => {
  it('parked, cable plugged into a charger with no current (`NoPower`): miles → km, `null` → absent field', () => {
    const p = toDataPatch(parked)
    accepted(p)
    expect(p.soc).toBe(54)
    expect(p.rangeKm).toBeCloseTo(145.93 * MILE, 1)
    expect(p.pluggedIn).toBe(true)                 // `NoPower`: the cable is there (IEC engaged), the charger delivers nothing
    expect(p.charging).toBe(false)
    expect(p.chargePowerW).toBe(0)
    expect(p.chargeLimit).toBe(80)
    expect(p.locked).toBe(true)
    expect(p.odometerKm).toBeCloseTo(61234.01676 * MILE, 0)
    expect(p.insideTempC).toBe(25.8)
    expect(p.outsideTempC).toBe(23)
    expect(p.climateOn).toBe(false)
    expect(p.climateTargetC).toBe(15)
    expect(p.seatHeat).toEqual({ fl: 0, fr: 0, rl: 0, rc: 0, rr: 0 })
    expect(p.steeringWheelHeat).toBe(false)
    expect(p.sleepState).toBe('online')
  })

  it('when stationary: `null` speed is 0, `null` gear is P', () => {
    const p = toDataPatch(parked)
    expect(p.speedKmh).toBe(0)
    expect(p.gear).toBe('P')
  })

  it('tires: four wheels rounded to the hundredth, a `null` wheel is absent and not a 0', () => {
    expect(toDataPatch(parked).tirePressureBar).toEqual({ fl: 3.18, fr: 3.25, rl: 3.25, rr: 3.3 })
    const three = { ...parked, vehicle_state: { ...parked.vehicle_state, tpms_pressure_rr: null } }
    expect(toDataPatch(three).tirePressureBar).toEqual({ fl: 3.18, fr: 3.25, rl: 3.25 })
    // no wheel measured → no object, rather than an empty object that would be displayed
    const none = { ...parked, vehicle_state: { ...parked.vehicle_state, tpms_pressure_fl: null, tpms_pressure_fr: null, tpms_pressure_rl: null, tpms_pressure_rr: null } }
    expect(toDataPatch(none).tirePressureBar).toBeUndefined()
  })

  it('the heading is taken as is (0 = north), normalized into [0, 360[', () => {
    expect(toDataPatch(parked).headingDeg).toBe(112)
    expect(toDataPatch({ ...parked, drive_state: { ...parked.drive_state, heading: 372 } }).headingDeg).toBe(12)
    expect(toDataPatch({ ...parked, drive_state: { ...parked.drive_state, heading: null } }).headingDeg).toBeUndefined()
  })

  it('the position is dated by `gps_as_of` (seconds) converted to milliseconds', () => {
    expect(toDataPatch(parked).location).toEqual({ lat: 45.188529, lon: 5.724524, at: 1789329492_000 })
    const noGps = { ...parked, drive_state: { ...parked.drive_state, gps_as_of: null } }
    expect(toDataPatch(noGps).location?.at).toBe(1789329806461)
    const noPos = { ...parked, drive_state: { ...parked.drive_state, latitude: null } }
    expect(toDataPatch(noPos).location).toBeUndefined()
  })

  it('while driving: unplugged, mph → km/h, gear D, unlocked', () => {
    const p = toDataPatch(driving)
    accepted(p)
    expect(p.pluggedIn).toBe(false)
    expect(p.charging).toBe(false)
    expect(p.speedKmh).toBeCloseTo(52 * MILE, 1)
    expect(p.gear).toBe('D')
    expect(p.locked).toBe(false)
    expect(p.soc).toBe(48)
  })

  it('charging: `Charging` and the power in watts', () => {
    const p = toDataPatch(charging)
    accepted(p)
    expect(p).toMatchObject({ pluggedIn: true, charging: true, chargePowerW: 7000, soc: 61 })
  })

  it('remaining time: the vendor decimal hours as minutes, and nothing outside charging', () => {
    expect(toDataPatch(charging).chargeMinutesRemaining).toBe(105)   // 1.75 h
    // unplugged, `time_to_full_charge` stays at its last value: we clear it rather than display it
    expect(toDataPatch(parked).chargeMinutesRemaining).toBeNull()
  })

  it('a missing section makes nothing fail: the patch shrinks to what we have', () => {
    const bare = vehicleDataSchema.parse({ response: { vin: parked.vin, state: 'online' } }).response
    expect(toDataPatch(bare)).toEqual({ sleepState: 'online' })
  })
})

describe('rest', () => {
  it('parked, nobody on board, not charging → at rest: we let it fall asleep', () => {
    expect(isResting(parked)).toBe(true)
  })
  it('on the road, or charging, or someone on board → active: we keep reading', () => {
    expect(isResting(driving)).toBe(false)
    expect(isResting(charging)).toBe(false)
    expect(isResting({ ...parked, vehicle_state: { ...parked.vehicle_state, is_user_present: true } })).toBe(false)
    // a software installation in progress: we want to see it advance
    expect(isResting({ ...parked, vehicle_state: { ...parked.vehicle_state, software_update: { status: 'installing', install_perc: 30 } } })).toBe(false)
  })
})

describe('software (`car_version`, `software_update`)', () => {
  const withSoftware = (car_version: string | null, software_update: unknown) =>
    vehicleDataSchema.parse({ response: { ...parked, vehicle_state: { ...parked.vehicle_state, car_version, software_update } } }).response

  it('capture of 2026-10-02: 2026.38 available — no lingering install percentage, no time', () => {
    const patch = toDataPatch(withSoftware('2026.32.7', { download_perc: 100, expected_duration_sec: 1200, install_perc: 10, status: 'available', version: '2026.38' }))
    expect(patch.softwareVersion).toBe('2026.32.7')
    expect(patch.softwareUpdate).toEqual({ status: 'available', version: '2026.38', expectedDurationS: 1200 })
    accepted(patch)
  })

  it('scheduled (parked fixture): the installation time, in milliseconds', () => {
    const patch = toDataPatch(parked)
    expect(patch.softwareVersion).toBe('2026.26.6.1')
    expect(patch.softwareUpdate).toEqual({ status: 'scheduled', version: '2026.32.3', scheduledAt: 1789333199407, expectedDurationS: 1200 })
  })

  it('empty status = nothing pending: the field is CLEARED (null), not left at its last value', () => {
    const patch = toDataPatch(withSoftware('2026.38', { status: '', download_perc: 0, install_perc: 1, expected_duration_sec: 2700 }))
    expect(patch.softwareUpdate).toBeNull()
    accepted(patch)
  })

  it('each number in its status: download, waiting for Wi-Fi, installation', () => {
    expect(toDataPatch(withSoftware('2026.32.7', { status: 'downloading', version: '2026.38', download_perc: 41.6, install_perc: 10 })).softwareUpdate)
      .toEqual({ status: 'downloading', version: '2026.38', downloadPct: 42 })
    expect(toDataPatch(withSoftware('2026.32.7', { status: 'downloading_wifi_wait', version: '2026.38', download_perc: 0 })).softwareUpdate)
      .toEqual({ status: 'waiting_wifi', version: '2026.38' })
    expect(toDataPatch(withSoftware('2026.32.7', { status: 'installing', version: '2026.38', install_perc: 35, download_perc: 100 })).softwareUpdate)
      .toEqual({ status: 'installing', version: '2026.38', installPct: 35 })
  })

  it('a build hash after the version is removed; a section without `software_update` leaves it alone', () => {
    const patch = toDataPatch(withSoftware('2026.32.7 3d1a9c4e5f', undefined))
    expect(patch.softwareVersion).toBe('2026.32.7')
    expect('softwareUpdate' in patch).toBe(false)
  })
})

describe('release notes (`release_notes`)', () => {
  const entries = parseReleaseNotes(releaseNotesResponseSchema.parse(RELEASE_NOTES_INSTALLED).response.release_notes)

  it('grouped by version, titles trimmed ("Automatic Navigation  "), in the response order', () => {
    const byVersion = notesByVersion(entries.filter((e) => e.show_in_history !== false))
    expect(Object.keys(byVersion)).toEqual(['2026.32', '2026.26.6'])
    expect(byVersion['2026.32']!.map((n) => n.title)).toEqual(['Apple Music', 'Security Improvements'])
    expect(byVersion['2026.26.6']).toHaveLength(7)
    expect(byVersion['2026.26.6']!.map((n) => n.title)).toContain('Automatic Navigation')
  })

  it('an entry of unexpected shape is dropped on its own', () => {
    expect(parseReleaseNotes([{ title: 'Ok' }, { description: 'sans titre' }, 42, { title: '  ' }]).map((e) => e.title)).toEqual(['Ok'])
  })

  it('illustrations: signed URLs whose expiry can be read, and which are removed once expired', () => {
    const note = notesByVersion(entries)['2026.32']![0]!
    const exp = urlExpiresAt(note.imageUrl)
    expect(exp).toBe(1792130420_000)
    expect(urlExpiresAt('https://exemple.fr/image.png')).toBeUndefined()
    expect(withoutExpiredImages(note, exp! - 1)).toEqual(note)
    expect(withoutExpiredImages(note, exp!)).toEqual({ title: 'Apple Music', description: note.description })
  })

  it('versions sort segment by segment', () => {
    expect(['2026.26.6', '2026.32.7', '2026.32', '2026.4'].sort(compareVersions)).toEqual(['2026.4', '2026.26.6', '2026.32', '2026.32.7'])
  })
})

describe('requested language of the notes', () => {
  it('two lowercase letters; anything else falls back to English', () => {
    expect(releaseNotesLang('fr')).toBe('fr')
    expect(releaseNotesLang('fr-FR')).toBe('fr')
    expect(releaseNotesLang('EN')).toBe('en')
    expect(releaseNotesLang(undefined)).toBe('en')
    expect(releaseNotesLang('1;')).toBe('en')
  })
})
