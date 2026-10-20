import { SimError } from '../types'
import type { SimDevice, TickCtx } from '../types'
import { descriptor } from './common'

// Feeder and fountain for pets (PetKit type). Two kinds, a single file: they live in the
// same place in the house and are read together.
//
// What is simulated here is what the CONTRACT carries, not what the vendor exposes: the meal
// plan, the history and the videos are not part of it.
//
// The FEEDER is calibrated on the 2026-09-21 capture: it publishes neither what was eaten (no
// weighing tray) nor a battery level (mains-powered machine, no batteries) — simulating what the
// real machine does not say would give a card that could not be verified at home.
//
// The FOUNTAIN counts VISITS and their duration, like the real one: an Eversweet Max measures
// no volume (it returns -1 for the water dispensed) but keeps a log of its visits.

/** Portions of a Fresh Element Solo, in TENTHS OF A CUP — its unit, not grams. */
export const FEEDER_PORTIONS = [1, 2, 3, 4, 5]

export interface PetFeederOptions {
  name: string
  /** Local hours of the scheduled meals. */
  mealHours?: number[]
  /** Portion of a scheduled meal, in the device's unit (tenths of a cup). */
  meal?: number
}

export function petFeeder(externalId: string, o: PetFeederOptions): SimDevice<'pet_feeder'> {
  const mealHours = o.mealHours ?? [7, 19]
  const meal = o.meal ?? 2
  // The hopper empties in a few weeks then refills: without this, `foodLow` would never be
  // verified in the simulation (the same reasoning as the wear of the consumables
  // of the water station, which starts over to be observable).
  let hopper = 120
  let feedingLeftS = 0
  let servedHour = -1
  let lastDay = -1

  const dev: SimDevice<'pet_feeder'> = {
    descriptor: descriptor(externalId, 'pet_feeder', o.name, ['feed', 'call_pet', 'consumables', 'battery'], {
      manufacturer: 'PetKit', model: 'Fresh Element Solo', petFeeder: { portions: FEEDER_PORTIONS, unit: 'cup' },
    }),
    state: {
      // Calibrated on the REAL machine (capture of Sep 21): no `eatenTodayG` — a Fresh Element
      // Solo has no weighing tray — and no `batteryPct`, the device runs on mains without
      // batteries. Simulating what the machine does not say would make the card unverifiable here.
      kind: 'pet_feeder', updatedAt: 0, available: true,
      foodLow: false, feeding: false, servedToday: 0, plannedToday: 0, desiccantDays: 21,
    },
    tick(ctx: TickCtx) {
      const s = dev.state
      const local = ctx.simTime - ctx.tzOffsetMin * 60_000
      const day = Math.floor(local / 86_400_000)
      if (lastDay === -1) lastDay = day
      else if (day !== lastDay) {
        lastDay = day
        s.servedToday = 0
        s.plannedToday = mealHours.length * meal
        servedHour = -1
        s.desiccantDays = Math.max(0, (s.desiccantDays ?? 0) - 1)
        // pouch replaced when it is used up: the house does not stay in alert forever
        if (s.desiccantDays === 0) s.desiccantDays = 30
      }

      // scheduled meal: once per meal hour and per day
      const hour = Math.floor(ctx.hour)
      if (mealHours.includes(hour) && servedHour !== hour) { servedHour = hour; serve(meal) }

      if (feedingLeftS > 0) { feedingLeftS -= ctx.dtS; s.feeding = feedingLeftS > 0 }

      if (s.plannedToday === 0) s.plannedToday = mealHours.length * meal
      // The next meal of the day, if one is left: it is what the card announces at the top.
      const nextHour = mealHours.find((h) => h > ctx.hour)
      const midnight = ctx.simTime - ctx.hour * 3_600_000
      s.nextMealAt = nextHour === undefined ? undefined : Math.round(midnight + nextHour * 3_600_000)
      s.nextMealAmount = nextHour === undefined ? undefined : meal

      s.foodLow = hopper < 15
      if (hopper <= 0) hopper = 120
    },
    apply(cmd) {
      switch (cmd.type) {
        case 'pet_feeder.feed': serve(cmd.amount); break
        // the sound is played, nothing changes in the state: it is a gesture, not a setting
        case 'pet_feeder.call_pet': break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on pet_feeder`)
      }
    },
  }

  function serve(amount: number): void {
    const s = dev.state
    const given = Math.min(amount, Math.max(0, hopper))
    hopper -= given
    s.servedToday = (s.servedToday ?? 0) + given
    s.feeding = true
    feedingLeftS = 8
  }

  return dev
}

export interface PetFountainOptions {
  name: string
  /** Visits of the animal in a day, spread over the waking hours. */
  dailyDrinks?: number
}

export function petFountain(externalId: string, o: PetFountainOptions): SimDevice<'pet_fountain'> {
  const dailyDrinks = o.dailyDrinks ?? 8
  let lastDay = -1
  // The real device is read through a Bluetooth relay every ten minutes: the simulation reproduces
  // that RHYTHM, not only the values. Without it, `syncedAt` would always stay fresh and the
  // "read … ago" line of the card could never be verified.
  const SYNC_EVERY_MS = 600_000
  let syncedAt = 0

  const dev: SimDevice<'pet_fountain'> = {
    descriptor: descriptor(externalId, 'pet_fountain', o.name, ['on_off', 'pump_mode', 'consumables', 'battery', 'water_usage'], {
      manufacturer: 'PetKit', model: 'Eversweet Max',
    }),
    state: {
      kind: 'pet_fountain', updatedAt: 0, available: true,
      on: true, mode: 'intermittent', filterPct: 78, filterDays: 23, waterLow: false, batteryPct: 64,
      drinksToday: 0, drinkAvgS: 0, syncedAt: 0,
    },
    tick(ctx: TickCtx) {
      const s = dev.state
      const local = ctx.simTime - ctx.tzOffsetMin * 60_000
      const day = Math.floor(local / 86_400_000)
      if (lastDay === -1) lastDay = day
      else if (day !== lastDay) {
        lastDay = day
        s.drinksToday = 0
        s.drinkAvgS = 0
        s.filterDays = Math.max(0, (s.filterDays ?? 0) - 1)
        s.filterPct = Math.max(0, Math.round((s.filterPct ?? 0) - 100 / 30))
        if (s.filterPct === 0) { s.filterPct = 100; s.filterDays = 30 }
      }

      if (ctx.simTime - syncedAt >= SYNC_EVERY_MS) { syncedAt = ctx.simTime; s.syncedAt = syncedAt }

      // the cat drinks during the day; with the pump stopped, it no longer comes to the fountain
      if (s.on && ctx.dtS > 0) {
        const awake = ctx.hour >= 6 && ctx.hour < 23
        if (awake && ctx.rng() < (ctx.dtS / (17 * 3600)) * dailyDrinks) {
          s.drinksToday = (s.drinksToday ?? 0) + 1
          s.drinkAvgS = Math.round(20 + ctx.rng() * 60)
        }
        // in intermittent cycle the pump sleeps between two runs: the battery lasts much longer
        // than in continuous, which is precisely the argument for the mode
        const drainPerDay = s.mode === 'intermittent' ? 3 : 12
        s.batteryPct = Math.max(0, (s.batteryPct ?? 0) - (drainPerDay / 86_400) * ctx.dtS)
        if (s.batteryPct === 0) s.batteryPct = 100
      }
      s.waterLow = (s.drinksToday ?? 0) > dailyDrinks * 3
    },
    apply(cmd) {
      const s = dev.state
      switch (cmd.type) {
        case 'pet_fountain.set_power': s.on = cmd.on; break
        case 'pet_fountain.set_mode': s.mode = cmd.mode; break
        default: throw new SimError('UNSUPPORTED_COMMAND', `${cmd.type} on pet_fountain`)
      }
    },
  }
  return dev
}
