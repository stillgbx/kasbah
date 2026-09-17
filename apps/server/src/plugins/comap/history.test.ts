import { describe, expect, it } from 'vitest'
import { applyReading, DAILY_POINTS_MAX, HOURLY_POINTS_MAX, monthlyOf, readingAt, type ComapHistoryCursor } from './history'
import { EMPTY_HISTORY, type ComapHistoryState } from './state'

// Fonctions pures : pas d'horloge système, pas de fichier — un état avant, un état après. Les
// instants sont construits avec `readingAt`/`new Date(y, m-1, d, ...)`, jamais des constantes ms en
// dur, pour rester indépendants du fuseau d'exécution (voir `history.ts`).

const at = (d: number, m: number, y: number, h: number, min = 0) => readingAt({ date: [d, m, y], time: [h, min] })

describe('comap history: readingAt', () => {
  it("place la lecture à l'instant local que rtc désigne", () => {
    expect(at(16, 9, 2026, 22, 51)).toBe(new Date(2026, 8, 16, 22, 51).getTime())
  })
})

describe('comap history: applyReading — journalier', () => {
  it("la toute première lecture pose la référence et ouvre le point du jour, sans historique horaire", () => {
    const { state, cursor } = applyReading(EMPTY_HISTORY, undefined, { day: 68, at: at(17, 9, 2026, 8, 30) })
    expect(state.daily).toEqual([{ t: new Date(2026, 8, 17).getTime(), litres: 68 }])
    expect(state.hourly).toEqual([])
    expect(cursor).toEqual({ at: at(17, 9, 2026, 8, 30), day: 68 })
  })

  it('une lecture suivante, même jour : le point du jour se met à jour (day est déjà un cumul absolu)', () => {
    const first = applyReading(EMPTY_HISTORY, undefined, { day: 68, at: at(17, 9, 2026, 8, 30) })
    const second = applyReading(first.state, first.cursor, { day: 134, at: at(17, 9, 2026, 9, 0) })
    expect(second.state.daily).toEqual([{ t: new Date(2026, 8, 17).getTime(), litres: 134 }])
  })

  it('passage de minuit : un nouveau point de jour, celui de la veille reste figé à sa dernière valeur', () => {
    const evening = applyReading(EMPTY_HISTORY, undefined, { day: 412, at: at(16, 9, 2026, 23, 50) })
    const afterMidnight = applyReading(evening.state, evening.cursor, { day: 7, at: at(17, 9, 2026, 0, 5) })
    expect(afterMidnight.state.daily).toEqual([
      { t: new Date(2026, 8, 16).getTime(), litres: 412 },
      { t: new Date(2026, 8, 17).getTime(), litres: 7 },
    ])
  })

  it('borne à 62 points, en perdant les plus anciens', () => {
    let history: ComapHistoryState = EMPTY_HISTORY
    let cursor: ComapHistoryCursor | undefined
    for (let day = 1; day <= DAILY_POINTS_MAX + 5; day++) {
      const applied = applyReading(history, cursor, { day: 10, at: at(1, 1, 2026 + day, 12, 0) })
      history = applied.state
      cursor = applied.cursor
    }
    expect(history.daily).toHaveLength(DAILY_POINTS_MAX)
    expect(history.daily[0]!.t).toBe(new Date(2032, 0, 1).getTime()) // les 5 premières années sont tombées
  })
})

describe('comap history: applyReading — horaire', () => {
  it('deux lectures dans la même heure : le delta s\'accumule dans le point ouvert', () => {
    const first = applyReading(EMPTY_HISTORY, undefined, { day: 100, at: at(17, 9, 2026, 8, 10) })
    const second = applyReading(first.state, first.cursor, { day: 106, at: at(17, 9, 2026, 8, 40) })
    expect(second.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 8).getTime(), litres: 6 }])
    const third = applyReading(second.state, second.cursor, { day: 110, at: at(17, 9, 2026, 8, 55) })
    expect(third.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 8).getTime(), litres: 10 }])
  })

  it("changement d'heure : le delta qui chevauche est crédité en entier à l'heure qui s'ouvre", () => {
    const h8 = applyReading(EMPTY_HISTORY, undefined, { day: 96, at: at(17, 9, 2026, 8, 10) })
    const h8b = applyReading(h8.state, h8.cursor, { day: 100, at: at(17, 9, 2026, 8, 55) })
    const h9 = applyReading(h8b.state, h8b.cursor, { day: 104, at: at(17, 9, 2026, 9, 2) })
    expect(h9.state.hourly).toEqual([
      { t: new Date(2026, 8, 17, 8).getTime(), litres: 4 },  // le delta 96->100, entièrement DANS l'heure 8-9
      { t: new Date(2026, 8, 17, 9).getTime(), litres: 4 },  // le delta 100->104 chevauche 8h55-9h02, crédité à 9h
    ])
  })

  it("la toute première lecture d'une heure ne produit aucun point : pas de precedent pour savoir ce qui a été consommé avant elle", () => {
    const first = applyReading(EMPTY_HISTORY, undefined, { day: 100, at: at(17, 9, 2026, 8, 55) })
    const second = applyReading(first.state, first.cursor, { day: 104, at: at(17, 9, 2026, 9, 2) })
    // l'heure 8h-9h n'a reçu qu'une seule lecture (la toute première, sans précédent) : elle est ABSENTE
    expect(second.state.hourly.some((p) => p.t === new Date(2026, 8, 17, 8).getTime())).toBe(false)
    expect(second.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 9).getTime(), litres: 4 }])
  })

  it('passage de minuit : le delta de la nouvelle heure est le cumul du nouveau jour, jamais un négatif', () => {
    const evening = applyReading(EMPTY_HISTORY, undefined, { day: 412, at: at(16, 9, 2026, 23, 50) })
    const afterMidnight = applyReading(evening.state, evening.cursor, { day: 7, at: at(17, 9, 2026, 0, 5) })
    const midnightHour = afterMidnight.state.hourly.find((p) => p.t === new Date(2026, 8, 17, 0).getTime())
    expect(midnightHour).toEqual({ t: new Date(2026, 8, 17, 0).getTime(), litres: 7 })
    expect(afterMidnight.state.hourly.every((p) => p.litres >= 0)).toBe(true)
  })

  it("trou de plus d'une heure entre deux lectures : l'heure de reprise repart de zéro, pas de pic inventé", () => {
    const before = applyReading(EMPTY_HISTORY, undefined, { day: 50, at: at(17, 9, 2026, 8, 0) })
    // le serveur (ou la station) est resté injoignable de 8h à 11h : 30 L consommés dans l'intervalle
    const after = applyReading(before.state, before.cursor, { day: 80, at: at(17, 9, 2026, 11, 5) })
    expect(after.state.hourly).toEqual([{ t: new Date(2026, 8, 17, 11).getTime(), litres: 0 }])
    // les heures 8h, 9h, 10h restent ABSENTES : jamais un zéro qui affirmerait « rien consommé »
    expect(after.state.hourly.some((p) => p.t === new Date(2026, 8, 17, 8).getTime())).toBe(false)
  })

  it("l'heure suivante après un trou repart normalement (le curseur a bien été remis à jour)", () => {
    const before = applyReading(EMPTY_HISTORY, undefined, { day: 50, at: at(17, 9, 2026, 8, 0) })
    const gap = applyReading(before.state, before.cursor, { day: 80, at: at(17, 9, 2026, 11, 5) })
    const next = applyReading(gap.state, gap.cursor, { day: 85, at: at(17, 9, 2026, 11, 20) })
    expect(next.state.hourly.find((p) => p.t === new Date(2026, 8, 17, 11).getTime())).toEqual({ t: new Date(2026, 8, 17, 11).getTime(), litres: 5 })
  })

  it('borne à 48 points, en perdant les plus anciennes heures', () => {
    let history: ComapHistoryState = EMPTY_HISTORY
    let cursor: ComapHistoryCursor | undefined
    for (let h = 0; h < HOURLY_POINTS_MAX + 5; h++) {
      const applied = applyReading(history, cursor, { day: h, at: at(17, 9, 2026, h % 24, 30) + Math.floor(h / 24) * 86_400_000 })
      history = applied.state
      cursor = applied.cursor
    }
    expect(history.hourly).toHaveLength(HOURLY_POINTS_MAX)
  })
})

describe('comap history: monthlyOf', () => {
  it('le mois en cours vient de `month`, jamais de `year` (qui y vaut 0 tant qu\'il n\'est pas clos)', () => {
    const rtc = { date: [17, 9, 2026] as const }
    const year = [10500, 9800, 10200, 11900, 10400, 10100, 11600, 7500, 0, 0, 0, 0]
    const points = monthlyOf(rtc, 7545, year)
    expect(points).toHaveLength(9) // janvier à septembre, index 0 à 8
    expect(points[8]).toEqual({ t: new Date(2026, 8, 1).getTime(), litres: 7545 })
    expect(points[0]).toEqual({ t: new Date(2026, 0, 1).getTime(), litres: 10500 })
  })

  it('les mois pas encore commencés restent absents, pas à zéro', () => {
    const rtc = { date: [1, 2, 2026] as const } // février : un seul mois clos avant le courant
    const points = monthlyOf(rtc, 500, [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(points).toEqual([
      { t: new Date(2026, 0, 1).getTime(), litres: 1000 },
      { t: new Date(2026, 1, 1).getTime(), litres: 500 },
    ])
  })
})
