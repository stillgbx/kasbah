import { describe, expect, it } from 'vitest'
import {
  MOWERS_ERROR, MOWERS_MOWING, MOWERS_OFFLINE, MOWERS_PARKED, MOWER_ID, WS_BATTERY, WS_CUTTING_HEIGHT, WS_MOWER_HOME, WS_MOWER_HOME_PARKED, WS_MOWER_INACTIVE,
  WS_MOWER_MAIN_PARKED, WS_MOWER_NOT_APPLICABLE, WS_MOWER_STOPPED, WS_MOWER_STOPPED_FULL, WS_PLANNER, WS_POSITION,
  MESSAGES, WS_MESSAGE_ERROR, WS_MOWER_ERROR_AT, WS_MOWER_ERROR_CODE, WS_MOWER_ERROR_FULL, WS_MOWER_ERROR_STATE, WS_MOWER_IN_OPERATION, WS_MOWER_LEAVING, WS_PLANNER_FORCE_MOW, WS_POSITION_2,
} from './__fixtures__/automower'
import { actionBody, applyEvent, connectedOf, localTimestamp, parseMowers, toActivity, toDescriptor, toJournal, toJournalEntry, toStatePatch } from './mapping'
import { wsEventSchema } from './types'

// Le mappage est pur : les fixtures (provisoires, d'après la documentation) suffisent à le tenir.

const TZ = 'Europe/Paris'
const NOW = Date.UTC(2026, 8, 16, 12)
const first = (list: unknown) => parseMowers(list)[0]!

describe('automower mapping — descripteur', () => {
  it('un robot = un appareil mower, nommé par le fabricant, identifié par son UUID', () => {
    const d = toDescriptor(first(MOWERS_ERROR))
    expect(d).toMatchObject({ id: `automower:${MOWER_ID}`, pluginId: 'automower', externalId: MOWER_ID, kind: 'mower', name: 'Tondeuse' })
    expect(d.capabilities).toEqual(['mow', 'park', 'battery', 'schedule', 'journal'])
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

describe('automower mapping — événements du flux (des DELTAS, fondus dans le robot connu)', () => {
  const ev = (raw: unknown) => wsEventSchema.parse(raw)
  const o = { tz: TZ, now: NOW }
  const parked = first(MOWERS_PARKED)
  const NEXT = Date.UTC(2026, 8, 17, 8)

  it('position → location datée de maintenant, et le relevé gagne le point en tête', () => {
    const r = applyEvent(ev(WS_POSITION), parked, o)!
    const { latitude, longitude } = WS_POSITION.attributes.position
    expect(r.patch).toEqual({ location: { lat: latitude, lon: longitude, at: NOW } })
    expect((r.next.attributes.positions as unknown[])[0]).toEqual({ latitude, longitude })
    expect(r.next.attributes.positions).toHaveLength(50)
  })

  it('batterie et hauteur de coupe : le fragment suffit', () => {
    expect(applyEvent(ev(WS_BATTERY), parked, o)!.patch).toEqual({ battery: 77 })
    expect(applyEvent(ev(WS_CUTTING_HEIGHT), parked, o)!.patch).toEqual({ cuttingHeight: 7 })
  })

  it('un planificateur SANS prochain départ garde celui qu’on connaît (il était effacé)', () => {
    const r = applyEvent(ev(WS_PLANNER), parked, o)!
    expect(r.patch).toEqual({ nextStartAt: NEXT, restrictedReason: 'week_schedule' })
  })

  it('la séquence capturée après ParkUntilFurtherNotice : un champ à la fois, l’activité se déduit du robot fondu', () => {
    let m = parked
    const step = (raw: unknown) => { const r = applyEvent(ev(raw), m, o)!; m = r.next; return r.patch }
    // `inactiveReason` seul : rien ne change à l'écran, le robot est toujours garé, sans erreur
    expect(step(WS_MOWER_INACTIVE)).toMatchObject({ activity: 'parked', errorCode: null, restrictedReason: 'week_schedule' })
    expect(step(WS_MOWER_STOPPED).activity).toBe('stopped')
    expect(step(WS_MOWER_NOT_APPLICABLE).activity).toBe('stopped')
    expect(step(WS_MOWER_STOPPED_FULL).activity).toBe('stopped')
    // mode HOME = garé jusqu'à nouvel ordre : c'est la restriction qui le dit, le planificateur ne le sait pas
    expect(step(WS_MOWER_HOME)).toMatchObject({ activity: 'stopped', restrictedReason: 'park_override' })
    expect(step(WS_MOWER_HOME_PARKED)).toMatchObject({ activity: 'parked', restrictedReason: 'park_override', nextStartAt: NEXT })
    // ResumeSchedule : retour au planning
    expect(step(WS_MOWER_MAIN_PARKED)).toMatchObject({ activity: 'parked', restrictedReason: 'week_schedule' })
    expect(step(WS_PLANNER)).toEqual({ nextStartAt: NEXT, restrictedReason: 'week_schedule' })
  })

  it('la séquence capturée d’un Start qui échoue : tonte forcée, « en route » sans bouger, puis l’erreur en trois deltas', () => {
    let m = parked
    const step = (raw: unknown) => { const r = applyEvent(ev(raw), m, o); if (r) m = r.next; return r?.patch ?? null }
    // tonte forcée : le prochain départ n'a plus cours (0 → effacé), plus rien ne retient le robot
    expect(step(WS_PLANNER_FORCE_MOW)).toEqual({ nextStartAt: null, restrictedReason: 'none' })
    // `state: IN_OPERATION` seul, l'activité dit encore PARKED_IN_CS : garé (deux secondes) — puis en route
    expect(step(WS_MOWER_IN_OPERATION)!.activity).toBe('parked')
    expect(step(WS_MOWER_LEAVING)).toMatchObject({ activity: 'mowing', errorCode: null })
    expect(step(WS_POSITION)).toEqual({ location: { lat: WS_POSITION.attributes.position.latitude, lon: WS_POSITION.attributes.position.longitude, at: NOW } })
    expect(step(WS_POSITION_2)!.location).toMatchObject({ lat: WS_POSITION_2.attributes.position.latitude })
    // l'erreur : le code d'abord (l'état dit encore en route), puis l'état, puis la date — en SECONDES
    expect(step(WS_MOWER_ERROR_CODE)).toMatchObject({ activity: 'mowing', errorCode: 2, errorMessage: 'No loop signal', errorAt: null })
    expect(step(WS_MOWER_ERROR_STATE)).toMatchObject({ activity: 'error', errorCode: 2 })
    expect(step(WS_MOWER_ERROR_FULL)).toMatchObject({ activity: 'error', errorCode: 2 })
    expect(step(WS_MESSAGE_ERROR)).toBeNull()             // le journal des messages : pas encore lu
    // 1789582935 s se lit 2026-09-16 18:22:15 « UTC » = 18:22:15 à Paris = 16:22:15 UTC
    expect(step(WS_MOWER_ERROR_AT)).toMatchObject({ activity: 'error', errorCode: 2, errorAt: Date.UTC(2026, 8, 16, 16, 22, 15) })
  })

  it('un fragment `mower` sans code d’erreur ne lève PAS l’erreur connue', () => {
    const r = applyEvent(ev(WS_MOWER_INACTIVE), first(MOWERS_ERROR), o)!
    expect(r.patch).toMatchObject({ activity: 'error', errorCode: 2, errorMessage: 'No loop signal' })
  })

  it('un événement qui ne nous concerne pas ne produit rien', () => {
    expect(applyEvent(ev({ id: MOWER_ID, type: 'headlights-event-v2', attributes: { headlight: { mode: 'ALWAYS_ON' } } }), parked, o)).toBeNull()
    expect(applyEvent(ev({ id: MOWER_ID, type: 'battery-event-v2', attributes: {} }), parked, o)).toBeNull()
  })
})

describe('automower mapping — journal', () => {
  it('la capture : 22 lignes du plus récent au plus ancien, gravités traduites, dates locales ramenées en UTC', () => {
    const j = toJournal(MESSAGES, TZ)
    expect(j).toHaveLength(22)
    expect(j.map((e) => e.at)).toEqual([...j.map((e) => e.at)].sort((a, b) => b - a))
    // 1789582935 s = 2026-09-16 18:22:15 mur à Paris → 16:22:15 UTC
    expect(j[0]).toMatchObject({ at: Date.UTC(2026, 8, 16, 16, 22, 15), severity: 'error', code: 2, message: 'No loop signal' })
    expect(j[0]!.location).toBeDefined()
    expect(j.find((e) => e.code === 1)).toMatchObject({ severity: 'fatal', message: 'Outside working area' })
    expect(new Set(j.map((e) => e.severity))).toEqual(new Set(['error', 'fatal', 'warning']))
  })

  it('une position quasi nulle (pas de fix GPS) ne fait pas une position', () => {
    const j = toJournal(MESSAGES, TZ)
    const blind = j.filter((e) => e.location === undefined)
    expect(blind.length).toBeGreaterThan(0)
    for (const e of blind) expect(e.code).toBe(62)
  })

  it('une ligne du flux (message-event-v2) devient une entrée ; une ligne sans date ni code est sautée', () => {
    expect(toJournalEntry(WS_MESSAGE_ERROR.attributes.message, TZ)).toMatchObject({ at: Date.UTC(2026, 8, 16, 16, 22, 15), severity: 'error', code: 2, message: 'No loop signal' })
    expect(toJournalEntry({ severity: 'INFO' }, TZ)).toBeNull()
    expect(toJournalEntry({ time: 1789582935, code: 999, severity: 'WHATEVER' }, TZ)).toMatchObject({ severity: 'info', message: 'Error 999' })
    expect(toJournal({ data: {} }, TZ)).toEqual([])
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
