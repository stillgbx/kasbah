import type { SimDevice, TickCtx } from '../types'
import { descriptor } from './common'

// Water treatment station (COMAP Proteo type): a single device, like the real plugin.
// Starting readings taken on the real station (2026-09-16): wear ~95-96 %, ~412 L/1,210 L/6,980 L
// for day/week/month, flow at 0 most of the time. Alert thresholds not documented by the
// vendor (the D0xx codes remain silent): set here for the demo, not deduced from a spec.

export interface WaterOptions { name: string }

const WARNING_PCT = 20
const DEFECT_PCT = 5

/**
 * Wear of a consumable: decreases very slowly (months) then starts over, as
 * `filtrationPressure` (sawtooth) stands in for periodic cleaning — this gives, in an accelerated
 * simulation, a pass through a low wear and an alert without waiting for real months.
 * `startPct` calibrates the value at the initial instant on the real reading.
 */
function wearPct(simTime: number, periodDays: number, startPct: number): number {
  const period = periodDays * 86_400_000
  const offset = ((100 - startPct) / 100) * period
  const elapsed = (simTime + offset) % period
  return Math.round(100 - (elapsed / period) * 100)
}

export function water(externalId: string, o: WaterOptions): SimDevice<'water'> {
  // flow: real bounds (full-flow tap ~900 L/h, historical peak 2,556 L/h), quantized at the
  // flowmeter step (36 L/h) — never a continuous value
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
      // wear: different periods so as not to exhaust the 4 consumables on the same day
      s.prefilterPct = wearPct(ctx.simTime, 200, 95)
      s.carbon1Pct = wearPct(ctx.simTime, 150, 95)
      s.carbon2Pct = wearPct(ctx.simTime, 170, 95)
      s.uvLampPct = wearPct(ctx.simTime, 300, 96)
      const worst = Math.min(s.prefilterPct, s.carbon1Pct, s.carbon2Pct, s.uvLampPct)
      s.warning = worst <= WARNING_PCT
      s.defect = worst <= DEFECT_PCT
      s.uvOn = true

      // water flows in bursts, never continuously: a burst starts at random (more likely
      // during the day), lasts a few minutes, then drops back to 0; a zero time step (initial state) draws
      // nothing, the probability of an event there is nil anyway
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

      // consumption: local day/week/month, each reset to zero at its own boundary (like
      // `energySite.todayProductionWh`); the first tick adopts the current period without emptying it,
      // to keep the real reading as the starting point
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
