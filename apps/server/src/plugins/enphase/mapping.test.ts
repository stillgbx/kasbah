import { describe, expect, it } from 'vitest'
import { deviceDescriptorSchema, mergeState, defaultState } from '@kasbah/shared'
import {
  ENSEMBLE_INVENTORY, ENSEMBLE_POWER, INVERTERS, LIVEDATA, METERS, PRODUCTION,
} from './__fixtures__/gateway'
import { EVSE_STATUS, EVSE_SUMMARY } from './__fixtures__/evse'
import {
  PANEL_STALE_MS, batteriesOf, chargerSummariesOf, chargersOf, isBatteryAvailable, isPanelStale, productionW, toBatteryPatch,
  toChargerDescriptors, toChargerPatch, toDailyPatch, toDescriptors, toPanelPatch, toSitePatch,
} from './mapping'
import {
  ensembleInventorySchema, ensemblePowerSchema, invertersSchema, livedataSchema, productionSchema,
} from './types'

// IQ Gateway mapping, tested against responses CAPTURED from the real one (see
// `__fixtures__/gateway.ts`): three-phase installation, 20 microinverters, 2 IQ batteries.

const report = productionSchema.parse(PRODUCTION)
const inverters = invertersSchema.parse(INVERTERS)
const live = livedataSchema.parse(LIVEDATA)
const inventory = ensembleInventorySchema.parse(ENSEMBLE_INVENTORY)
const power = ensemblePowerSchema.parse(ENSEMBLE_POWER)
const batteries = batteriesOf(inventory)

describe('reading the real responses', () => {
  it('the schemas accept what the gateway sends, colon-suffixed `devices:` key included', () => {
    expect(report.production).toHaveLength(2)
    expect(inverters).toHaveLength(20)
    expect(live.meters?.enc_agg_soc).toBe(100)
    expect(batteries).toHaveLength(2)
    expect(power['devices:']).toHaveLength(2)
    // two CTs in three-phase: it is what makes measured production and consumption available
    const meters = METERS as readonly { measurementType: string; phaseCount: number }[]
    expect(meters.map((m) => m.measurementType)).toEqual(['production', 'net-consumption'])
    expect(meters.every((m) => m.phaseCount === 3)).toBe(true)
  })
})

describe('descriptors', () => {
  const descriptors = toDescriptors({ report, inverters, batteries })

  it('publishes a site, a sensor per inverter, a device per battery', () => {
    expect(descriptors).toHaveLength(23)
    expect(descriptors.filter((d) => d.kind === 'sensor')).toHaveLength(20)
    expect(descriptors.filter((d) => d.kind === 'energy')).toHaveLength(3)
    for (const d of descriptors) expect(deviceDescriptorSchema.parse(d)).toEqual(d)
  })

  it('the site declares storage because the installation has batteries', () => {
    const site = descriptors[0]!
    expect(site).toMatchObject({ id: 'enphase:site', externalId: 'site', kind: 'energy' })
    expect(site.capabilities).toEqual(['production', 'consumption', 'grid', 'storage', 'energy_history'])
    // without a battery, the capability drops: the UI does not show an empty battery tile
    const noBattery = toDescriptors({ report, inverters, batteries: [] })
    expect(noBattery[0]!.capabilities).toEqual(['production', 'consumption', 'grid', 'energy_history'])
    expect(noBattery).toHaveLength(21)
  })

  it('a solar panel is a power sensor in watts, named after the end of its serial number', () => {
    const panel = descriptors.find((d) => d.kind === 'sensor')!
    expect(panel.externalId).toBe(inverters[0]!.serialNumber)
    expect(panel.name).toBe(`Onduleur ${inverters[0]!.serialNumber.slice(-5)}`)
    expect(panel.meta.sensor).toEqual({ unit: 'W', deviceClass: 'power', precision: 0 })
    // the 20 ids are distinct: it is what allows linking a panel array
    expect(new Set(descriptors.filter((d) => d.kind === 'sensor').map((d) => d.id)).size).toBe(20)
  })

  it('a battery is a storage-only `energy`: it is what gives it the battery icon', () => {
    const battery = descriptors.filter((d) => d.kind === 'energy').slice(1)
    expect(battery).toHaveLength(2)
    expect(battery[0]!.capabilities).toEqual(['storage'])
    expect(battery[0]!.name).toBe(`Batterie ${batteries[0]!.serial_num.slice(-5)}`)
    expect(battery[0]!.meta.model).toBe(batteries[0]!.part_num)
  })
})

describe('site state', () => {
  const patch = toSitePatch(live) as Record<string, number>

  it('reads the meters through `livedata`, a thousand times faster than `production.json`', () => {
    // same meters, give or take a few seconds of sampling: 6472 W versus 6456 W
    expect(patch.productionW).toBe(6472)
    expect(patch.consumptionW).toBe(725)
    expect(patch.gridW).toBe(-5763)                      // negative = export, already the contract's sign
  })

  it('when falling back on `production.json`, takes the METER and not the inverters\' sum', () => {
    const p = toSitePatch(undefined, report) as Record<string, number>
    expect(productionW(report)).toBe(6456)
    const inverterSum = report.production.find((e) => e.type === 'inverters')!.wNow
    expect(inverterSum).toBe(4952)                       // 1.5 kW behind on the capture
    expect(p).toMatchObject({ productionW: 6456, consumptionW: 691, gridW: -5765 })
    // this fallback does not know the battery: it is only in `livedata`
    expect(p.batteryW).toBeUndefined()
    expect(p.batterySoc).toBeUndefined()
  })

  it("the day's Wh come from the production meter and the TOTAL consumption", () => {
    const day = toDailyPatch(report) as Record<string, number>
    expect(day.todayProductionWh).toBe(47127)
    // `net-consumption` publishes a whToday of 0: reading it would have given zero consumption
    expect(report.consumption.find((e) => e.measurementType === 'net-consumption')!.whToday).toBe(0)
    expect(day.todayConsumptionWh).toBe(18516)
  })

  it('INVERTS the storage sign: the vendor counts positive when discharging', () => {
    const m = live.meters!
    // the vendor's balance only closes with "positive storage = discharge", and it closes to the
    // milliwatt: that is the proof that justifies the inversion
    expect(m.pv!.agg_p_mw + m.storage!.agg_p_mw + m.grid!.agg_p_mw).toBe(m.load!.agg_p_mw)
    expect(m.storage!.agg_p_mw).toBe(16000)              // +16 W at Enphase = 16 W of DISCHARGE
    expect(patch.batteryW).toBe(-16)                     // so negative in the contract, which wants positive = charging
    expect(patch.batterySoc).toBe(100)
  })

  it('produces a complete and valid `energy` state, mergeable by the registry', () => {
    const merged = mergeState(defaultState('energy'), toSitePatch(live, report), 1000)
    expect(merged).toMatchObject({ kind: 'energy', productionW: 6472, consumptionW: 725, gridW: -5763, batterySoc: 100 })
  })

  it('does NOT go below zero: the clamp reads the inverters\' standby backwards at night', () => {
    const night = { ...live, meters: { ...live.meters!, pv: { ...live.meters!.pv!, agg_p_mw: -7000 } } }
    expect((toSitePatch(night) as Record<string, number>).productionW).toBe(0)
    // same rule on the `production.json` fallback
    const negative = { ...report, production: report.production.map((e) => ({ ...e, wNow: -7 })) }
    expect(productionW(negative)).toBe(0)
  })

  it('with nothing to read, says nothing rather than claiming zeros', () => {
    expect(toSitePatch(undefined)).toEqual({ kind: 'energy' })
  })
})

describe('solar panel state', () => {
  it('returns the power of the last report', () => {
    // …and the RECORD the gateway keeps for it: what it has already delivered, never its datasheet
    expect(toPanelPatch(inverters[0]!)).toEqual({ kind: 'sensor', value: inverters[0]!.lastReportWatts, maxValue: inverters[0]!.maxReportWatts })
    // the real installation's records range from 418 to 440 W: no plateau, so no clipping to infer
    const records = inverters.map((i) => i.maxReportWatts!)
    expect(new Set(records).size).toBeGreaterThan(1)
    // an inverter that publishes no record does not get an invented one
    expect(toPanelPatch({ ...inverters[0]!, maxReportWatts: undefined })).toEqual({ kind: 'sensor', value: inverters[0]!.lastReportWatts })
  })

  it('an inverter silent for more than half an hour becomes unavailable, with no invented zero', () => {
    const at = inverters[0]!.lastReportDate * 1000
    expect(isPanelStale(inverters[0]!, at + 60_000)).toBe(false)
    expect(isPanelStale(inverters[0]!, at + PANEL_STALE_MS + 1)).toBe(true)
    // the published value does not change: it is `available: false` that says we no longer know it
    expect(toPanelPatch(inverters[0]!)).toMatchObject({ value: inverters[0]!.lastReportWatts })
  })

  it('the 20 inverters of the capture all reported within the last five minutes', () => {
    const latest = Math.max(...inverters.map((i) => i.lastReportDate)) * 1000
    expect(inverters.every((i) => !isPanelStale(i, latest))).toBe(true)
  })
})

describe('battery state', () => {
  it('charge from the inventory, power from `ensemble/power`, with the contract sign', () => {
    const first = toBatteryPatch(batteries[0]!, power) as Record<string, number>
    expect(first).toMatchObject({ kind: 'energy', productionW: 0, consumptionW: 0, gridW: 0, batterySoc: 100, batteryW: 0 })
    const second = toBatteryPatch(batteries[1]!, power) as Record<string, number>
    expect(second.batteryW).toBe(-16)                    // 16000 mW of discharge at Enphase
    // the batteries' sum gives back `livedata`'s overall storage
    const sum = power['devices:'].reduce((s, d) => s + d.real_power_mw, 0)
    expect(sum).toBe(live.meters!.storage!.agg_p_mw)
  })

  it('without a power reading, the charge is enough', () => {
    const p = toBatteryPatch(batteries[0]!, undefined) as Record<string, number>
    expect(p.batterySoc).toBe(100)
    expect(p.batteryW).toBeUndefined()
  })

  it('a battery that no longer communicates is unavailable and keeps its values', () => {
    expect(isBatteryAvailable(batteries[0]!)).toBe(true)
    expect(isBatteryAvailable({ ...batteries[0]!, communicating: false })).toBe(false)
  })
})

describe('IQ EV Charger 2 (Enlighten capture)', () => {
  const chargers = chargersOf(EVSE_STATUS)
  const summaries = chargerSummariesOf(EVSE_SUMMARY)

  it('reads the charger despite `error: {}` in an HTTP 200', () => {
    expect(chargers).toHaveLength(1)
    expect(chargers[0]).toMatchObject({ sn: '482000000001', pluggedIn: true, charging: false, connected: true, sessionWh: 12363 })
    expect(summaries[0]).toMatchObject({ serialNumber: '482000000001', modelName: 'IQ-EVSE-EU-3032', maxCurrent: 32, defaultChargeLevel: 24 })
  })

  it('an unknown envelope does not throw: empty list', () => {
    expect(chargersOf(null)).toEqual([])
    expect(chargersOf({ error: 'nope' })).toEqual([])
    expect(chargerSummariesOf({ data: {} })).toEqual([])
  })

  it('SUSPENDED_EVSE / INSUFFICIENT_SOLAR = connected, not a failure, and 0 W', () => {
    const patch = toChargerPatch(chargers[0]!, summaries[0])
    expect(patch).toMatchObject({ kind: 'ev_charger', status: 'connected', powerW: 0, sessionWh: 12363, maxCurrentA: 24 })
    const merged = mergeState(defaultState('ev_charger'), patch, 1000)
    expect(merged).toMatchObject({ kind: 'ev_charger', status: 'connected', sessionWh: 12363 })
  })

  it('declares an ev_charger that can be started, stopped and have its mode chosen (real charger, 2026-10-01 and 02)', () => {
    const [d] = toChargerDescriptors(chargers, summaries)
    expect(d).toMatchObject({ id: 'enphase:482000000001', kind: 'ev_charger', capabilities: ['charge_control', 'charge_mode'], meta: { model: 'IQ-EVSE-EU-3032' } })
    expect(deviceDescriptorSchema.parse(d)).toEqual(d)
  })

  it('stopping blocks it until unplug: the descriptor says so, for the help under the button', () => {
    expect(toChargerDescriptors(chargers, summaries)[0]!.meta.evCharger).toEqual({ stopUntilUnplug: true })
  })

  it('`safeLimitState` 1 = safe mode, 0 = normal', () => {
    expect(toChargerPatch(chargers[0]!, summaries[0])).toMatchObject({ safeLimit: false })
    const safe = structuredClone(EVSE_STATUS) as unknown as { data: { chargers: { connectors: { safeLimitState: number }[] }[] } }
    safe.data.chargers[0]!.connectors[0]!.safeLimitState = 1
    const patch = toChargerPatch(chargersOf(safe)[0]!, summaries[0])
    expect(patch).toMatchObject({ safeLimit: true })
    expect(mergeState(defaultState('ev_charger'), patch, 1000)).toMatchObject({ safeLimit: true })
  })

  it('`mode` 0 = manual cancellation published, 1 = the charger follows its mode (real house, 2026-10-15)', () => {
    expect(toChargerPatch(chargers[0]!, summaries[0])).toMatchObject({ manualOverride: false })
    const overridden = structuredClone(EVSE_STATUS) as unknown as { data: { chargers: { mode: number }[] } }
    overridden.data.chargers[0]!.mode = 0
    const patch = toChargerPatch(chargersOf(overridden)[0]!, summaries[0])
    expect(patch).toMatchObject({ manualOverride: true })
    expect(mergeState(defaultState('ev_charger'), patch, 1000)).toMatchObject({ manualOverride: true })
  })
})
