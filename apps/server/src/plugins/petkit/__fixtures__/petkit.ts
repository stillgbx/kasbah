// PetKit fixtures — **CAPTURED ON THE REAL ACCOUNT on 2026-09-21**, then anonymized (hardware
// addresses, serial numbers, secrets, user identifier and Wi-Fi network name replaced; device
// identifiers and user-given names kept, they reveal nothing and make the tests readable).
//
// They replace fixtures INVENTED from third-party libraries, which got six points wrong — each of
// which would have produced a wrong display:
//
//  1. the roster carries NEITHER name NOR Bluetooth address, only `id` and `type` (in mixed case);
//  2. a fountain doesn't answer on `device_detail` (404) but on `deviceData`;
//  3. the pump's on/off state is in `status.powerStatus`, not at the top level;
//  4. **`-1` is a "not counted" sentinel**: the real fountain returns -1 for today's water, the
//     filter days and the pump time. Reading them as zeros would display "0 mL drunk" and
//     "0 filter days";
//  5. the feeder's quantities are NOT grams: `settings.factor: 10` says they count in tenths of a
//     cup — a displayed "30 g" was really 0.3 cup;
//  6. the fountain measures no volume but keeps the LOG OF ITS VISITS (`getWorkRecord`).
//
// It's exactly the lesson the wiki draws from TaHoma and COMAP: a fixture written from the
// documentation validates what the device doesn't do.

/** The account's "families": a single household. */
export const FAMILIES = [{ groupId: 300000001, name: 'Maison' }]

/**
 * Inventory of a group (`discovery/device_roster_v2`, requires `day` and `groupId`). The `type`
 * arrives in MIXED CASE (`D4`, `Ctw3`): it must be normalized before any comparison.
 */
export const ROSTER = {
  hasRelay: true,
  devices: [
    { type: 'D4', id: 400000004, shared: 0, groupId: 300000001, deviceTypeId: 11, deviceTypeAndId: '11_400000004' },
    { type: 'Ctw3', id: 400000002, shared: 0, groupId: 300000001, deviceTypeId: 24, deviceTypeAndId: '24_400000002' },
    { type: 'D4', id: 400000003, shared: 0, groupId: 300000001, deviceTypeId: 11, deviceTypeAndId: '11_400000003' },
    { type: 'Ctw3', id: 400000001, shared: 0, groupId: 300000001, deviceTypeId: 24, deviceTypeAndId: '24_400000001' },
  ],
}

/**
 * Fresh Element Solo feeder (`d4/device_detail`). What the capture teaches:
 *  - `food: 1` = there is kibble left (the hopper was filled);
 *  - `feedState` gives the day's SERVED (`realAmountTotal`) and PLANNED (`planAmountTotal`), but
 *    **not `eatAmountTotal`**: without a weighing tray, this model doesn't know what was eaten;
 *  - `batteryPower: 0` on a mains-powered machine WITHOUT batteries — it's not a flat battery;
 *  - `desiccantLeftDays: 0`: the pouch was never reset, the value is true.
 */
export const FEEDER_DETAIL = {
  id: 400000004,
  mac: 'aabbccdd0001',
  btMac: 'aabbccdd0002',
  sn: 'SN-ANONYMISE-1',
  name: 'Distributeur 1',
  hardware: 1,
  firmware: 1,
  typeCode: 1,
  familyId: 300000001,
  locale: 'Europe/Paris',
  // `factor: 10` = the `amount`s are TENTHS OF A CUP. It's the machine that declares it.
  settings: { factor: 10, feedNotify: 0, foodNotify: 1 },
  // The week's plan: seven identical lists here, `repeats` 1 = Monday … 7 = Sunday.
  multiFeedItem: {
    feedDailyList: Array.from({ length: 7 }, (_, i) => ({
      suspended: 0, repeats: i + 1,
      items: [
        { id: '3600', time: 3600, amount: 30, name: 'Goûter du soir' },
        { id: '68400', time: 68400, amount: 20, name: 'Dîner' },
      ],
    })),
    isExecuted: 1,
  },
  state: {
    wifi: { ssid: 'RESEAU', bssid: 'aabbccdd0003', rsq: -63 },
    pim: 1, ota: 0, overall: 1,
    batteryStatus: 0, runtime: 0, batteryPower: 0,
    food: 1,
    feedState: {
      realAmountTotal: 30, planAmountTotal: 50, addAmountTotal: 0, planRealAmountTotal: 30,
      times: 1, feedTimes: { 3600: 1, 68400: 3 },
    },
    desiccantLeftDays: 0, door: 0, feeding: 0, desiccantTime: 0,
  },
}

/**
 * Eversweet Max fountain (`ctw3/deviceData`). Filter worn out (`filterPercent: 0`,
 * `filterWarning: 1`), pump powered in INTERMITTENT cycle (`mode: 2`), battery full, and THREE
 * quantities at -1 that the model doesn't count.
 */
export const FOUNTAIN_DETAIL = {
  id: 400000002,
  mac: 'aabbccdd0004',
  secret: 'SECRET-ANONYMISE',
  userId: '000000000',
  sn: 'SN-ANONYMISE-2',
  name: 'Fontaine 1',
  hardware: 1,
  firmware: 111,
  typeCode: 1,
  mode: 2,
  status: { powerStatus: 1, suspendStatus: 1, runStatus: 0, detectStatus: 0, electricStatus: 2 },
  breakdownWarning: 0,
  filterWarning: 1,
  lackWarning: 0,
  lowBattery: 0,
  electricity: { supplyVoltage: 5096, batteryVoltage: 4164, batteryPercent: 100 },
  isNightNoDisturbing: 0,
  waterPumpRunTime: -1,
  filterPercent: 0,
  todayPumpRunTime: 15638,
  todayCleanWater: -1,
  todayUseElectricity: 0,
  expectedCleanWater: -1,
  expectedUseElectricity: -1,
  filterExpectedDays: -1,
  recordAutomaticAddWater: 0,
  syncTime: '2026-09-21T06:35:36.860+0000',
  updateAt: '2026-09-21T06:35:36.251+0000',
  familyId: 300000001,
  moduleStatus: 0,
  locale: 'Europe/Paris',
}

/**
 * `ctw3/getWorkRecord`: the day's visits. Two visits recorded, of 30 s and 21 s. That's all an
 * Eversweet Max can say about consumption — not a single milliliter.
 */
export const WORK_RECORD = [
  { workTime: 1789959912, dayTime: 18312, stayTime: 30 },
  { workTime: 1789943759, dayTime: 2159, stayTime: 21 },
]
