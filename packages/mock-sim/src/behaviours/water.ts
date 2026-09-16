import type { SimDevice, TickCtx } from '../types'
import { descriptor } from './common'

// Station de traitement d'eau (type COMAP Proteo) : un seul appareil, comme le vrai plugin.
// Relevés de départ pris sur la vraie station (2026-09-16) : usures ~95-96 %, ~412 L/1 210 L/6 980 L
// pour jour/semaine/mois, débit à 0 la plupart du temps. Seuils d'alerte non documentés par le
// fabricant (les codes D0xx restent muets) : posés ici pour la démo, pas déduits d'une spec.

export interface WaterOptions { name: string }

const WARNING_PCT = 20
const DEFECT_PCT = 5

/**
 * Usure d'un consommable : décroît très lentement (mois) puis repart à neuf, comme
 * `filtrationPressure` (sawtooth) tient lieu de nettoyage périodique — ça donne, sur une simulation
 * accélérée, un passage par une usure basse et une alerte sans attendre de vrais mois.
 * `startPct` cale la valeur à l'instant initial sur le relevé réel.
 */
function wearPct(simTime: number, periodDays: number, startPct: number): number {
  const period = periodDays * 86_400_000
  const offset = ((100 - startPct) / 100) * period
  const elapsed = (simTime + offset) % period
  return Math.round(100 - (elapsed / period) * 100)
}

export function water(externalId: string, o: WaterOptions): SimDevice<'water'> {
  // débit : bornes réelles (robinet plein débit ~900 L/h, pointe historique 2 556 L/h), quantifié au
  // pas du débitmètre (36 L/h) — jamais de valeur continue
  let flowLeftS = 0, flowTarget = 0
  let lastDay = -1, lastWeek = -1, lastMonth = -1
  const dev: SimDevice<'water'> = {
    descriptor: descriptor(externalId, 'water', o.name, ['consumables', 'water_flow', 'water_usage', 'uv_lamp'], {
      manufacturer: 'COMAP', model: 'Proteo 2',
    }),
    state: {
      kind: 'water', updatedAt: 0, available: true,
      prefilterPct: 95, carbon1Pct: 95, carbon2Pct: 95, uvLampPct: 96, uvOn: true,
      flowLph: 0, todayL: 412, weekL: 1210, monthL: 6980, warning: false, defect: false,
    },
    tick(ctx: TickCtx) {
      const s = dev.state
      // usures : périodes différentes pour ne pas épuiser les 4 consommables le même jour
      s.prefilterPct = wearPct(ctx.simTime, 200, 95)
      s.carbon1Pct = wearPct(ctx.simTime, 150, 95)
      s.carbon2Pct = wearPct(ctx.simTime, 170, 95)
      s.uvLampPct = wearPct(ctx.simTime, 300, 96)
      const worst = Math.min(s.prefilterPct, s.carbon1Pct, s.carbon2Pct, s.uvLampPct)
      s.warning = worst <= WARNING_PCT
      s.defect = worst <= DEFECT_PCT
      s.uvOn = true

      // l'eau coule par à-coups, jamais en continu : une salve démarre au hasard (plus probable le
      // jour), dure quelques minutes, puis retombe à 0 ; un pas de temps nul (état initial) ne tire
      // rien, la probabilité d'un événement y est de toute façon nulle
      if (flowLeftS > 0) {
        flowLeftS -= ctx.dtS
      } else if (ctx.dtS > 0) {
        const daytime = ctx.hour >= 7 && ctx.hour < 22
        if (ctx.rng() < (ctx.dtS / 900) * (daytime ? 1 : 0.15)) {
          flowLeftS = 20 + ctx.rng() * 280
          const peak = ctx.rng() < 0.02 ? 2556 : 216 + ctx.rng() * 900
          flowTarget = Math.round(peak / 36) * 36
        } else {
          flowTarget = 0
        }
      }
      const flow = flowLeftS > 0 ? flowTarget : 0
      s.flowLph = flow

      // consommation : jour/semaine/mois locaux, chacun remis à zéro à sa propre limite (comme
      // `energySite.todayProductionWh`) ; le premier tick adopte la période courante sans la vider,
      // pour garder le relevé réel comme point de départ
      const local = ctx.simTime - ctx.tzOffsetMin * 60_000
      const day = Math.floor(local / 86_400_000)
      const week = Math.floor((day + 4) / 7)
      const d = new Date(local)
      const month = d.getUTCFullYear() * 12 + d.getUTCMonth()
      if (lastDay === -1) lastDay = day
      else if (day !== lastDay) { lastDay = day; s.todayL = 0 }
      if (lastWeek === -1) lastWeek = week
      else if (week !== lastWeek) { lastWeek = week; s.weekL = 0 }
      if (lastMonth === -1) lastMonth = month
      else if (month !== lastMonth) { lastMonth = month; s.monthL = 0 }
      const litres = (flow * ctx.dtS) / 3600
      s.todayL = (s.todayL ?? 0) + litres
      s.weekL = (s.weekL ?? 0) + litres
      s.monthL = (s.monthL ?? 0) + litres
    },
  }
  return dev
}
