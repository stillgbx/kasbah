import { z } from 'zod'

// Schemas of the PetKit responses. Deliberately LENIENT, for the reason already paid for with
// TaHoma then MELCloud: a field we don't even read is enough to make the whole response fail. And
// the pitfall verified in zod 4.5 — `z.unknown()` does NOT make the key optional — requires
// `.optional()` everywhere.
//
// BEWARE, these schemas were written BEFORE any capture, from third-party libraries that
// reverse-engineered the mobile app's API. So they only validate enough to ADDRESS a device and
// read the few quantities of the contract. The `GET /api/plugins/petkit/raw` route exists so that
// the first linking replaces these assumptions with recorded data — it's the established procedure
// for a cloud plugin whose account is not linked yet (Nest precedent).

/** The API answers with HTTP 200 even when it refuses: the failure is in `error`. */
export const petkitEnvelopeSchema = z.looseObject({
  result: z.unknown().optional(),
  error: z.looseObject({ code: z.unknown().optional(), msg: z.unknown().optional() }).optional(),
})

/** `v1/regionservers`: the regional gateways, served by `passport.petkt.com`. */
export const regionServersSchema = z.looseObject({
  list: z.array(z.looseObject({
    id: z.unknown().optional(),
    name: z.unknown().optional(),
    gateway: z.string().min(1),
    /** ISO country code; it's what links "FR" to the European gateway. */
    accountType: z.unknown().optional(),
  })).optional(),
})

/**
 * `user/login`. The session carries its own lifetime: PetKit returns NO refresh token, so
 * `expiresIn` is the only safeguard — see `auth.ts` for what this requires.
 */
export const loginSchema = z.looseObject({
  session: z.looseObject({
    id: z.string().min(1),
    /** ISO issue date, with time zone. */
    createdAt: z.unknown().optional(),
    /** Lifetime in SECONDS (around 36 h on the accounts observed). */
    expiresIn: z.number().optional(),
    region: z.unknown().optional(),
    userId: z.unknown().optional(),
  }),
})

/**
 * A device as the inventory names it. `type` is the model code (`d4`, `ctw3`…) and `id` the
 * numeric identifier. The `deviceId` / `deviceType` / `deviceName` variants are accepted as well:
 * the two third-party implementations disagree on the spelling, and nothing says that all
 * accounts answer the same way.
 */
export const rosterDeviceSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  deviceId: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  deviceName: z.string().optional(),
  type: z.string().optional(),
  deviceType: z.string().optional(),
  groupId: z.union([z.number(), z.string()]).optional(),
  /**
   * NUMERIC model code (11 for a `D4`, 24 for a `Ctw3`). It's THIS that the Bluetooth calls expect
   * in their `type` field, not the string: with `"ctw3"`, `ble/connect` answers "Vous n'avez pas de
   * permission. (code 4)" — verified on 09/21.
   */
  deviceTypeId: z.union([z.number(), z.string()]).optional(),
  /** Bluetooth address, required to open a relay to a fountain. */
  mac: z.string().optional(),
})

/**
 * Response of `discovery/device_roster_v2` for ONE group. `hasRelay` says whether this group has
 * a device able to relay Bluetooth — the information is given here, for free, whereas we also ask
 * `ble/ownSupportBleDevices` for it again just before opening a link.
 */
export const rosterSchema = z.looseObject({
  devices: z.array(rosterDeviceSchema).optional(),
  hasRelay: z.boolean().optional(),
  /** Grouped shape, seen on some accounts. */
  list: z.array(z.looseObject({
    devices: z.array(rosterDeviceSchema).optional(),
    groupId: z.union([z.number(), z.string()]).optional(),
  })).optional(),
})

/** `group/family/list`: the account's "families", whose identifiers drive the roster. */
export const familyListSchema = z.array(z.looseObject({
  groupId: z.union([z.number(), z.string()]).optional(),
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
}))

/**
 * State of a feeder (`d4`), CAPTURED on 2026-09-21 on the real machine. What came as a surprise:
 * `feedState` does NOT carry `eatAmountTotal` on this model (no weighing tray), but it gives the
 * day's PLANNED (`planAmountTotal`) alongside the served (`realAmountTotal`).
 */
export const feederDataSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  mac: z.string().optional(),
  /** Bluetooth address of the feeder: IT is what relays to the nearby fountain. */
  btMac: z.string().optional(),
  /**
   * `factor`: **what to divide the quantities by to get the displayed unit**. The real machine
   * answers 10 — so its `amount`s are TENTHS OF A CUP, not grams. It's the device that says so;
   * inferring it from the model would be one more assumption.
   */
  settings: z.looseObject({ factor: z.number().optional() }).optional(),
  /** The meal plan, one entry per day of the week (`repeats` = 1 Monday … 7 Sunday). */
  multiFeedItem: z.looseObject({
    feedDailyList: z.array(z.looseObject({
      repeats: z.union([z.number(), z.string()]).optional(),
      suspended: z.number().optional(),
      items: z.array(z.looseObject({
        /** Meal time, in SECONDS since midnight (68400 = 7 pm). */
        time: z.number().optional(),
        amount: z.number().optional(),
        name: z.string().optional(),
      })).optional(),
    })).optional(),
  }).optional(),
  state: z.looseObject({
    /** 1 = there is kibble left, 0 = hopper empty. Verified: the filled machine answers 1. */
    food: z.number().optional(),
    batteryPower: z.number().optional(),
    batteryStatus: z.number().optional(),
    desiccantLeftDays: z.number().optional(),
    feeding: z.number().optional(),
    errorCode: z.string().optional(),
    errorMsg: z.string().optional(),
    feedState: z.looseObject({
      /** Grams actually dispensed since midnight. */
      realAmountTotal: z.number().optional(),
      /** Grams the day's plan provides IN TOTAL (50 g recorded for two meals). */
      planAmountTotal: z.number().optional(),
      /** Present only on models with a weighing tray; absent from a `d4`. */
      eatAmountTotal: z.number().optional(),
      addAmountTotal: z.number().optional(),
    }).optional(),
  }).optional(),
})

/**
 * State of a Bluetooth fountain (`ctw3`), CAPTURED on 2026-09-21. Three surprises:
 *
 *  - the pump's on/off state is in `status.powerStatus`, NOT at the top level;
 *  - **`-1` is an "unknown" sentinel**, not a value: `todayCleanWater`, `filterExpectedDays`
 *    and `waterPumpRunTime` were all -1 on the real machine. Taking them literally would display
 *    "0 mL drunk" and "0 filter days" — two lies (same pitfall as MELCloud's missing sensor at
 *    -39);
 *  - these values date from the last Bluetooth relay (`syncTime`), not from now.
 */
export const fountainDataSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  mac: z.string().optional(),
  /** 1 = continuous, 2 = on approach. The real machine, set to "smart", answers 2. */
  mode: z.number().optional(),
  status: z.looseObject({
    /** 1 = the pump is powered. */
    powerStatus: z.number().optional(),
    suspendStatus: z.number().optional(),
    runStatus: z.number().optional(),
  }).optional(),
  filterPercent: z.number().optional(),
  filterExpectedDays: z.number().optional(),
  filterWarning: z.number().optional(),
  lackWarning: z.number().optional(),
  breakdownWarning: z.number().optional(),
  lowBattery: z.number().optional(),
  electricity: z.looseObject({ batteryPercent: z.number().optional() }).optional(),
  /** Water dispensed today. -1 = the machine doesn't count it. Assumed unit: milliliters. */
  todayCleanWater: z.number().optional(),
  syncTime: z.string().optional(),
  updateAt: z.string().optional(),
})

/**
 * `ble/ownSupportBleDevices`: the Wi-Fi devices able to relay, for a given group.
 * **`pim` says whether they are ONLINE** — a relay that is listed but unplugged won't relay anything.
 */
export const bleRelaysSchema = z.array(z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  typeId: z.union([z.number(), z.string()]).optional(),
  pim: z.number().optional(),
}))

export type RosterDevice = z.infer<typeof rosterDeviceSchema>
export type FeederData = z.infer<typeof feederDataSchema>
export type FountainData = z.infer<typeof fountainDataSchema>

/**
 * `<type>/getWorkRecord`: the animal's VISITS to the fountain, one per visit. It's what the
 * vendor's app displays as "L'eau potable d'aujourd'hui : 6 fois" and as an average duration — an
 * Eversweet Max measures no volume, it counts visits.
 */
export const workRecordSchema = z.array(z.looseObject({
  /** Time of the visit (epoch seconds). */
  workTime: z.number().optional(),
  /** Seconds since midnight. */
  dayTime: z.number().optional(),
  /** How long the animal stayed, in seconds. */
  stayTime: z.number().optional(),
}))
