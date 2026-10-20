import { describe, expect, it } from 'vitest'
import {
  MAP_GENERATED_SVG, MAP_ZONE_SVG, MOWERS_ZONES, STAY_OUT_ID, MOWERS_ERROR, MOWERS_MOWING, MOWERS_OFFLINE, MOWERS_PARKED, MOWER_ID, WS_BATTERY, WS_CUTTING_HEIGHT, WS_MOWER_HOME, WS_MOWER_HOME_PARKED, WS_MOWER_INACTIVE,
  WS_MOWER_MAIN_PARKED, WS_MOWER_NOT_APPLICABLE, WS_MOWER_STOPPED, WS_MOWER_STOPPED_FULL, WS_PLANNER, WS_POSITION,
  MESSAGES, WS_MESSAGE_ERROR, WS_MOWER_ERROR_AT, WS_MOWER_ERROR_CODE, WS_MOWER_ERROR_FULL, WS_MOWER_ERROR_STATE, WS_MOWER_IN_OPERATION, WS_MOWER_LEAVING, WS_PLANNER_FORCE_MOW, WS_POSITION_2,
} from './__fixtures__/automower'
import { actionBody, applyEvent, connectedOf, localTimestamp, parseMowers, parseSvgMap, toActivity, toDescriptor, toJournal, toJournalEntry, toSiteMap, toStatePatch } from './mapping'
import { wsEventSchema } from './types'

// The mapping is pure: the fixtures (provisional, from the documentation) are enough to pin it down.

const TZ = 'Europe/Paris'
const NOW = Date.UTC(2026, 8, 16, 12)
const first = (list: unknown) => parseMowers(list)[0]!

describe('automower mapping — descriptor', () => {
  it('one robot = one mower device, named by the vendor, identified by its UUID', () => {
    const d = toDescriptor(first(MOWERS_ERROR))
    expect(d).toMatchObject({ id: `automower:${MOWER_ID}`, pluginId: 'automower', externalId: MOWER_ID, kind: 'mower', name: 'Tondeuse' })
    // the capture declares work areas, stay-out zones, position and confirmable error: the capabilities follow
    expect(d.capabilities).toEqual(['mow', 'park', 'battery', 'schedule', 'journal', 'work_areas', 'stay_out_zones', 'site_map', 'confirm_error'])
    expect(d.meta).toEqual({ manufacturer: 'Husqvarna', model: 'Husqvarna Automower® 435X AWD' })
  })

  it('an entry with an unexpected shape is dropped, the others survive', () => {
    const list = { data: [{ id: 42 }, MOWERS_ERROR.data[0]] }
    expect(parseMowers(list)).toHaveLength(1)
  })
})

describe('automower mapping — activity', () => {
  it('the error wins over the declared activity', () => {
    expect(toActivity({ activity: 'PARKED_IN_CS', state: 'ERROR' })).toBe('error')
    expect(toActivity({ activity: 'MOWING', state: 'FATAL_ERROR' })).toBe('error')
  })
  it('the vendor activities, in any case', () => {
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

describe('automower mapping — local timestamps', () => {
  it('turns the robot’s wall-clock time back into the true instant, summer time included', () => {
    // 2026-09-15 18:42:10 wall clock, in Paris in September (UTC+2) → 16:42:10 UTC
    expect(localTimestamp(Date.UTC(2026, 8, 15, 18, 42, 10), TZ)).toBe(Date.UTC(2026, 8, 15, 16, 42, 10))
    // in January (UTC+1)
    expect(localTimestamp(Date.UTC(2026, 0, 10, 9), TZ)).toBe(Date.UTC(2026, 0, 10, 8))
  })
  it('accepts seconds on an old firmware, and an unknown time zone counts as UTC', () => {
    expect(localTimestamp(1789497730, TZ)).toBe(Date.UTC(2026, 8, 15, 16, 42, 10))
    expect(localTimestamp(Date.UTC(2026, 8, 15, 18), 'Mars/Olympus')).toBe(Date.UTC(2026, 8, 15, 18))
  })
})

describe('automower mapping — full state', () => {
  it('the CAPTURE: parked, held by its schedule until 10 am local tomorrow, status in real UTC, position at the station', () => {
    const m = first(MOWERS_PARKED)
    const p = toStatePatch(m, { tz: TZ, now: NOW })
    expect(p.activity).toBe('parked')
    expect(p.battery).toBe(100)
    expect(p.errorCode).toBeNull()
    expect(p.restrictedReason).toBe('week_schedule')
    // 1789639200000 reads 10:00 "UTC": it is 10 am LOCAL (the calendar slot starts at 600 min), i.e. 08:00 UTC
    expect(p.nextStartAt).toBe(Date.UTC(2026, 8, 17, 8))
    expect(p.statusAt).toBe(1789570593758)
    const [head] = m.attributes.positions as { latitude: number; longitude: number }[]
    expect(p.location).toEqual({ lat: head!.latitude, lon: head!.longitude, at: 1789570593758 })
    expect(p.cuttingHeight).toBe(7)
    expect(p.statistics).toMatchObject({ cuttingTimeS: 14000000, chargingCycles: 45, collisions: 9500, driveDistanceM: 9000000 })
  })

  it('robot in loop error: code, vendor text, local date brought back to UTC, no next start', () => {
    const p = toStatePatch(first(MOWERS_ERROR), { tz: TZ, now: NOW })
    expect(p.activity).toBe('error')
    expect(p.battery).toBe(100)
    expect(p.errorCode).toBe(2)
    expect(p.errorMessage).toBe('No loop signal')
    expect(p.errorAt).toBe(Date.UTC(2026, 8, 15, 16, 42, 10))
    expect(p.errorConfirmable).toBe(true)                 // as the list says it (fixture: confirmable)
    expect(p.nextStartAt).toBeNull()
    expect(p.restrictedReason).toBe('not_applicable')
    expect(p.cuttingHeight).toBe(7)
    expect(p.statusAt).toBe(1789452130000)
    // the most recent position comes first, dated by the last status received
    expect(p.location).toMatchObject({ at: 1789452130000 })
    expect(p.statistics).toEqual({
      cuttingTimeS: 14000000, chargingTimeS: 3000000, runningTimeS: 15500000, searchingTimeS: 900000,
      bladeUsageTimeS: 800000, chargingCycles: 45, collisions: 9500, driveDistanceM: 9000000,
    })
    expect(connectedOf(first(MOWERS_ERROR))).toBe(true)
  })

  it('robot mowing: the error is CLEARED (null), the next start is a real instant', () => {
    const p = toStatePatch(first(MOWERS_MOWING), { tz: TZ, now: NOW })
    expect(p.activity).toBe('mowing')
    expect(p.battery).toBe(83)
    expect(p.errorCode).toBeNull()
    expect(p.errorMessage).toBeNull()
    expect(p.errorAt).toBeNull()
    // 2026-09-17 10:00 wall clock in Paris → 08:00 UTC
    expect(p.nextStartAt).toBe(Date.UTC(2026, 8, 17, 8))
    expect(p.restrictedReason).toBe('none')
  })

  it('robot offline: the state is read anyway, and `connected` says it no longer talks', () => {
    const m = first(MOWERS_OFFLINE)
    expect(toStatePatch(m, { tz: TZ, now: NOW })).toMatchObject({ activity: 'parked', restrictedReason: 'week_schedule' })
    expect(connectedOf(m)).toBe(false)
  })
})

describe('automower mapping — stream events (DELTAS, merged into the known robot)', () => {
  const ev = (raw: unknown) => wsEventSchema.parse(raw)
  const o = { tz: TZ, now: NOW }
  const parked = first(MOWERS_PARKED)
  const NEXT = Date.UTC(2026, 8, 17, 8)

  it('position → location dated now, and the trail gains the point at its head', () => {
    const r = applyEvent(ev(WS_POSITION), parked, o)!
    const { latitude, longitude } = WS_POSITION.attributes.position
    expect(r.patch).toEqual({ location: { lat: latitude, lon: longitude, at: NOW } })
    expect((r.next.attributes.positions as unknown[])[0]).toEqual({ latitude, longitude })
    expect(r.next.attributes.positions).toHaveLength(50)
  })

  it('battery and cutting height: the fragment is enough', () => {
    expect(applyEvent(ev(WS_BATTERY), parked, o)!.patch).toEqual({ battery: 77 })
    expect(applyEvent(ev(WS_CUTTING_HEIGHT), parked, o)!.patch).toEqual({ cuttingHeight: 7 })
  })

  it('a planner WITHOUT next start keeps the known one (it used to be wiped)', () => {
    const r = applyEvent(ev(WS_PLANNER), parked, o)!
    expect(r.patch).toEqual({ nextStartAt: NEXT, restrictedReason: 'week_schedule' })
  })

  it('the sequence captured after ParkUntilFurtherNotice: one field at a time, the activity is deduced from the merged robot', () => {
    let m = parked
    const step = (raw: unknown) => { const r = applyEvent(ev(raw), m, o)!; m = r.next; return r.patch }
    // `inactiveReason` alone: nothing changes on screen, the robot is still parked, without error
    expect(step(WS_MOWER_INACTIVE)).toMatchObject({ activity: 'parked', errorCode: null, restrictedReason: 'week_schedule' })
    expect(step(WS_MOWER_STOPPED).activity).toBe('stopped')
    expect(step(WS_MOWER_NOT_APPLICABLE).activity).toBe('stopped')
    expect(step(WS_MOWER_STOPPED_FULL).activity).toBe('stopped')
    // HOME mode = parked until further notice: the restriction says so, the planner does not know it
    expect(step(WS_MOWER_HOME)).toMatchObject({ activity: 'stopped', restrictedReason: 'park_override' })
    expect(step(WS_MOWER_HOME_PARKED)).toMatchObject({ activity: 'parked', restrictedReason: 'park_override', nextStartAt: NEXT })
    // ResumeSchedule: back to the schedule
    expect(step(WS_MOWER_MAIN_PARKED)).toMatchObject({ activity: 'parked', restrictedReason: 'week_schedule' })
    expect(step(WS_PLANNER)).toEqual({ nextStartAt: NEXT, restrictedReason: 'week_schedule' })
  })

  it('the captured sequence of a failing Start: forced mowing, "on its way" without moving, then the error in three deltas', () => {
    let m = parked
    const step = (raw: unknown) => { const r = applyEvent(ev(raw), m, o); if (r) m = r.next; return r?.patch ?? null }
    // forced mowing: the next start no longer applies (0 → cleared), nothing holds the robot back anymore
    expect(step(WS_PLANNER_FORCE_MOW)).toEqual({ nextStartAt: null, restrictedReason: 'none' })
    // `state: IN_OPERATION` alone, the activity still says PARKED_IN_CS: parked (two seconds) — then on its way
    expect(step(WS_MOWER_IN_OPERATION)!.activity).toBe('parked')
    expect(step(WS_MOWER_LEAVING)).toMatchObject({ activity: 'mowing', errorCode: null, errorConfirmable: null })
    expect(step(WS_POSITION)).toEqual({ location: { lat: WS_POSITION.attributes.position.latitude, lon: WS_POSITION.attributes.position.longitude, at: NOW } })
    expect(step(WS_POSITION_2)!.location).toMatchObject({ lat: WS_POSITION_2.attributes.position.latitude })
    // the error: the code first (the state still says on its way), then the state, then the date — in SECONDS
    expect(step(WS_MOWER_ERROR_CODE)).toMatchObject({ activity: 'mowing', errorCode: 2, errorMessage: 'No loop signal', errorAt: null, errorConfirmable: false })
    expect(step(WS_MOWER_ERROR_STATE)).toMatchObject({ activity: 'error', errorCode: 2 })
    expect(step(WS_MOWER_ERROR_FULL)).toMatchObject({ activity: 'error', errorCode: 2 })
    expect(step(WS_MESSAGE_ERROR)).toBeNull()             // the message log: not read yet
    // 1789582935 s reads 2026-09-16 18:22:15 "UTC" = 18:22:15 in Paris = 16:22:15 UTC
    expect(step(WS_MOWER_ERROR_AT)).toMatchObject({ activity: 'error', errorCode: 2, errorAt: Date.UTC(2026, 8, 16, 16, 22, 15) })
  })

  it('a `mower` fragment without error code does NOT clear the known error', () => {
    const r = applyEvent(ev(WS_MOWER_INACTIVE), first(MOWERS_ERROR), o)!
    expect(r.patch).toMatchObject({ activity: 'error', errorCode: 2, errorMessage: 'No loop signal' })
  })

  it('an event that does not concern us produces nothing', () => {
    expect(applyEvent(ev({ id: MOWER_ID, type: 'headlights-event-v2', attributes: { headlight: { mode: 'ALWAYS_ON' } } }), parked, o)).toBeNull()
    expect(applyEvent(ev({ id: MOWER_ID, type: 'battery-event-v2', attributes: {} }), parked, o)).toBeNull()
  })
})

describe('automower mapping — log', () => {
  it('the capture: 22 lines from most recent to oldest, severities translated, local dates brought back to UTC', () => {
    const j = toJournal(MESSAGES, TZ)
    expect(j).toHaveLength(22)
    expect(j.map((e) => e.at)).toEqual([...j.map((e) => e.at)].sort((a, b) => b - a))
    // 1789582935 s = 2026-09-16 18:22:15 wall clock in Paris → 16:22:15 UTC
    expect(j[0]).toMatchObject({ at: Date.UTC(2026, 8, 16, 16, 22, 15), severity: 'error', code: 2, message: 'No loop signal' })
    expect(j[0]!.location).toBeDefined()
    expect(j.find((e) => e.code === 1)).toMatchObject({ severity: 'fatal', message: 'Outside working area' })
    expect(new Set(j.map((e) => e.severity))).toEqual(new Set(['error', 'fatal', 'warning']))
  })

  it('a near-zero position (no GPS fix) does not make a position', () => {
    const j = toJournal(MESSAGES, TZ)
    const blind = j.filter((e) => e.location === undefined)
    expect(blind.length).toBeGreaterThan(0)
    for (const e of blind) expect(e.code).toBe(62)
  })

  it('a stream line (message-event-v2) becomes an entry; a line without date or code is skipped', () => {
    expect(toJournalEntry(WS_MESSAGE_ERROR.attributes.message, TZ)).toMatchObject({ at: Date.UTC(2026, 8, 16, 16, 22, 15), severity: 'error', code: 2, message: 'No loop signal' })
    expect(toJournalEntry({ severity: 'INFO' }, TZ)).toBeNull()
    expect(toJournalEntry({ time: 1789582935, code: 999, severity: 'WHATEVER' }, TZ)).toMatchObject({ severity: 'info', message: 'Error 999' })
    expect(toJournal({ data: {} }, TZ)).toEqual([])
  })
})

describe('automower mapping — commands', () => {
  it('mow for an hour, resume the schedule, pause, park', () => {
    expect(actionBody({ type: 'mower.start', durationMin: 60 })).toEqual({ data: { type: 'Start', attributes: { duration: 60 } } })
    expect(actionBody({ type: 'mower.start' })).toEqual({ data: { type: 'ResumeSchedule' } })
    expect(actionBody({ type: 'mower.pause' })).toEqual({ data: { type: 'Pause' } })
    expect(actionBody({ type: 'mower.park', untilNextSchedule: true })).toEqual({ data: { type: 'ParkUntilNextSchedule' } })
    expect(actionBody({ type: 'mower.park', untilNextSchedule: false })).toEqual({ data: { type: 'ParkUntilFurtherNotice' } })
    expect(actionBody({ type: 'vacuum.start' })).toBeNull()
  })
})

describe('automower mapping — zones', () => {
  it('the capture: area 0 unnamed (the whole grounds), and NO stay-out zone — empty list, not unknown', () => {
    const p = toStatePatch(first(MOWERS_PARKED), { tz: TZ, now: NOW })
    expect(p.workAreas).toEqual([{ id: 0, name: '', enabled: true }])
    expect(p.stayOutZones).toEqual([])
  })

  it('drawn areas: their name, their state; an enabled stay-out zone', () => {
    const p = toStatePatch(first(MOWERS_ZONES), { tz: TZ, now: NOW })
    expect(p.workAreas).toEqual([{ id: 0, name: '', enabled: true }, { id: 123456, name: 'Fond du jardin', enabled: false }])
    expect(p.stayOutZones).toEqual([{ id: STAY_OUT_ID, name: 'Massif', enabled: true }])
  })

  it('a robot that does not handle zones says nothing about them, and declares neither zones nor map', () => {
    const m = first(MOWERS_PARKED)
    const bare = { ...m, attributes: { ...m.attributes, capabilities: { position: false, workAreas: false, stayOutZones: false }, workAreas: null } }
    const p = toStatePatch(bare, { tz: TZ, now: NOW })
    expect(p.workAreas).toBeUndefined()
    expect(p.stayOutZones).toBeUndefined()
    expect(toDescriptor(bare).capabilities).toEqual(['mow', 'park', 'battery', 'schedule', 'journal'])
  })

  it('mow an area: StartInWorkArea, with its duration', () => {
    expect(actionBody({ type: 'mower.start_in_area', workAreaId: 123456, durationMin: 60 }))
      .toEqual({ data: { type: 'StartInWorkArea', attributes: { workAreaId: 123456, duration: 60 } } })
  })
})

describe('automower mapping — map', () => {
  it('the generated map: millimeters to meters, green grounds, red obstacle, blue guide wire, yellow station', () => {
    const shapes = parseSvgMap(MAP_GENERATED_SVG, 'generated')
    expect(shapes.map((s) => [s.kind, s.id, s.name])).toEqual([
      ['station', 'lona_cs', undefined],
      ['lawn', 'main_area_0', 'Working area 0'],
      ['obstacle', 'island_1', 'Island 1'],
      ['guide', 'guide_1', undefined],
    ])
    expect(shapes[0]!.points).toEqual([[2, -0.5], [4, -0.9]])
    expect(shapes[1]!.points[2]).toEqual([10, 30])
  })

  it('the zones map: green there is a drawn work area (name without its spaces), red a stay-out zone, blue a path', () => {
    const shapes = parseSvgMap(MAP_ZONE_SVG, 'zone')
    expect(shapes.map((s) => [s.kind, s.id, s.name])).toEqual([
      ['work_area', '6f1c2a90-3b8e-4d57-9a41-0c2e7b5d8f13', 'Fond du jardin'],
      ['stay_out', STAY_OUT_ID, 'Massif'],
      ['rewilding', '0b9e4c2d-6a71-4f38-8d5e-2c7f1a9b3e60', 'Prairie'],
      ['transport', 'd319f479-1d8d-4659-b2ef-56fb44099909', 'Transport 1'],
    ])
  })

  it('a stay-out or rewilding zone tells its state: hidden (display=none) = disabled', () => {
    const shapes = parseSvgMap(MAP_ZONE_SVG, 'zone')
    expect(shapes.filter((s) => s.kind === 'stay_out' || s.kind === 'rewilding').map((s) => [s.kind, s.enabled])).toEqual([['stay_out', true], ['rewilding', false]])
    expect(shapes.find((s) => s.kind === 'work_area')).not.toHaveProperty('enabled')
  })

  it('the two maps merged; the station is the first point of the yellow line', () => {
    const map = toSiteMap([{ svg: MAP_GENERATED_SVG, source: 'generated' }, { svg: MAP_ZONE_SVG, source: 'zone' }])
    expect(map.station).toEqual([2, -0.5])
    expect(map.shapes).toHaveLength(8)
  })

  it('without a yellow line, no station; a shape with a single point or an unknown color is skipped', () => {
    const map = toSiteMap([{ svg: '<svg><polygon fill="green" points="0,0"/><polygon fill="purple" points="0,0 1000,0 0,1000"/></svg>', source: 'generated' }])
    expect(map).toEqual({ station: null, shapes: [] })
  })
})

describe('automower mapping — current task', () => {
  it('the list tells the current area; parked, it is not "on its way"', () => {
    expect(toStatePatch(first(MOWERS_PARKED), { tz: TZ, now: NOW })).toMatchObject({ workAreaId: 0, leaving: false })
  })
  it('a captured departure (LEAVING): "on its way", and the known area survives the delta that does not carry it', () => {
    const m = first(MOWERS_ZONES)
    const current = { ...m, attributes: { ...m.attributes, mower: { ...m.attributes.mower!, workAreaId: 123456 } } }
    const applied = applyEvent(wsEventSchema.parse(WS_MOWER_LEAVING), current, { tz: TZ, now: NOW })!
    expect(applied.patch).toMatchObject({ activity: 'mowing', leaving: true, workAreaId: 123456 })
  })
})
