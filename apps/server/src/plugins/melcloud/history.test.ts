import { describe, expect, it } from 'vitest'
import { HOURLY_POINTS_MAX, HeatingHistory } from './history'
import type { SystemReading, ZoneReading } from './types'

// L'historique est CONSTRUIT ici, faute de compteur chez le fabricant. Ce qu'il doit tenir :
//
//  - compter la CHAUFFE, pas l'allumage. Une Ecodan est `Power: true` presque toute l'année ; c'est
//    `idle` qui distingue une heure de chauffe d'une heure de veille, et se tromper là tracerait
//    une ligne plate de janvier à décembre.
//  - dire l'échelle de chaque heure (`n`) : une heure à trois échantillons ne doit pas passer pour
//    une heure creuse.
//  - ne rien inventer quand la machine est hors ligne.

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 0, 15, 8)

const system = (over: Partial<SystemReading> = {}): SystemReading => ({
  deviceId: '1', name: 'Chauffage', power: true, offline: false, stale: false,
  outdoorTempC: 4, flowTempC: 38, returnTempC: 33, condensingTempC: 42, demandPercent: 100,
  defrosting: false, boosterHeater: false, immersionHeater: false, pumps: [true, false, false, false], valve3Way: false,
  error: { hasError: false, code: 8000, message: null },
  lastSeen: null, wifi: 'NORMAL', energyMeter: false,
  ...over,
})

const zone = (idle: boolean): ZoneReading => ({
  zone: 1, control: 'room', currentTempC: 19, targetTempC: 19.5,
  idle, heating: true, cooling: false, bounds: [0, 40], name: null,
})

describe('MELCloud — historique de fonctionnement', () => {
  it('range les échantillons par heure et bascule à l’heure pleine', () => {
    const h = new HeatingHistory()
    expect(h.record(system(), [zone(false)], T0)).toBe(true)           // ouvre l'heure
    expect(h.record(system(), [zone(false)], T0 + 120_000)).toBe(false)
    expect(h.record(system(), [zone(false)], T0 + HOUR)).toBe(true)    // heure suivante
    const pts = h.points()
    expect(pts).toHaveLength(2)
    expect(pts[0]).toMatchObject({ t: T0, n: 2, heating: 2 })
    expect(pts[1]).toMatchObject({ t: T0 + HOUR, n: 1 })
  })

  /** LE point du fichier : allumée ≠ en train de chauffer. */
  it('compte la chauffe, pas l’allumage', () => {
    const h = new HeatingHistory()
    h.record(system(), [zone(true)], T0)                  // allumée, au repos
    h.record(system(), [zone(false)], T0 + 60_000)        // allumée, elle chauffe
    h.record(system({ power: false }), [zone(false)], T0 + 120_000)   // éteinte
    expect(h.points()[0]).toMatchObject({ n: 3, heating: 1 })
  })

  it('compte séparément le dégivrage et les appoints électriques', () => {
    const h = new HeatingHistory()
    h.record(system({ defrosting: true }), [zone(false)], T0)
    h.record(system({ immersionHeater: true }), [zone(false)], T0 + 60_000)
    h.record(system({ boosterHeater: true }), [zone(false)], T0 + 120_000)
    expect(h.points()[0]).toMatchObject({ n: 3, defrost: 1, booster: 2 })
  })

  it('moyenne les températures de l’heure', () => {
    const h = new HeatingHistory()
    h.record(system({ outdoorTempC: 2, flowTempC: 30 }), [zone(false)], T0)
    h.record(system({ outdoorTempC: 5, flowTempC: 35 }), [zone(false)], T0 + 60_000)
    expect(h.points()[0]).toMatchObject({ outdoorC: 3.5, flowC: 32.5 })
  })

  it('rend null une température que la machine n’a jamais donnée', () => {
    const h = new HeatingHistory()
    h.record(system({ outdoorTempC: null }), [zone(false)], T0)
    expect(h.points()[0]!.outdoorC).toBeNull()
  })

  /** Une machine muette ne doit pas creuser un trou qui ressemble à une heure sans chauffage. */
  it('n’ouvre pas d’heure pour une machine qu’on ne suit plus', () => {
    const h = new HeatingHistory()
    h.record(system({ stale: true }), [zone(false)], T0)
    expect(h.points()).toEqual([])
    h.record(system(), [zone(false)], T0)
    h.record(system({ stale: true }), [zone(false)], T0 + 60_000)
    expect(h.points()[0]).toMatchObject({ n: 1 })   // l'échantillon muet n'est pas compté
  })

  /**
   * `offline` est le drapeau du fabricant, et il ment (voir `mapping.ts`). L'historique ne doit pas
   * se creuser un trou parce que MELCloud a coché une case pendant que la machine parlait.
   */
  it('continue d’enregistrer une machine que le fabricant dit « offline » à tort', () => {
    const h = new HeatingHistory()
    h.record(system({ offline: true, stale: false }), [zone(false)], T0)
    expect(h.points()[0]).toMatchObject({ n: 1, heating: 1 })
  })

  it('ne garde qu’une semaine d’heures', () => {
    const h = new HeatingHistory()
    for (let i = 0; i < HOURLY_POINTS_MAX + 20; i++) h.record(system(), [zone(false)], T0 + i * HOUR)
    const pts = h.points()
    expect(pts).toHaveLength(HOURLY_POINTS_MAX)
    expect(pts[0]!.t).toBe(T0 + 20 * HOUR)   // les plus vieilles sont parties
  })

  it('se relit depuis le disque sans perdre ce qui y était', () => {
    const h = new HeatingHistory()
    h.record(system(), [zone(false)], T0)
    h.record(system(), [zone(true)], T0 + 60_000)
    const again = new HeatingHistory(h.toState())
    expect(again.points()).toEqual(h.points())
    // et l'heure en cours continue de s'accumuler après la relecture
    again.record(system(), [zone(false)], T0 + 120_000)
    expect(again.points()[0]).toMatchObject({ n: 3, heating: 2 })
  })
})
