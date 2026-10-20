// Capture of 2026-09-14 on the real account: a Renault 5 E-Tech (`R5E1VE`, first registered on
// 2024-06-03), plugged in at the garage with no current delivered. ANONYMIZED — VIN, plate, account
// identifiers and position were replaced; EVERYTHING ELSE is what Renault answered, quirks
// included. Don't "fix" these shapes: that's precisely their value.
//
// The quirks to keep:
//  1. `cockpit` in v2 answers HTTP 200 WITH NO DATA and a joke inside. It's v1 that carries the
//     mileage. A client that trusts the HTTP status believes it has read something.
//  2. `chargingStatus` is an enumerated FLOAT, not a boolean: 0.3 = waiting, 1.0 = charging.
//  3. Refused readings are refused in TWO ways — 403 `err.func.wired.forbidden` for
//     `charging-settings` and `charge-mode`, 404 `err.func.wired.notFound` for `lock-status`,
//     `pressure` and `res-state`. Handling only the 403 would let three readings repeat.
//  4. `hvac-status` gives the INSIDE temperature (`internalTemperature`), not the outside one.
//  5. No instantaneous charging power, no heading, no tire pressure, no speed. The power was
//     RECHECKED on 09/14 at 12:58, car CHARGING (`BATTERY_CHARGING`): the response still carries
//     no `chargingInstantaneousPower`. So it's not an artifact of the first capture, taken with the
//     cable plugged in and no current — the R5 doesn't report its power, period.

export const VIN = 'VYSP0100000000001'
export const ACCOUNT_ID = '00000000-1111-2222-3333-444444444444'
export const PERSON_ID = '55555555-6666-7777-8888-999999999999'

/** Two Kamereon accounts for a single person: the connected services, and the CRM record. */
export const PERSON = {
  accounts: [
    { accountId: ACCOUNT_ID, accountType: 'MYRENAULT', accountStatus: 'ACTIVE' },
    { accountId: '99999999-8888-7777-6666-555555555555', accountType: 'SFDC', accountStatus: 'ACTIVE' },
  ],
}

/** The list of vehicles. `vehicleDetails` is a spec sheet: NO nickname anywhere. */
export const VEHICLES = {
  vehicleLinks: [{
    vin: VIN,
    status: 'ACTIVE',
    linkType: 'OWNER',
    brand: 'RENAULT',
    garageBrand: 'RENAULT',
    vehicleDetails: {
      vin: VIN,
      registrationNumber: 'AA123BB',
      brand: { label: 'RENAULT' },
      model: { code: 'R5E1VE', label: 'RENAULT 5', group: '971' },
      energy: { code: 'ELECX', label: 'ELECTRICITY', group: '019' },
      registrationDate: '2024-06-03',
      firstRegistrationDate: '2024-06-03',
      engineType: '6AK',
      modelSCR: 'R5E',
      deliveryCountry: { code: 'FR', label: 'FRANCE' },
      tcu: { code: 'AIVCT', label: 'WITH AIVC CONNECTION UNIT', group: 'E70' },
      battery: { code: 'BTGAE', label: 'BATTERY BTGAE', group: '968' },
      radioType: { code: 'NA498', label: 'IVI2 FULL10 PREM DAB', group: '425' },
      registrationCountry: { code: 'FR' },
      navigationAssistanceLevel: {},
      // The vehicle's renders in its configuration. Truncated to what matters: `TEGNE` is the only
      // place in the WHOLE reading that gives the color (Noir Étoilé). Capture of 2026-09-15.
      assets: [{
        assetType: 'PICTURE',
        viewpoint: 'mybrand_2',
        renditions: [{
          resolutionType: 'ONE_MYRENAULT_SMALL',
          url: 'https://3dv.renault.com/ImageFromBookmark?configuration=PAVEH%2FX1316%2FHTB%2FEA3%2FLHDG%2FRVX09%2FRAL18%2FTEGNE%2FMET05%2FRRCAM%2FCHRGI&bookmarkSet=RSITE&bookmark=EXT_34_DESSUS',
        }],
      }],
    },
    connectedDriver: { role: 'MAIN_DRIVER', createdDate: '2024-06-20T08:00:00.000000Z' },
  }],
}

/**
 * Plugged in, WAITING, nothing flowing: `plugStatus: 1` and `chargingStatus: 0.3`. It's the state
 * produced by a charger driven by solar surplus when production isn't enough — and it's also the
 * one the R5 stays stuck in after a power cut.
 */
export const BATTERY_WAITING = {
  data: {
    id: VIN,
    attributes: {
      timestamp: '2026-09-14T08:19:43Z',
      batteryLevel: 58,
      batteryAutonomy: 218,
      V2L_SystemStatusDisplay: 0,
      plugStatus: 1,
      chargingStatus: 0.3,
      chargingRemainingTime: 19,
      chargingRemainingTimeLastUpdateDateTime: '2026-09-12T14:56:38Z',
    },
  },
}

/**
 * The same CHARGING, capture of 09/14 at 12:58: `chargingStatus: 1.0`, and a `chargingRemainingTime`
 * FRESH this time (its `lastUpdateDateTime` equals the reading's `timestamp`, whereas the capture
 * while stopped dated it from two days before). That's what justifies showing the remaining time
 * only while charging. Still no instantaneous power: see quirk 5 at the top of the file.
 */
export const BATTERY_CHARGING = {
  data: {
    id: VIN,
    attributes: {
      timestamp: '2026-09-14T12:58:27Z',
      batteryLevel: 74,
      batteryAutonomy: 276,
      V2L_SystemStatusDisplay: 0,
      plugStatus: 1,
      chargingStatus: 1.0,
      chargingRemainingTime: 43,
      chargingRemainingTimeLastUpdateDateTime: '2026-09-14T12:58:27Z',
    },
  },
}

/** Unplugged, not charging. */
export const BATTERY_UNPLUGGED = {
  data: {
    id: VIN,
    attributes: { timestamp: '2026-09-14T08:19:43Z', batteryLevel: 58, batteryAutonomy: 218, plugStatus: 0, chargingStatus: 0.0 },
  },
}

/** `cockpit` in v1: the mileage. `fuelQuantity: 0` on an electric car. */
export const COCKPIT_V1 = {
  data: { id: VIN, attributes: { fuelQuantity: 0, totalMileage: 12500, timestamp: '2026-09-14T08:18:31Z' } },
}

/**
 * `cockpit` in v2, AS IS: HTTP 200, no `data`, and a witticism instead. The mapping must come out
 * of it with no mileage rather than with a zero.
 */
export const COCKPIT_V2_EASTER_EGG = { message: 'you should not be there but well done for the effort' }

export const LOCATION = {
  data: { id: VIN, attributes: { lastUpdateTime: '2026-09-14T08:18:31Z', gpsLatitude: 47.32, gpsLongitude: 5.04 } },
}

/** `internalTemperature`: the INSIDE of the cabin (car in the sun that day). */
export const HVAC_STATUS = {
  data: { id: VIN, attributes: { internalTemperature: 37, hvacStatus: 'off', socThreshold: 15, lastUpdateTime: '2026-09-14T08:19:09Z' } },
}

/** EV settings (`kcm`): no `data` envelope, the fields are at the root. */
export const SOC_LEVELS = { lastEnergyUpdateTimestamp: '2026-09-11T09:08:37Z', socMin: 20, socTarget: 80 }

/**
 * The charging settings, as they are. It's the payload a future "wake-up" will have to REPLAY
 * IDENTICALLY (only the timestamp changes): the values hard-coded by other tools would overwrite
 * the start time, duration and temperature chosen by the user.
 */
export const EV_SETTINGS = {
  lastSettingsUpdateTimestamp: '2026-09-06T12:08:10.89632Z',
  delegatedActivated: false,
  chargeModeRq: 'SCHEDULED',
  chargeTimeStart: '12:00',
  chargeDuration: 420,
  preconditioningTemperature: 21,
  preconditioningHeatedStrgWheel: false,
  preconditioningHeatedRightSeat: false,
  preconditioningHeatedLeftSeat: false,
  programs: [{
    programActivationStatus: false,
    programType: 'CHARGE',
    programDepartureTime: '20:00:00',
    programActivationMonday: true,
    programActivationTuesday: true,
    programActivationWednesday: true,
    programActivationThursday: true,
    programActivationFriday: true,
    programActivationSaturday: true,
    programActivationSunday: true,
  }],
}

/**
 * The two refusals, with the codes OBSERVED. Only `errorCode` was captured as is; the label is
 * reconstructed, nobody reads it.
 */
/**
 * The frame that unmasked `chargingStatus` (capture of 2026-09-19, 16:11 local). The car is
 * charging — 5.5 kW measured at the charger AND by the inverter, `batteryLevel` gone from 63 to 73
 * during the afternoon — and yet it announces `0.3`, "waiting for current". Two fields of the SAME
 * frame contradict it: the rising level, and a remaining time dated from the frame itself. The
 * MY Renault app showed the same error: it's the field that lies, not the link.
 */
export const BATTERY_CHARGING_LIAR = {
  data: {
    id: VIN,
    attributes: {
      timestamp: '2026-09-19T14:11:54Z',
      batteryLevel: 73,
      batteryAutonomy: 281,
      plugStatus: 1,
      chargingStatus: 0.3,
      chargingRemainingTime: 52,
      chargingRemainingTimeLastUpdateDateTime: '2026-09-19T14:11:54Z',
    },
  },
}

/**
 * Capture of 2026-10-02 (14:00 local), re-read unchanged until the evening: the car is asleep.
 * Charger in green charging with no sun, nothing flows (0 W at the charger) — and yet the remaining
 * time (480 min) is dated from the frame itself, as with the liar of 09/19. Only difference: the
 * level doesn't rise (51 % at 11:44, 52 % at 14:00). `0.3` told the TRUTH that day.
 */
export const BATTERY_WAITING_FRESH_ETA = {
  data: {
    id: VIN,
    attributes: {
      timestamp: '2026-10-02T12:00:07Z',
      batteryLevel: 52,
      batteryAutonomy: 214,
      V2L_SystemStatusDisplay: 0,
      plugStatus: 1,
      chargingStatus: 0.3,
      chargingRemainingTime: 480,
      chargingRemainingTimeLastUpdateDateTime: '2026-10-02T12:00:07Z',
    },
  },
}

/**
 * The refusal of a settings WRITE when a command is already pending for this vehicle (HTTP 409,
 * observed on 2026-09-19: the same body accepted at 14:21 was refused at 14:22). As for the other
 * two, only `errorCode` was captured as is.
 */
export const SETTINGS_PENDING = { errors: [{ errorCode: 'err.func.vcps.ev.post-settings.error', errorMessage: 'The settings cannot be posted' }] }

/** The response to an accepted write: a COMMAND filed, not a save. */
export const SETTINGS_COMMAND = { commandId: 'ba6a5b31-0000-0000-0000-9f2c1d4e8a70', type: 'HVAC_CHARGE_SYNCH', status: 'CREATED' }

export const FORBIDDEN = { errors: [{ errorCode: 'err.func.wired.forbidden', errorMessage: 'The access is forbidden' }] }
export const NOT_FOUND = { errors: [{ errorCode: 'err.func.wired.notFound', errorMessage: 'Not found' }] }

/**
 * `GET .../vehicles/{vin}/contracts` — SHAPE of the capture of 2026-10-19 (bare array, `conditions`
 * as an array), invented VALUES: labels, dates and caps are not those of the real account. What
 * matters: a single maintenance contract capped in km, a battery warranty ALSO capped (not to be
 * mistaken for a service plan), and connected services with no km condition at all.
 */
export const CONTRACTS = [
  {
    type: 'WARRANTY_MAINTENANCE_CONTRACTS', code: '51', group: 'Service_Plan_And_Extended_Warranty',
    groupLabel: "Contrat d'entretien et extension de garantie", description: 'EASYPACK 49MOIS EXEMPLE',
    status: 'ACTIVE', statusLabel: 'Actif', durationMonths: 48, startDate: '2025-03-01', endDate: '2029-03-31',
    conditions: [{ startDate: '2025-03-01', endDate: '2029-03-31', maximumMileage: 40000, mileageUnit: 'km', unlimitedMileage: false }],
  },
  {
    type: 'CONNECTED_SERVICES', code: '15181', description: 'Pack Navigation', status: 'ACTIVE',
    durationMonths: 60, startDate: '2025-02-20', endDate: '2030-02-20',
  },
  {
    type: 'WARRANTY', code: 'BatteryWarranty', description: 'Garantie batterie', status: 'ACTIVE', durationMonths: 96,
    endDate: '2033-02-20', conditions: [{ endDate: '2033-02-20', maximumMileage: 160000, mileageUnit: 'km', unlimitedMileage: false }],
  },
  {
    type: 'WARRANTY', code: 'ManufacturerWarranty', description: 'Garantie fabricant', status: 'ACTIVE', durationMonths: 24,
    endDate: '2027-02-20', conditions: [{ endDate: '2027-02-20', mileageUnit: 'km', unlimitedMileage: true }],
  },
]
