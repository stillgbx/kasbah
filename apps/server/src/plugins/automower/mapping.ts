import type { Capability, Command, DeviceDescriptor, JournalEntry, JournalSeverity, MowerRestriction, SiteMapShape, StateFor, StatePatch } from '@kasbah/shared'
import { MOWER_RESTRICTIONS } from '@kasbah/shared'
import type { PluginSiteMap } from '../../core/plugin'
import { messageSchema, messagesResponseSchema, mowerDataSchema, mowerSectionSchema, plannerSchema, positionSchema, stayOutZoneSchema, workAreaSchema, type MowerData, type WsEvent } from './types'

// Automower Connect API → Kasbah contract. PURE functions, tested on the fixtures.
//
// One robot = one `mower` device, identified by the UUID the vendor gives it (stable, no `:` and
// no space: that is what house.json will link). Two sources saying the same thing in two shapes:
//   - `toStatePatch`: the LIST (`GET /mowers`) returns each robot's full state;
//   - `applyEvent`: the WebSocket pushes a DELTA — captured on 2026-09-16: `{ mower: { state:
//     "STOPPED" } }` alone, `{ mower: { inactiveReason: "PLANNING" } }` alone, a `planner` WITHOUT
//     `nextStartTimestamp`. A delta is not mapped on its own (the wiki's Overkiz trap): it is MERGED
//     into the robot's last full read, and it is the merged state that gets mapped. Hence the
//     signature: the event AND the robot as we know it, out come the updated robot AND the patch.

export const PLUGIN_ID = 'automower'

/** What the robot can do: leave, park, report its battery, follow a schedule, keep its log. */
export const CAPABILITIES = ['mow', 'park', 'battery', 'schedule', 'journal'] as const

/** Validates resource by resource: a robot with an unexpected shape does not deprive the house of the others. */
export function parseMowers(list: unknown, onReject?: (issue: string) => void): MowerData[] {
  const data = (list as { data?: unknown })?.data
  if (!Array.isArray(data)) return []
  const out: MowerData[] = []
  for (const raw of data) {
    const parsed = mowerDataSchema.safeParse(raw)
    if (parsed.success) out.push(parsed.data)
    else onReject?.(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  }
  return out
}

/**
 * What the robot declares IN ADDITION, from its `capabilities`: work areas, stay-out zones, and a
 * map for a robot that positions itself (GPS or EPOS) — a robot without a position has no
 * surveyed grounds to show.
 */
function optionalCapabilities(m: MowerData): Capability[] {
  const c = m.attributes.capabilities
  return [
    ...(c?.workAreas ? ['work_areas' as const] : []),
    ...(c?.stayOutZones ? ['stay_out_zones' as const] : []),
    ...(c?.position ? ['site_map' as const] : []),
    ...(c?.canConfirmError ? ['confirm_error' as const] : []),
  ]
}

export function toDescriptor(m: MowerData): DeviceDescriptor {
  const sys = m.attributes.system
  const model = sys?.model?.trim() || undefined
  const name = sys?.name?.trim() || model || 'Automower'
  return {
    id: `${PLUGIN_ID}:${m.id}`, pluginId: PLUGIN_ID, externalId: m.id, kind: 'mower', name,
    capabilities: [...CAPABILITIES, ...optionalCapabilities(m)],
    meta: { manufacturer: 'Husqvarna', ...(model ? { model } : {}) },
  }
}

/** The robot talks to the vendor's cloud. Absent = assumed reachable, the read will tell. */
export function connectedOf(m: MowerData): boolean { return m.attributes.metadata?.connected !== false }

export type MowerActivity = StateFor<'mower'>['activity']

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * Two vendor fields for one Kasbah activity. `state` wins when it says ERROR, PAUSE or STOP — the
 * robot can be "parked" from its point of view and stopped (captured: a `ParkUntilFurtherNotice`
 * switches to `state: STOPPED` before `activity` follows); then `activity` says what it is doing.
 * `stopped` covers the STOP button, a stop in the garden, the robot switched off and the one
 * waiting to power up with no known activity: neither parked nor paused, stopped where it is.
 */
export function toActivity(mower: { activity?: string | null; state?: string | null } | null | undefined): MowerActivity {
  const state = lower(mower?.state), activity = lower(mower?.activity)
  if (state === 'error' || state === 'fatal_error' || state === 'error_at_power_up') return 'error'
  if (state === 'paused') return 'paused'
  if (state === 'stopped' || state === 'off') return 'stopped'
  switch (activity) {
    case 'mowing': case 'leaving': return 'mowing'
    case 'going_home': return 'returning'
    case 'charging': return 'charging'
    case 'parked_in_cs': return 'parked'
    case 'stopped_in_garden': return 'stopped'
  }
  if (state === 'in_operation') return 'mowing'
  if (state === 'wait_power_up' || state === 'wait_updating') return 'stopped'
  return 'parked'
}

export function toRestriction(raw: string | null | undefined): MowerRestriction | undefined {
  const v = lower(raw)
  return (MOWER_RESTRICTIONS as readonly string[]).includes(v) ? (v as MowerRestriction) : undefined
}

/**
 * Vendor timestamps. `nextStartTimestamp` and `errorCodeTimestamp` are the robot's LOCAL time
 * written as if it were UTC (the reference library documents it that way); we turn it back into a
 * real instant with the house's time zone. The value is in milliseconds, sometimes in seconds on
 * older firmwares (same threshold as the reference: beyond year 3000 in seconds, it is
 * milliseconds). `statusTimestamp`, for its part, is in UTC: it does not go through here.
 */
export function localTimestamp(raw: number, tz: string): number {
  const ms = raw > 32_503_680_000 ? raw : raw * 1000
  // two passes: the offset in force at the TRUE instant, not at the shifted instant (summer time)
  const guess = ms - tzOffsetMs(tz, ms)
  return ms - tzOffsetMs(tz, guess)
}

/** Offset (ms) between `tz` wall-clock time and UTC at instant `at`. Unknown time zone = UTC. */
function tzOffsetMs(tz: string, at: number): number {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(at))
  } catch { return 0 }
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return wall - Math.floor(at / 1000) * 1000
}

/** The time zone is valid for `Intl` (the configuration checks it before accepting it). */
export function isTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export interface MapOptions {
  /** The house's time zone: the one in which the robot writes its "local" timestamps. */
  tz: string
  /** Now (ms): dates a position received without a timestamp. */
  now: number
}

const clampPct = (v: number | null | undefined) => Math.max(0, Math.min(100, Math.round(v ?? 0)))
const pos = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : undefined)

/** The vendor's text for an error code; a code outside the table keeps its number. */
export function errorText(code: number): string { return ERROR_TEXT[code] ?? `Error ${code}` }

/** What a `mower` section says about the error: code, text, date, remote clearing — or their removal (`null`). */
function errorFields(
  mower: { errorCode?: number | null; errorCodeTimestamp?: number | null; isErrorConfirmable?: boolean | null } | null | undefined,
  tz: string,
): Pick<StatePatch<'mower'>, 'errorCode' | 'errorMessage' | 'errorAt' | 'errorConfirmable'> {
  const code = mower?.errorCode ?? 0
  if (code <= 0) return { errorCode: null, errorMessage: null, errorAt: null, errorConfirmable: null }
  const at = pos(mower?.errorCodeTimestamp)
  return {
    errorCode: code, errorMessage: errorText(code), errorAt: at === undefined ? null : localTimestamp(at, tz),
    errorConfirmable: mower?.isErrorConfirmable === true,
  }
}

/**
 * Why the robot stays at the station. The planner's `restrictedReason`, EXCEPT when the robot is
 * in `HOME` mode: that is how the vendor encodes "parked until further notice" (captured on
 * 2026-09-16 after a `ParkUntilFurtherNotice`: `mode: HOME`, and the planner still said
 * `WEEK_SCHEDULE`). The mode wins: it says the robot will not leave on its own.
 */
function plannerFields(
  planner: { nextStartTimestamp?: number | null; restrictedReason?: string | null } | null | undefined,
  mower: { mode?: string | null } | null | undefined,
  tz: string,
): Pick<StatePatch<'mower'>, 'nextStartAt' | 'restrictedReason'> {
  const next = pos(planner?.nextStartTimestamp)
  const restriction = lower(mower?.mode) === 'home' ? 'park_override' : toRestriction(planner?.restrictedReason)
  return { nextStartAt: next === undefined ? null : localTimestamp(next, tz), ...(restriction ? { restrictedReason: restriction } : {}) }
}

function statisticsOf(s: MowerData['attributes']['statistics']): StateFor<'mower'>['statistics'] | undefined {
  if (!s) return undefined
  const n = (v: number | null | undefined) => (typeof v === 'number' ? v : undefined)
  const out = {
    cuttingTimeS: n(s.totalCuttingTime), chargingTimeS: n(s.totalChargingTime), runningTimeS: n(s.totalRunningTime),
    searchingTimeS: n(s.totalSearchingTime), bladeUsageTimeS: n(s.cuttingBladeUsageTime),
    chargingCycles: n(s.numberOfChargingCycles), collisions: n(s.numberOfCollisions), driveDistanceM: n(s.totalDriveDistance),
  }
  const defined = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined))
  return Object.keys(defined).length ? defined : undefined
}

/**
 * What the robot is doing, beyond the activity: the area where it mows (or is heading to) and
 * whether it is still ON ITS WAY (`LEAVING`, which the Kasbah activity files under `mowing`). The
 * area only arrives through the full read — the captured events never carry it —: a delta
 * therefore keeps it as the merged robot knows it. Absent = cleared (`null`).
 */
function taskFields(mower: { activity?: string | null; workAreaId?: number | null } | null | undefined): Pick<StatePatch<'mower'>, 'workAreaId' | 'leaving'> {
  const id = mower?.workAreaId
  return { workAreaId: typeof id === 'number' && id >= 0 ? id : null, leaving: lower(mower?.activity) === 'leaving' }
}

/** Readable work areas; an entry with an unexpected shape is skipped. Absent = the robot says nothing about them. */
function workAreasOf(a: MowerData['attributes']): StateFor<'mower'>['workAreas'] {
  if (!a.workAreas) return undefined
  return a.workAreas.flatMap((raw) => {
    const w = workAreaSchema.safeParse(raw)
    return w.success ? [{ id: w.data.workAreaId, name: w.data.name?.trim() ?? '', enabled: w.data.enabled !== false }] : []
  })
}

/** Stay-out zones: the section is ABSENT as long as none is drawn — that is an empty list, not an unknown. */
function stayOutZonesOf(a: MowerData['attributes']): StateFor<'mower'>['stayOutZones'] {
  if (!a.capabilities?.stayOutZones) return undefined
  return (a.stayOutZones?.zones ?? []).flatMap((raw) => {
    const z = stayOutZoneSchema.safeParse(raw)
    return z.success ? [{ id: z.data.id, name: z.data.name?.trim() ?? '', enabled: z.data.enabled === true }] : []
  })
}

/** A robot's full state as the LIST returns it. */
export function toStatePatch(m: MowerData, o: MapOptions): StatePatch<'mower'> {
  const a = m.attributes
  const statusAt = pos(a.metadata?.statusTimestamp)
  const first = positionSchema.safeParse(a.positions?.[0])
  const height = a.settings?.cuttingHeight
  const stats = statisticsOf(a.statistics)
  const workAreas = workAreasOf(a)
  const stayOutZones = stayOutZonesOf(a)
  return {
    ...(workAreas ? { workAreas } : {}),
    ...(stayOutZones ? { stayOutZones } : {}),
    activity: toActivity(a.mower),
    ...taskFields(a.mower),
    battery: clampPct(a.battery?.batteryPercent),
    ...errorFields(a.mower, o.tz),
    ...plannerFields(a.planner, a.mower, o.tz),
    ...(typeof height === 'number' && height >= 1 && height <= 9 ? { cuttingHeight: Math.round(height) } : {}),
    ...(statusAt === undefined ? {} : { statusAt }),
    // the list does not date its positions: the last status received is the closest thing to it
    ...(first.success ? { location: { lat: first.data.latitude, lon: first.data.longitude, at: statusAt ?? o.now } } : {}),
    ...(stats ? { statistics: stats } : {}),
  }
}

/** The PRESENT keys of a delta, without those it does not name: that is what gets merged into the known state. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** The trail keeps at most as many positions as the vendor returns in the list. */
const POSITIONS_MAX = 50

export interface AppliedEvent {
  /** The robot as we know it AFTER the event: that is what we keep for the next one. */
  next: MowerData
  /** What the event changes in the published state. */
  patch: StatePatch<'mower'>
}

/**
 * A WebSocket event, merged into the robot as we know it → the updated robot and the patch to
 * publish. `null` = nothing for us (calendar, headlights, messages, unexpected shape).
 *
 * Events are DELTAS (capture of 2026-09-16): `{ mower: { state: "STOPPED" } }` says nothing about
 * the activity or the error, `{ planner: { override, restrictedReason } }` does not repeat the next
 * start. Mapping the fragment alone wiped the error (absent `errorCode` read as "no more error")
 * and the next start (absent `nextStartTimestamp` read as "none"). So the fragment is merged into
 * the known section, then the whole section is mapped — as if the list had returned it.
 */
export function applyEvent(ev: WsEvent, current: MowerData, o: MapOptions): AppliedEvent | null {
  const at = ev.attributes ?? {}
  const a = current.attributes
  const withAttributes = (patch: Partial<MowerData['attributes']>): MowerData => ({ ...current, attributes: { ...a, ...patch } })
  switch (ev.type) {
    case 'battery-event-v2': {
      const pct = (at.battery as { batteryPercent?: unknown } | undefined)?.batteryPercent
      if (typeof pct !== 'number') return null
      return { next: withAttributes({ battery: { ...(a.battery ?? {}), batteryPercent: pct } }), patch: { battery: clampPct(pct) } }
    }
    case 'mower-event-v2': {
      const delta = mowerSectionSchema.safeParse(at.mower)
      if (!delta.success) return null
      const mower = { ...(a.mower ?? {}), ...defined(delta.data) }
      return {
        next: withAttributes({ mower }),
        patch: { activity: toActivity(mower), ...taskFields(mower), ...errorFields(mower, o.tz), ...plannerFields(a.planner, mower, o.tz) },
      }
    }
    case 'planner-event-v2': {
      const delta = plannerSchema.safeParse(at.planner)
      if (!delta.success) return null
      const planner = { ...(a.planner ?? {}), ...defined(delta.data) }
      return { next: withAttributes({ planner }), patch: plannerFields(planner, a.mower, o.tz) }
    }
    case 'position-event-v2': {
      const p = positionSchema.safeParse(at.position)
      if (!p.success) return null
      const positions = [p.data, ...(a.positions ?? [])].slice(0, POSITIONS_MAX)
      return { next: withAttributes({ positions }), patch: { location: { lat: p.data.latitude, lon: p.data.longitude, at: o.now } } }
    }
    case 'cuttingHeight-event-v2': {
      const h = (at.cuttingHeight as { height?: unknown } | undefined)?.height
      if (typeof h !== 'number' || h < 1 || h > 9) return null
      return { next: withAttributes({ settings: { ...(a.settings ?? {}), cuttingHeight: h } }), patch: { cuttingHeight: Math.round(h) } }
    }
    default:
      return null
  }
}

// ---- Log ----------------------------------------------------------------------------------------

/** Vendor severities (capitals) → contract. Unknown = info. */
function toSeverity(raw: string | null | undefined): JournalSeverity {
  switch (lower(raw)) {
    case 'fatal': case 'fatal_error': return 'fatal'
    case 'error': return 'error'
    case 'warning': return 'warning'
    default: return 'info'
  }
}

/**
 * One log line, or `null` if it has neither date nor code. Position kept only if it really is one:
 * the captured log carries `(2e-7 ; 6.2e-6)` — a GPS without a fix writes almost zero, and that is
 * not a point in the garden.
 */
export function toJournalEntry(raw: unknown, tz: string): JournalEntry | null {
  const m = messageSchema.safeParse(raw)
  if (!m.success) return null
  const time = pos(m.data.time), code = m.data.code
  if (time === undefined || typeof code !== 'number') return null
  const lat = m.data.latitude, lon = m.data.longitude
  const located = typeof lat === 'number' && typeof lon === 'number' && (Math.abs(lat) > 0.01 || Math.abs(lon) > 0.01)
  return {
    at: localTimestamp(time, tz), severity: toSeverity(m.data.severity), code, message: errorText(code),
    ...(located ? { location: { lat, lon } } : {}),
  }
}

/** `GET /mowers/{id}/messages` → entries from most recent to oldest; an unreadable line is skipped. */
export function toJournal(raw: unknown, tz: string): JournalEntry[] {
  const parsed = messagesResponseSchema.safeParse(raw)
  const list = parsed.success ? parsed.data.data.attributes?.messages ?? [] : []
  return list.map((m) => toJournalEntry(m, tz)).filter((e): e is JournalEntry => e !== null).sort((a, b) => b.at - a.at)
}

/**
 * JSON:API body of a command. "Mow" without duration = RESUME THE SCHEDULE (the robot decides),
 * with a duration = leave for that time; park until the next slot or until further notice.
 * `null` = a command this plugin cannot translate.
 */
export function actionBody(cmd: Command): { data: { type: string; attributes?: { duration: number; workAreaId?: number } } } | null {
  switch (cmd.type) {
    case 'mower.start':
      return cmd.durationMin === undefined ? { data: { type: 'ResumeSchedule' } } : { data: { type: 'Start', attributes: { duration: cmd.durationMin } } }
    case 'mower.start_in_area':
      return { data: { type: 'StartInWorkArea', attributes: { workAreaId: cmd.workAreaId, duration: cmd.durationMin } } }
    case 'mower.pause':
      return { data: { type: 'Pause' } }
    case 'mower.park':
      return { data: { type: cmd.untilNextSchedule ? 'ParkUntilNextSchedule' : 'ParkUntilFurtherNotice' } }
    default:
      return null
  }
}

// ---- Site map -----------------------------------------------------------------------------------

/** The attributes of an SVG tag (`name="value"`), without depending on a server-side DOM. */
function svgAttributes(raw: string): Record<string, string> {
  return Object.fromEntries([...raw.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]))
}

/** `"x,y x,y …"` in millimeters → points in meters; an odd or unreadable number ends the list. */
function svgPoints(raw: string | undefined): [number, number][] {
  const n = (raw ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < n.length; i += 2) {
    if (!Number.isFinite(n[i]) || !Number.isFinite(n[i + 1])) break
    out.push([n[i]! / 1000, n[i + 1]! / 1000])
  }
  return out
}

/**
 * A vendor SVG map → the contract's shapes. Husqvarna encodes the kind by COLOR (its
 * documentation: green = work area, red = stay-out zone, blue = path, yellow = station).
 * Surveyed on a real 435X AWD on 2026-10-12: coordinates in MILLIMETERS, `x` towards the east and
 * `y` towards the north (same shape as the app's map); in the GENERATED map, green is the whole
 * grounds (`main_area_0`), red an obstacle surveyed by the robot (`island_*`, the house, a tree)
 * and blue a guide wire (`guide_*`); it is in the ZONES map that green is a hand-drawn work area
 * (UUID id, `title` = its name, with its spaces) and red a stay-out zone (same UUID as in
 * `stayOutZones`) — or a REWILDING zone when it carries `rewildingzone="true"`, a zone the list
 * does not know. When disabled, a zone stays there with `display="none"` (survey of 2026-10-12).
 */
export function parseSvgMap(svg: string, source: 'generated' | 'zone' | 'site'): SiteMapShape[] {
  const shapes: SiteMapShape[] = []
  for (const m of svg.matchAll(/<(polygon|polyline)\b([^>]*)>/g)) {
    const a = svgAttributes(m[2]!)
    const points = svgPoints(a.points)
    if (points.length < 2) continue
    const color = lower(a.fill && a.fill !== 'none' ? a.fill : a.stroke)
    const id = a.id ?? ''
    let kind: SiteMapShape['kind'] | null = null
    if (m[1] === 'polygon') {
      if (color === 'green') kind = source === 'generated' ? 'lawn' : 'work_area'
      else if (color === 'red') kind = source === 'generated' ? 'obstacle' : a.rewildingzone === 'true' ? 'rewilding' : 'stay_out'
    } else if (color === 'yellow') kind = 'station'
    else if (color === 'blue') kind = id.startsWith('guide') ? 'guide' : 'transport'
    if (!kind) continue
    // a disabled zone stays on the map, hidden (`display="none"`)
    const toggled = kind === 'stay_out' || kind === 'rewilding'
    shapes.push({ kind, id, ...(a.title?.trim() ? { name: a.title.trim() } : {}), ...(toggled ? { enabled: lower(a.display) !== 'none' } : {}), points })
  }
  return shapes
}

/**
 * A robot's maps merged into one. The station is the FIRST point of the yellow line: on the
 * survey, the guide wires all start there, it is the charging plate. Without a yellow line, no
 * station, and the map cannot be placed in the world.
 */
export function toSiteMap(maps: { svg: string; source: 'generated' | 'zone' | 'site' }[]): PluginSiteMap {
  const shapes = maps.flatMap((m) => parseSvgMap(m.svg, m.source))
  const station = shapes.find((s) => s.kind === 'station')?.points[0] ?? null
  return { station, shapes }
}

/**
 * The vendor's error codes and their text (English, as it publishes them). The table comes from
 * the reference library (aioautomower), which keeps it up to date from the documentation. The
 * text is published as is in `errorMessage`: translating 160 technical labels would bring
 * nothing, and it is this text that support and the forums know.
 */
export const ERROR_TEXT: Record<number, string> = {
  0: 'Unexpected error', 1: 'Outside working area', 2: 'No loop signal', 3: 'Wrong loop signal',
  4: 'Loop sensor problem, front', 5: 'Loop sensor problem, rear', 6: 'Loop sensor problem, left', 7: 'Loop sensor problem, right',
  8: 'Wrong PIN code', 9: 'Trapped', 10: 'Upside down', 11: 'Low battery', 12: 'Empty battery', 13: 'No drive',
  14: 'Mower lifted', 15: 'Lifted', 16: 'Stuck in charging station', 17: 'Charging station blocked',
  18: 'Collision sensor problem, rear', 19: 'Collision sensor problem, front',
  20: 'Wheel motor blocked, right', 21: 'Wheel motor blocked, left', 22: 'Wheel drive problem, right', 23: 'Wheel drive problem, left',
  24: 'Cutting system blocked', 25: 'Cutting system blocked', 26: 'Invalid sub-device combination', 27: 'Settings restored',
  28: 'Memory circuit problem', 29: 'Slope too steep', 30: 'Charging system problem', 31: 'STOP button problem',
  32: 'Tilt sensor problem', 33: 'Mower tilted', 34: 'Cutting stopped - slope too steep',
  35: 'Wheel motor overloaded, right', 36: 'Wheel motor overloaded, left', 37: 'Charging current too high', 38: 'Electronic problem',
  39: 'Cutting motor problem', 40: 'Limited cutting height range', 41: 'Unexpected cutting height adj', 42: 'Limited cutting height range',
  43: 'Cutting height problem, drive', 44: 'Cutting height problem, curr', 45: 'Cutting height problem, dir', 46: 'Cutting height blocked',
  47: 'Cutting height problem', 48: 'No response from charger', 49: 'Ultrasonic problem',
  50: 'Guide 1 not found', 51: 'Guide 2 not found', 52: 'Guide 3 not found', 53: 'GPS navigation problem', 54: 'Weak GPS signal',
  55: 'Difficult finding home', 56: 'Guide calibration accomplished', 57: 'Guide calibration failed',
  58: 'Temporary battery problem', 59: 'Temporary battery problem', 60: 'Temporary battery problem', 61: 'Temporary battery problem',
  62: 'Battery restriction due to ambient temperature', 63: 'Temporary battery problem', 64: 'Temporary battery problem',
  65: 'Temporary battery problem', 66: 'Battery problem', 67: 'Battery problem', 68: 'Temporary battery problem',
  69: 'Alarm! Mower switched off', 70: 'Alarm! Mower stopped', 71: 'Alarm! Mower lifted', 72: 'Alarm! Mower tilted',
  73: 'Alarm! Mower in motion', 74: 'Alarm! Outside geofence', 75: 'Connection changed', 76: 'Connection NOT changed',
  77: 'Com board not available', 78: 'Slipped - situation not solved with moving pattern', 79: 'Invalid battery combination',
  80: 'Cutting system imbalance warning', 81: 'Safety function faulty',
  82: 'Wheel motor blocked, rear right', 83: 'Wheel motor blocked, rear left', 84: 'Wheel drive problem, rear right', 85: 'Wheel drive problem, rear left',
  86: 'Wheel motor overloaded, rear right', 87: 'Wheel motor overloaded, rear left', 88: 'Angular sensor problem',
  89: 'Invalid system configuration', 90: 'No power in charging station', 91: 'Switch cord problem', 92: 'Work area not valid',
  93: 'No accurate position from satellites', 94: 'Reference station communication problem', 95: 'Folding sensor activated',
  96: 'Right brush motor overloaded', 97: 'Left brush motor overloaded',
  98: 'Ultrasonic Sensor 1 defect', 99: 'Ultrasonic Sensor 2 defect', 100: 'Ultrasonic Sensor 3 defect', 101: 'Ultrasonic Sensor 4 defect',
  102: 'Cutting drive motor 1 defect', 103: 'Cutting drive motor 2 defect', 104: 'Cutting drive motor 3 defect', 105: 'Lift Sensor defect',
  106: 'Collision sensor defect', 107: 'Docking sensor defect', 108: 'Folding cutting deck sensor defect', 109: 'Loop sensor defect',
  110: 'Collision sensor error', 111: 'No confirmed position', 112: 'Cutting system major imbalance', 113: 'Complex working area',
  114: 'Too high discharge current', 115: 'Too high internal current', 116: 'High charging power loss', 117: 'High internal power loss',
  118: 'Charging system problem', 119: 'Zone generator problem', 120: 'Internal voltage error', 121: 'High internal temperature',
  122: 'CAN error', 123: 'Destination not reachable', 124: 'Destination blocked', 125: 'Battery needs replacement',
  126: 'Battery near end of life', 127: 'Battery problem', 128: 'Multiple reference stations detected', 129: 'Auxiliary cutting means blocked',
  130: 'Imbalanced auxiliary cutting disc detected', 131: 'Lifted in link arm', 132: 'EPOS accessory missing',
  133: 'Bluetooth communication with charging station failed', 134: 'Invalid software configuration', 135: 'Radar problem',
  136: 'Work area tampered', 137: 'High temperature in cutting motor, right', 138: 'High temperature in cutting motor, center',
  139: 'High temperature in cutting motor, left', 141: 'Wheel brush motor problem', 142: 'Self diagnostic error', 143: 'Accessory power problem',
  144: 'Boundary wire problem', 145: 'No correction data available', 147: 'Cutting disc lost', 148: 'Chassis collision',
  149: 'Vision system malfunction', 151: 'Poor vision performance', 152: 'Vision system error', 153: 'Charging aborted',
  154: 'Water hose found in working area', 155: 'PIN code changed', 156: 'WiFi settings changed', 157: 'Bluetooth settings changed',
  158: 'Cellular settings changed', 159: 'Mower installation position changed', 160: 'Firmware has been updated', 161: 'No charging station signal',
  701: 'Connectivity problem', 702: 'Connectivity settings restored', 703: 'Connectivity problem', 704: 'Connectivity problem',
  705: 'Connectivity problem', 706: 'Poor signal quality', 707: 'SIM card requires PIN', 708: 'SIM card locked', 709: 'SIM card not found',
  710: 'SIM card locked', 711: 'SIM card locked', 712: 'SIM card locked', 713: 'Geofence problem', 714: 'Geofence problem',
  715: 'Connectivity problem', 716: 'Connectivity problem', 717: 'SMS could not be sent', 724: 'Communication circuit board SW must be updated',
}
