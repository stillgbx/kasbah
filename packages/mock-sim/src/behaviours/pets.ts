import { SimError } from '../types'
import type { SimDevice, TickCtx } from '../types'
import { descriptor } from './common'

// Mangeoire et fontaine pour animaux (type PetKit). Deux kinds, un seul fichier : ils vivent au
// même endroit de la maison et se lisent ensemble.
//
// Ce qui est simulé ici est ce que le CONTRAT porte, pas ce que le fabricant expose : le plan de
// repas, l'historique et les vidéos n'en font pas partie.
//
// La MANGEOIRE est calée sur la capture du 2026-09-21 : elle ne publie ni le mangé (pas de plateau
// pesant) ni une charge de batterie (machine au secteur, sans piles) — simuler ce que la vraie
// machine tait donnerait une carte qu'on ne pourrait pas vérifier chez soi.
//
// La FONTAINE compte des PASSAGES et leur durée, comme la vraie : une Eversweet Max ne mesure
// aucun volume (elle rend -1 pour l'eau distribuée) mais tient le registre de ses visites.

/** Rations d'une Fresh Element Solo, en DIXIÈMES DE TASSE — son unité, pas des grammes. */
export const FEEDER_PORTIONS = [1, 2, 3, 4, 5]

export interface PetFeederOptions {
  name: string
  /** Heures locales des repas programmés. */
  mealHours?: number[]
  /** Ration d'un repas programmé, dans l'unité de l'appareil (dixièmes de tasse). */
  meal?: number
}

export function petFeeder(externalId: string, o: PetFeederOptions): SimDevice<'pet_feeder'> {
  const mealHours = o.mealHours ?? [7, 19]
  const meal = o.meal ?? 2
  // La trémie se vide en quelques semaines puis se regarnit : sans cela, `foodLow` ne se
  // vérifierait jamais dans la simulation (le même raisonnement que l'usure des consommables
  // de la station d'eau, qui repart à neuf pour être observable).
  let hopper = 120
  let feedingLeftS = 0
  let servedHour = -1
  let lastDay = -1

  const dev: SimDevice<'pet_feeder'> = {
    descriptor: descriptor(externalId, 'pet_feeder', o.name, ['feed', 'call_pet', 'consumables', 'battery'], {
      manufacturer: 'PetKit', model: 'Fresh Element Solo', petFeeder: { portions: FEEDER_PORTIONS, unit: 'cup' },
    }),
    state: {
      // Calé sur la VRAIE machine (capture du 21/09) : pas de `eatenTodayG` — une Fresh Element
      // Solo n'a pas de plateau pesant — et pas de `batteryPct`, l'appareil vit au secteur sans
      // piles. Simuler ce que la machine ne dit pas rendrait la carte invérifiable ici.
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
        // sachet remplacé quand il est à bout : la maison ne reste pas éternellement en alerte
        if (s.desiccantDays === 0) s.desiccantDays = 30
      }

      // repas programmé : une fois par heure de repas et par jour
      const hour = Math.floor(ctx.hour)
      if (mealHours.includes(hour) && servedHour !== hour) { servedHour = hour; serve(meal) }

      if (feedingLeftS > 0) { feedingLeftS -= ctx.dtS; s.feeding = feedingLeftS > 0 }

      if (s.plannedToday === 0) s.plannedToday = mealHours.length * meal
      // Le prochain repas du jour, s'il en reste un : c'est ce que la carte annonce en tête.
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
        // le son est joué, rien ne change dans l'état : c'est un geste, pas un réglage
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
  /** Passages de l'animal dans une journée, répartis sur les heures d'éveil. */
  dailyDrinks?: number
}

export function petFountain(externalId: string, o: PetFountainOptions): SimDevice<'pet_fountain'> {
  const dailyDrinks = o.dailyDrinks ?? 8
  let lastDay = -1
  // Le vrai appareil est lu par relais Bluetooth toutes les dix minutes : la simulation reproduit
  // ce RYTHME, pas seulement les valeurs. Sans cela, `syncedAt` resterait toujours frais et la
  // ligne « relevé il y a … » de la carte ne serait jamais vérifiable.
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

      // le chat boit le jour ; pompe à l'arrêt, il ne vient plus à la fontaine
      if (s.on && ctx.dtS > 0) {
        const awake = ctx.hour >= 6 && ctx.hour < 23
        if (awake && ctx.rng() < (ctx.dtS / (17 * 3600)) * dailyDrinks) {
          s.drinksToday = (s.drinksToday ?? 0) + 1
          s.drinkAvgS = Math.round(20 + ctx.rng() * 60)
        }
        // en cycle intermittent la pompe dort entre deux marches : la batterie tient bien plus
        // longtemps qu'en continu, ce qui est justement l'argument du mode
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
