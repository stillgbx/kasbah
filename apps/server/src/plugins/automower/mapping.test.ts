import { describe, expect, it } from 'vitest'
import { MOWERS_ERROR, MOWERS_MOWING, MOWERS_OFFLINE, MOWERS_PARKED, MOWER_ID, WS_BATTERY, WS_CUTTING_HEIGHT, WS_MOWER, WS_PLANNER, WS_POSITION } from './__fixtures__/automower'
import { actionBody, applyEvent, connectedOf, localTimestamp, parseMowers, toActivity, toDescriptor, toStatePatch } from './mapping'
import { wsEventSchema } from './types'

// Le mappage est pur : les fixtures (provisoires, d'après la documentation) suffisent à le tenir.

const TZ = 'Europe/Paris'
const NOW = Date.UTC(2026, 8, 16, 12)
const first = (list: unknown) => parseMowers(list)[0]!

describe('automower mapping — descripteur', () => {
  it('un robot = un appareil mower, nommé par le fabricant, identifié par son UUID', () => {
    const d = toDescriptor(first(MOWERS_ERROR))
    expect(d).toMatchObject({ id: `automower:${MOWER_ID}`, pluginId: 'automower', externalId: MOWER_ID, kind: 'mower', name: 'Tondeuse' })
    expect(d.capabilities).toEqual(['mow', 'park', 'battery', 'schedule'])
    expect(d.meta).toEqual({ manufacturer: 'Husqvarna', model: 'Husqvarna Automower® 435X AWD' })
  })

  it('une entrée à la forme inattendue est écartée, les autres survivent', () => {
    const list = { data: [{ id: 42 }, MOWERS_ERROR.data[0]] }
    expect(parseMowers(list)).toHaveLength(1)
  })
})

describe('automower mapping — activité', () => {
  it('l’erreur prime sur l’activité déclarée', () => {
    expect(toActivity({ activity: 'PARKED_IN_CS', state: 'ERROR' })).toBe('error')
    expect(toActivity({ activity: 'MOWING', state: 'FATAL_ERROR' })).toBe('error')
  })
  it('les activités du fabricant, en toute casse', () => {
    expect(toActivity({ activity: 'MOWING', state: 'IN_OPERATION' })).toBe('mowing')
    expect(toActivity({ activity: 'leaving', state: 'in_operation' })).toBe('mowing')
    expect(toActivity({ activity: 'GOING_HOME', state: 'IN_OPERATION' })).toBe('returning')
    expect(toActivity({ activity: 'CHARGING', state: 'RESTRICTED' })).toBe('charging')
    expect(toActivity({ activity: 'PARKED_IN_CS', state: 'RESTRICTED' })).toBe('parked')
    expect(toActivity({ activity: 'STOPPED_IN_GARDEN', state: 'STOPPED' })).toBe('stopped')
    expect(toActivity({ activity: 'MOWING', state: 'PAUSED' })).toBe('paused')
    expect(toActivity({ activity: 'UNKNOWN', state: 'OFF' })).toBe('stopped')
    expect(toActivity({ activity: 'UNKNOWN', state: 'UNKNOWN' })).toBe('parked')
    expect(toActivity(null)).toBe('parked')
  })
})

describe('automower mapping — horodatages locaux', () => {
  it('ramène l’heure murale du robot à l’instant vrai, heure d’été comprise', () => {
    // 2026-09-15 18:42:10 mur, à Paris en septembre (UTC+2) → 16:42:10 UTC
    expect(localTimestamp(Date.UTC(2026, 8, 15, 18, 42, 10), TZ)).toBe(Date.UTC(2026, 8, 15, 16, 42, 10))
    // en janvier (UTC+1)
    expect(localTimestamp(Date.UTC(2026, 0, 10, 9), TZ)).toBe(Date.UTC(2026, 0, 10, 8))
  })
  it('accepte des secondes sur un vieux firmware, et un fuseau inconnu vaut UTC', () => {
    expect(localTimestamp(1789497730, TZ)).toBe(Date.UTC(2026, 8, 15, 16, 42, 10))
    expect(localTimestamp(Date.UTC(2026, 8, 15, 18), 'Mars/Olympus')).toBe(Date.UTC(2026, 8, 15, 18))
  })
})

describe('automower mapping — état complet', () => {
  it('la CAPTURE : garé, retenu par son planning jusqu’à demain 10 h locales, statut en vrai UTC, position à la station', () => {
    const m = first(MOWERS_PARKED)
    const p = toStatePatch(m, { tz: TZ, now: NOW })
    expect(p.activity).toBe('parked')
    expect(p.battery).toBe(100)
    expect(p.errorCode).toBeNull()
    expect(p.restrictedReason).toBe('week_schedule')
    // 1789639200000 se lit 10:00 « UTC » : c'est 10 h LOCALES (le créneau du calendrier commence à 600 min), soit 08:00 UTC
    expect(p.nextStartAt).toBe(Date.UTC(2026, 8, 17, 8))
    expect(p.statusAt).toBe(1789570593758)
    const [head] = m.attributes.positions as { latitude: number; longitude: number }[]
    expect(p.location).toEqual({ lat: head!.latitude, lon: head!.longitude, at: 1789570593758 })
    expect(p.cuttingHeight).toBe(7)
    expect(p.statistics).toMatchObject({ cuttingTimeS: 14000000, chargingCycles: 45, collisions: 9500, driveDistanceM: 9000000 })
  })

  it('robot en erreur de boucle : code, texte du fabricant, date locale ramenée en UTC, pas de prochain départ', () => {
    const p = toStatePatch(first(MOWERS_ERROR), { tz: TZ, now: NOW })
    expect(p.activity).toBe('error')
    expect(p.battery).toBe(100)
    expect(p.errorCode).toBe(2)
    expect(p.errorMessage).toBe('No loop signal')
    expect(p.errorAt).toBe(Date.UTC(2026, 8, 15, 16, 42, 10))
    expect(p.nextStartAt).toBeNull()
    expect(p.restrictedReason).toBe('not_applicable')
    expect(p.cuttingHeight).toBe(7)
    expect(p.statusAt).toBe(1789452130000)
    // la position la plus récente est en tête, datée du dernier statut reçu
    expect(p.location).toMatchObject({ at: 1789452130000 })
    expect(p.statistics).toEqual({
      cuttingTimeS: 14000000, chargingTimeS: 3000000, runningTimeS: 15500000, searchingTimeS: 900000,
      bladeUsageTimeS: 800000, chargingCycles: 45, collisions: 9500, driveDistanceM: 9000000,
    })
    expect(connectedOf(first(MOWERS_ERROR))).toBe(true)
  })

  it('robot en tonte : l’erreur est EFFACÉE (null), le prochain départ est un vrai instant', () => {
    const p = toStatePatch(first(MOWERS_MOWING), { tz: TZ, now: NOW })
    expect(p.activity).toBe('mowing')
    expect(p.battery).toBe(83)
    expect(p.errorCode).toBeNull()
    expect(p.errorMessage).toBeNull()
    expect(p.errorAt).toBeNull()
    // 2026-09-17 10:00 mur à Paris → 08:00 UTC
    expect(p.nextStartAt).toBe(Date.UTC(2026, 8, 17, 8))
    expect(p.restrictedReason).toBe('none')
  })

  it('robot hors ligne : l’état se lit quand même, et `connected` dit qu’il ne parle plus', () => {
    const m = first(MOWERS_OFFLINE)
    expect(toStatePatch(m, { tz: TZ, now: NOW })).toMatchObject({ activity: 'parked', restrictedReason: 'week_schedule' })
    expect(connectedOf(m)).toBe(false)
  })
})

describe('automower mapping — événements du flux', () => {
  const ev = (raw: unknown) => wsEventSchema.parse(raw)
  const o = { tz: TZ, now: NOW }
  it('position → location datée de maintenant', () => {
    expect(applyEvent(ev(WS_POSITION), o)).toEqual({ location: { lat: 47.309601, lon: 5.045802, at: NOW } })
  })
  it('batterie, activité (avec l’erreur réécrite), planning, hauteur de coupe', () => {
    expect(applyEvent(ev(WS_BATTERY), o)).toEqual({ battery: 77 })
    expect(applyEvent(ev(WS_MOWER), o)).toEqual({ activity: 'returning', errorCode: null, errorMessage: null, errorAt: null })
    expect(applyEvent(ev(WS_PLANNER), o)).toEqual({ nextStartAt: Date.UTC(2026, 8, 17, 8), restrictedReason: 'park_override' })
    expect(applyEvent(ev(WS_CUTTING_HEIGHT), o)).toEqual({ cuttingHeight: 4 })
  })
  it('un événement qui ne nous concerne pas ne produit rien', () => {
    expect(applyEvent(ev({ id: MOWER_ID, type: 'headlights-event-v2', attributes: { headlight: { mode: 'ALWAYS_ON' } } }), o)).toBeNull()
    expect(applyEvent(ev({ id: MOWER_ID, type: 'battery-event-v2', attributes: {} }), o)).toBeNull()
  })
})

describe('automower mapping — commandes', () => {
  it('tondre une heure, reprendre le planning, pause, se garer', () => {
    expect(actionBody({ type: 'mower.start', durationMin: 60 })).toEqual({ data: { type: 'Start', attributes: { duration: 60 } } })
    expect(actionBody({ type: 'mower.start' })).toEqual({ data: { type: 'ResumeSchedule' } })
    expect(actionBody({ type: 'mower.pause' })).toEqual({ data: { type: 'Pause' } })
    expect(actionBody({ type: 'mower.park', untilNextSchedule: true })).toEqual({ data: { type: 'ParkUntilNextSchedule' } })
    expect(actionBody({ type: 'mower.park', untilNextSchedule: false })).toEqual({ data: { type: 'ParkUntilFurtherNotice' } })
    expect(actionBody({ type: 'vacuum.start' })).toBeNull()
  })
})
