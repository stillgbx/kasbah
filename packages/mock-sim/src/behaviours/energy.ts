import type { SimDevice } from '../types'
import { clamp, descriptor } from './common'
import { sensor } from './sensor'

export interface PanelOptions {
  name: string
  /** Puissance crête du module (W). */
  peakW?: number
  /** Rendement relatif du module (orientation, salissure) : 1 = plein rendement. */
  factor?: number
  /** Heure locale à partir de laquelle un obstacle ombre le module (cheminée, arbre). */
  shadeFrom?: number
}

/**
 * Module photovoltaïque avec son micro-onduleur : un capteur de puissance (W) qui suit
 * l'ensoleillement, module par module, pour qu'un champ de panneaux ait quelque chose à colorer.
 */
export function solarPanel(externalId: string, o: PanelOptions): SimDevice<'sensor'> {
  const peakW = o.peakW ?? 400, factor = o.factor ?? 1
  // `partOf: 'energy'` : un panneau est un capteur de puissance, mais il appartient à l'installation
  // solaire — exclure `energy` pour un vrai parc Enphase doit l'emporter avec elle.
  return Object.assign(sensor(externalId, {
    name: o.name, unit: 'W', deviceClass: 'power', precision: 0, initial: 0, tauS: 20, noise: 2,
    target: (ctx) => {
      const shade = o.shadeFrom !== undefined && ctx.hour >= o.shadeFrom ? 0.25 : 1
      return Math.max(0, ctx.world.irradiance * peakW * factor * shade)
    },
  }), { partOf: 'energy' as const })
}

export interface EnergyOptions {
  name: string
  /** Puissance crête PV (W). */
  peakW?: number
  /** Capacité batterie (Wh) ; 0 = pas de batterie. */
  batteryWh?: number
  batteryMaxW?: number
  /** Consommation de base de la maison (veilles, frigo…) en W. */
  baseLoadW?: number
}

/**
 * Site énergie (type Enphase) : production = ensoleillement × crête ; consommation = base + charges
 * déclarées par les autres appareils ce tick (le site doit donc être TICKÉ EN DERNIER) ;
 * la batterie absorbe le surplus le jour et se décharge la nuit jusqu'à 10 %.
 * Identité maintenue à chaque tick : gridW = consumptionW − productionW + batteryW.
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
      // électroménager aléatoire : ~1 événement / 2 h de 1 à 2,5 kW pendant 20–60 min
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
