import type { SimDevice } from '../types'
import { clamp, descriptor } from './common'
import { sensor } from './sensor'

export interface PanelOptions {
  name: string
  /** Peak power of the module (W). */
  peakW?: number
  /** Relative efficiency of the module (orientation, dirt): 1 = full efficiency. */
  factor?: number
  /** Local hour from which an obstacle shades the module (chimney, tree). */
  shadeFrom?: number
}

/**
 * Photovoltaic module with its microinverter: a power sensor (W) that follows the sunshine,
 * module by module, so that a panel array has something to color.
 */
export function solarPanel(externalId: string, o: PanelOptions): SimDevice<'sensor'> {
  const peakW = o.peakW ?? 400, factor = o.factor ?? 1
  // `partOf: 'energy'`: a panel is a power sensor, but it belongs to the solar installation —
  // excluding `energy` for a real Enphase device set must take it away with it.
  const dev = sensor(externalId, {
    name: o.name, unit: 'W', deviceClass: 'power', precision: 0, initial: 0, tauS: 20, noise: 2,
    target: (ctx) => {
      const shade = o.shadeFrom !== undefined && ctx.hour >= o.shadeFrom ? 0.25 : 1
      return Math.max(0, ctx.world.irradiance * peakW * factor * shade)
    },
  })
  // the panel's RECORD, as an Enphase gateway keeps it for each of its inverters
  const tick = dev.tick!.bind(dev)
  dev.tick = (ctx) => {
    tick(ctx)
    dev.state.maxValue = Math.max(dev.state.maxValue ?? 0, dev.state.value)
  }
  return Object.assign(dev, { partOf: 'energy' as const })
}

export interface EnergyOptions {
  name: string
  /** PV peak power (W). */
  peakW?: number
  /** Battery capacity (Wh); 0 = no battery. */
  batteryWh?: number
  batteryMaxW?: number
  /** Baseline consumption of the house (standby, fridge…) in W. */
  baseLoadW?: number
}

/**
 * Energy site (Enphase type): production = sunshine × peak; consumption = baseline + loads
 * declared by the other devices this tick (so the site must be TICKED LAST);
 * the battery absorbs the surplus during the day and discharges at night down to 10 %.
 * Identity maintained on every tick: gridW = consumptionW − productionW + batteryW.
 */
export function energySite(externalId: string, o: EnergyOptions): SimDevice<'energy'> {
  const peakW = o.peakW ?? 6000, batteryWh = o.batteryWh ?? 5000, batteryMaxW = o.batteryMaxW ?? 3500, baseLoadW = o.baseLoadW ?? 350
  let batteryWhNow = batteryWh * 0.6, lastDay = -1, applianceLeftS = 0, applianceW = 0
  const dev: SimDevice<'energy'> = {
    descriptor: descriptor(externalId, 'energy', o.name, ['production', 'consumption', 'grid', ...(batteryWh > 0 ? ['storage' as const] : [])], {
      manufacturer: 'Mock', model: 'Solar site',
    }),
    state: {
      kind: 'energy', updatedAt: 0, available: true,
      productionW: 0, consumptionW: baseLoadW, gridW: baseLoadW,
      ...(batteryWh > 0 ? { batteryW: 0, batterySoc: 60 } : {}),
      todayProductionWh: 0, todayConsumptionWh: 0,
    },
    tick(ctx) {
      const s = dev.state
      const day = Math.floor((ctx.simTime - (ctx.tzOffsetMin ?? 0) * 60_000) / 86_400_000)
      if (day !== lastDay) { lastDay = day; s.todayProductionWh = 0; s.todayConsumptionWh = 0 }
      // random appliance: ~1 event / 2 h of 1 to 2.5 kW for 20–60 min
      if (applianceLeftS <= 0 && ctx.rng() < ctx.dtS / 7200) { applianceLeftS = 1200 + ctx.rng() * 2400; applianceW = 1000 + ctx.rng() * 1500 }
      if (applianceLeftS > 0) applianceLeftS -= ctx.dtS
      const production = Math.round(ctx.world.irradiance * peakW)
      const consumption = Math.round(baseLoadW + ctx.world.loadsW + (applianceLeftS > 0 ? applianceW : 0))
      let batteryW = 0
      if (batteryWh > 0) {
        const surplus = production - consumption
        if (surplus > 0) batteryW = Math.min(surplus, batteryMaxW, ((batteryWh - batteryWhNow) / ctx.dtS) * 3600)
        else {
          const soc = batteryWhNow / batteryWh
          if (soc > 0.1) batteryW = -Math.min(-surplus, batteryMaxW, ((batteryWhNow - batteryWh * 0.1) / ctx.dtS) * 3600)
        }
        batteryW = Math.round(clamp(batteryW, -batteryMaxW, batteryMaxW))
        batteryWhNow = clamp(batteryWhNow + (batteryW * ctx.dtS) / 3600, 0, batteryWh)
        s.batteryW = batteryW
        s.batterySoc = Math.round((batteryWhNow / batteryWh) * 100)
      }
      s.productionW = production
      s.consumptionW = consumption
      s.gridW = consumption - production + batteryW
      s.todayProductionWh = Math.round((s.todayProductionWh ?? 0) + (production * ctx.dtS) / 3600)
      s.todayConsumptionWh = Math.round((s.todayConsumptionWh ?? 0) + (consumption * ctx.dtS) / 3600)
    },
  }
  return dev
}
