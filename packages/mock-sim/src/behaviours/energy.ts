import type { EnergyDay } from '@kasbah/shared'
import type { SimDevice, SimEnergyDays } from '../types'
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
    descriptor: descriptor(externalId, 'energy', o.name, ['production', 'consumption', 'grid', ...(batteryWh > 0 ? ['storage' as const] : []), 'energy_history'], {
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
    energyDays: (ctx) => simulatedDays(ctx.simTime, peakW, batteryWh),
  }
  return dev
}

/** How many days of history the simulated site has: a little over a year, for the lifetime view. */
const SIM_HISTORY_DAYS = 420

/** Stable pseudo-random in [0, 1) for a day: the same day gives the same weather on every call. */
const noise = (i: number, salt: number) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x) }

/**
 * Plausible daily totals, fabricated on the fly like the water history of the in-process mock:
 * production follows the season (≈ 1.2 kWh per kWp a day in December, ≈ 5 in June) and a cloud
 * cover that changes from day to day, consumption is higher in winter, the charger runs every few
 * days, and the house is split between the sun, the battery and the grid as a real site would be.
 * Today stops at the current hour; the rest of the series is complete.
 */
export function simulatedDays(now: number, peakW: number, batteryWh: number): SimEnergyDays {
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const elapsed = Math.min(1, (now - today.getTime()) / 86_400_000)
  const days: EnergyDay[] = []
  for (let back = SIM_HISTORY_DAYS; back >= 0; back--) {
    const d = new Date(today); d.setDate(d.getDate() - back)
    const i = Math.floor(d.getTime() / 86_400_000)
    const share = back === 0 ? elapsed : 1
    // 0 in mid-December, 1 in mid-June
    const season = (1 - Math.cos(((d.getMonth() + d.getDate() / 31 + 0.5) / 12) * 2 * Math.PI)) / 2
    const sky = 0.35 + 0.65 * noise(i, 1)
    const production = (peakW / 1000) * (1.2 + 3.8 * season) * sky * 1000 * share
    const evse = noise(i, 2) < 0.3 ? (6000 + 9000 * noise(i, 3)) * share : 0
    const consumption = (11_000 + 9000 * (1 - season) + 3000 * noise(i, 4)) * share + evse
    const solarHome = Math.min(production * 0.55, consumption * 0.7)
    const charge = batteryWh > 0 ? Math.min(batteryWh * 0.9 * share, (production - solarHome) * 0.6) : 0
    // the battery gives back what it took, but never more than the house still needs
    const discharge = Math.min(charge * 0.92, consumption - solarHome)
    const gridHome = Math.max(0, consumption - solarHome - discharge)
    const r = Math.round
    days.push({
      t: d.getTime(), source: 'vendor',
      productionWh: r(production), consumptionWh: r(consumption),
      importWh: r(gridHome), exportWh: r(Math.max(0, production - solarHome - charge)),
      ...(batteryWh > 0 ? { chargeWh: r(charge), dischargeWh: r(discharge), batteryHomeWh: r(discharge) } : {}),
      solarHomeWh: r(solarHome), gridHomeWh: r(gridHome), evseWh: r(evse),
    })
    if (back === 0) days[days.length - 1]!.source = 'local'
  }
  return { since: days[0]!.t, syncedAt: today.getTime(), days }
}
