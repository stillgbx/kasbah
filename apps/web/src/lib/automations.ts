import {
  automationBodySchema, CLIMATE_MODES, inverseCommand,
  type AutomationBody, type AutomationHealth, type Capability, type CommandInput, type DeviceKind,
  type LeafPredicate, type Predicate, type SunEvent, type Target, type Trigger,
} from '@kasbah/shared'
import type { IconName } from './strokeIcons'

// Human reading of an automation, and what the editor offers. Everything is PURE: the names
// (devices, rooms, places, light scenes) arrive through a context, the words through `t` — testable without
// a store or a component.

/** Action as it is written (INPUT type: `mower.park` has a default that zod sets at parse). */
export type ActionDraft = AutomationBody['actions'][number]

type Translate = (key: string, named?: Record<string, unknown> | number, plural?: number) => string

/** What it takes to NAME what an automation references. An unknown id is rendered as is. */
export interface NameContext {
  deviceName(id: string): string
  roomName(id: string): string
  levelName(id: string): string
  zoneName(id: string): string
  parkingName(id: string): string
  sceneName(id: string): string
}

// ── icons and colors ────────────────────────────────────────────────────────────────────────────

export function triggerIcon(trigger: Trigger): IconName {
  if (trigger.type === 'state') return 'sensor'
  return trigger.at.kind === 'sun' ? 'sunHorizon' : 'clock'
}

/** Same tints as a plugin's health in Settings (`PluginSection`). */
export const HEALTH_DOT: Record<AutomationHealth, string> = {
  ok: 'var(--accent)',
  incomplete: '#d38b22',
  unavailable: '#d24a43',
}

// ── offered commands ────────────────────────────────────────────────────────────────────────────

/** Parameter of a command: a percentage, a number, an address, or a mode in a list. */
export type CommandParam =
  | { type: 'pct' }
  | { type: 'number'; min: number; max: number; step: number; unit: string }
  | { type: 'url' }
  | { type: 'enum'; values: readonly string[] }

export interface CommandChoice {
  /** i18n key `automations.command.<key>` and identity in the editor. */
  key: string
  kind: DeviceKind
  /** Capability a device must declare to be offered the command. */
  requires: Capability
  param?: CommandParam
  build(param?: number | string): CommandInput
  /** Is this command the same as that one? (re-reading a saved automation) */
  matches(cmd: CommandInput): boolean
}

const is = (type: string) => (cmd: CommandInput) => cmd.type === type
const choice = (c: CommandChoice) => c

/**
 * Commands offered per kind, in menu order: common use first. It is not the whole
 * contract — the feeder (portions per model) and the lamp scenes will wait until they are needed.
 */
export const COMMAND_CHOICES: readonly CommandChoice[] = [
  choice({ key: 'light.on', kind: 'light', requires: 'on_off', build: () => ({ type: 'light.set', on: true }), matches: (c) => c.type === 'light.set' && c.on === true && c.brightness === undefined }),
  choice({ key: 'light.off', kind: 'light', requires: 'on_off', build: () => ({ type: 'light.set', on: false }), matches: (c) => c.type === 'light.set' && c.on === false }),
  choice({ key: 'light.brightness', kind: 'light', requires: 'brightness', param: { type: 'pct' }, build: (p) => ({ type: 'light.set', on: true, brightness: Number(p ?? 50) }), matches: (c) => c.type === 'light.set' && c.brightness !== undefined }),
  choice({ key: 'cover.open', kind: 'cover', requires: 'open_close', build: () => ({ type: 'cover.open' }), matches: is('cover.open') }),
  choice({ key: 'cover.close', kind: 'cover', requires: 'open_close', build: () => ({ type: 'cover.close' }), matches: is('cover.close') }),
  choice({ key: 'cover.set_position', kind: 'cover', requires: 'position', param: { type: 'pct' }, build: (p) => ({ type: 'cover.set_position', position: Number(p ?? 50) }), matches: is('cover.set_position') }),
  choice({ key: 'cover.preset', kind: 'cover', requires: 'preset', build: () => ({ type: 'cover.preset' }), matches: is('cover.preset') }),
  choice({ key: 'cover.stop', kind: 'cover', requires: 'stop', build: () => ({ type: 'cover.stop' }), matches: is('cover.stop') }),
  choice({ key: 'media_player.play', kind: 'media_player', requires: 'playback', build: () => ({ type: 'media_player.play' }), matches: is('media_player.play') }),
  choice({ key: 'media_player.pause', kind: 'media_player', requires: 'playback', build: () => ({ type: 'media_player.pause' }), matches: is('media_player.pause') }),
  choice({ key: 'media_player.stop', kind: 'media_player', requires: 'playback', build: () => ({ type: 'media_player.stop' }), matches: is('media_player.stop') }),
  choice({ key: 'media_player.set_volume', kind: 'media_player', requires: 'volume', param: { type: 'pct' }, build: (p) => ({ type: 'media_player.set_volume', volume: Number(p ?? 30) }), matches: is('media_player.set_volume') }),
  choice({ key: 'media_player.play_url', kind: 'media_player', requires: 'play_url', param: { type: 'url' }, build: (p) => ({ type: 'media_player.play_url', url: String(p ?? '') }), matches: is('media_player.play_url') }),
  choice({ key: 'climate.set_mode', kind: 'climate', requires: 'hvac_mode', param: { type: 'enum', values: CLIMATE_MODES }, build: (p) => ({ type: 'climate.set_mode', mode: (p ?? 'heat') as (typeof CLIMATE_MODES)[number] }), matches: is('climate.set_mode') }),
  choice({ key: 'climate.set_target_temp', kind: 'climate', requires: 'target_temp', param: { type: 'number', min: 5, max: 30, step: 0.5, unit: '°C' }, build: (p) => ({ type: 'climate.set_target_temp', targetTempC: Number(p ?? 19) }), matches: is('climate.set_target_temp') }),
  choice({ key: 'fan.on', kind: 'fan', requires: 'on_off', build: () => ({ type: 'fan.set', on: true }), matches: (c) => c.type === 'fan.set' && c.on === true }),
  choice({ key: 'fan.off', kind: 'fan', requires: 'on_off', build: () => ({ type: 'fan.set', on: false }), matches: (c) => c.type === 'fan.set' && c.on === false }),
  choice({ key: 'vacuum.start', kind: 'vacuum', requires: 'clean', build: () => ({ type: 'vacuum.start' }), matches: is('vacuum.start') }),
  choice({ key: 'vacuum.dock', kind: 'vacuum', requires: 'dock', build: () => ({ type: 'vacuum.dock' }), matches: is('vacuum.dock') }),
  choice({ key: 'mower.start', kind: 'mower', requires: 'mow', build: () => ({ type: 'mower.start' }), matches: is('mower.start') }),
  choice({ key: 'mower.park', kind: 'mower', requires: 'park', build: () => ({ type: 'mower.park', untilNextSchedule: true }), matches: is('mower.park') }),
  choice({ key: 'vehicle.lock', kind: 'vehicle', requires: 'lock', build: () => ({ type: 'vehicle.lock' }), matches: is('vehicle.lock') }),
  choice({ key: 'vehicle.unlock', kind: 'vehicle', requires: 'lock', build: () => ({ type: 'vehicle.unlock' }), matches: is('vehicle.unlock') }),
  choice({ key: 'vehicle.start_charge', kind: 'vehicle', requires: 'charging', build: () => ({ type: 'vehicle.start_charge' }), matches: is('vehicle.start_charge') }),
  choice({ key: 'vehicle.stop_charge', kind: 'vehicle', requires: 'charging', build: () => ({ type: 'vehicle.stop_charge' }), matches: is('vehicle.stop_charge') }),
  // Tesla's bounds (15-28 °C, those of the contract); the sleeping car is woken by the plugin
  choice({ key: 'vehicle.climate_start', kind: 'vehicle', requires: 'climate_precondition', param: { type: 'number', min: 15, max: 28, step: 0.5, unit: '°C' }, build: (p) => ({ type: 'vehicle.climate_start', targetTempC: Number(p ?? 20) }), matches: is('vehicle.climate_start') }),
  choice({ key: 'vehicle.climate_stop', kind: 'vehicle', requires: 'climate_precondition', build: () => ({ type: 'vehicle.climate_stop' }), matches: is('vehicle.climate_stop') }),
  choice({ key: 'ev_charger.start', kind: 'ev_charger', requires: 'charge_control', build: () => ({ type: 'ev_charger.start' }), matches: is('ev_charger.start') }),
  choice({ key: 'ev_charger.stop', kind: 'ev_charger', requires: 'charge_control', build: () => ({ type: 'ev_charger.stop' }), matches: is('ev_charger.stop') }),
  choice({ key: 'pet_fountain.on', kind: 'pet_fountain', requires: 'on_off', build: () => ({ type: 'pet_fountain.set_power', on: true }), matches: (c) => c.type === 'pet_fountain.set_power' && c.on }),
  choice({ key: 'pet_fountain.off', kind: 'pet_fountain', requires: 'on_off', build: () => ({ type: 'pet_fountain.set_power', on: false }), matches: (c) => c.type === 'pet_fountain.set_power' && !c.on }),
]

/** Kinds an action can command (those with at least one offered command). */
export const COMMANDABLE_KINDS: readonly DeviceKind[] = [...new Set(COMMAND_CHOICES.map((c) => c.kind))]

export function choicesFor(kind: DeviceKind): CommandChoice[] {
  return COMMAND_CHOICES.filter((c) => c.kind === kind)
}

export function choiceOf(cmd: CommandInput): CommandChoice | undefined {
  return COMMAND_CHOICES.find((c) => c.matches(cmd))
}

/** Value of the parameter carried by a saved command (what the editor re-displays). */
export function paramOf(cmd: CommandInput): number | string | undefined {
  switch (cmd.type) {
    case 'light.set': return cmd.brightness
    case 'cover.set_position': return cmd.position
    case 'media_player.set_volume': return cmd.volume
    case 'media_player.play_url': return cmd.url
    case 'climate.set_mode': return cmd.mode
    case 'climate.set_target_temp': return cmd.targetTempC
    case 'vehicle.climate_start': return cmd.targetTempC
    default: return undefined
  }
}

/**
 * Fade of a light (`transitionMs`), in seconds or whole minutes. Ceiling of one hour: Hue
 * v2 documents none, v1 stopped at 109 min.
 */
export const FADE_MAX_MS = 3_600_000
export function fadeLabel(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} min` : `${Math.round(ms / 1000)} s`
}

// ── phrases ─────────────────────────────────────────────────────────────────────────────────────

/** "Every day", "Mon–Fri", "Weekend", or the list of abbreviated days. */
export function daysLabel(days: readonly number[] | undefined, t: Translate, locale: string): string {
  if (!days || days.length === 7) return t('automations.summary.everyDay')
  const set = new Set(days)
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t('automations.summary.weekdays')
  if (set.size === 2 && set.has(0) && set.has(6)) return t('automations.summary.weekend')
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  // Monday first: January 4, 2026 is a Sunday
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d)).map((d) => fmt.format(new Date(2026, 0, 4 + d))).join(', ')
}

function dateLabel(iso: string, locale: string): string {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d))
}

function sunLabel(event: SunEvent, offsetMin: number | undefined, t: Translate): string {
  const n = Math.abs(offsetMin ?? 0)
  if (!n) return t(`automations.summary.sun.at.${event}`)
  return t(`automations.summary.sun.${(offsetMin ?? 0) < 0 ? 'before' : 'after'}.${event}`, { n })
}

export function describeTrigger(trigger: Trigger, names: NameContext, t: Translate, locale: string): string {
  if (trigger.type === 'state') {
    const when = describePredicate(trigger.when, names, t, locale)
    return trigger.forMin
      ? t('automations.summary.whenFor', { predicate: when, n: trigger.forMin })
      : t('automations.summary.when', { predicate: when })
  }
  const parts = [daysLabel(trigger.days, t, locale)]
  const at = trigger.at
  if (at.kind === 'clock') parts.push(t('automations.summary.at', { time: at.time }))
  else {
    parts.push(sunLabel(at.event, at.offsetMin, t))
    if (at.notBefore) parts.push(t('automations.summary.notBefore', { time: at.notBefore }))
    if (at.notAfter) parts.push(t('automations.summary.notAfter', { time: at.notAfter }))
  }
  if (trigger.dateRange) parts.push(t('automations.summary.dateRange', { from: dateLabel(trigger.dateRange.from, locale), to: dateLabel(trigger.dateRange.to, locale) }))
  return parts.join(' · ')
}

/** Label of a kind, refined by its nature when given ("TV" rather than "Player"). */
export function kindLabel(kind: DeviceKind, deviceClass: string | undefined, t: Translate): string {
  if (deviceClass) {
    const ns = kind === 'cover' ? 'cover' : kind === 'media_player' ? 'media' : kind === 'camera' ? 'camera' : null
    if (ns) return t(`${ns}.classes.${deviceClass}`)
  }
  return t(`kinds.${kind}`)
}

/** Existing i18n namespaces that already name the values of an enumerated field. */
const VALUE_NS: Record<string, string> = { playback: 'media', condition: 'weather.conditions', status: 'charger.status' }

function fieldValue(field: string, value: string | number | boolean, t: Translate): string {
  if (typeof value === 'boolean') return t(value ? 'automations.yes' : 'automations.no')
  const ns = typeof value === 'string' ? VALUE_NS[field] : undefined
  return ns ? t(`${ns}.${value}`) : String(value)
}

function describeLeaf(p: LeafPredicate, names: NameContext, t: Translate, locale: string): string {
  switch (p.type) {
    case 'device': return t('automations.predicate.text.device', {
      device: names.deviceName(p.deviceId), field: t(`automations.field.${p.field}`), op: t(`automations.op.${p.op}`), value: fieldValue(p.field, p.value, t),
    })
    case 'deviceOn': return t('automations.predicate.text.deviceOn', { device: names.deviceName(p.deviceId) })
    case 'vehicleOnSite': return t('automations.predicate.text.vehicleOnSite', { device: names.deviceName(p.deviceId) })
    case 'vehicleParkedAt': return t('automations.predicate.text.vehicleParkedAt', { device: names.deviceName(p.deviceId), parking: names.parkingName(p.parkingId) })
    case 'anyInRoom': return t('automations.predicate.text.anyInRoom', { what: kindLabel(p.kind, p.deviceClass, t), room: names.roomName(p.roomId) })
    case 'timeWindow': return t('automations.predicate.text.timeWindow', { from: p.from, to: p.to })
    case 'days': return daysLabel(p.days, t, locale)
    case 'dateRange': return t('automations.predicate.text.dateRange', { from: dateLabel(p.from, locale), to: dateLabel(p.to, locale) })
  }
}

export function describePredicate(p: Predicate, names: NameContext, t: Translate, locale: string): string {
  const text = p.type === 'any'
    ? p.of.map((q) => describeLeaf(q, names, t, locale)).join(t('automations.summary.or'))
    : describeLeaf(p, names, t, locale)
  return p.not ? t('automations.predicate.text.not', { text }) : text
}

export function describeTarget(target: Target, names: NameContext, t: Translate): string {
  if (target.type === 'devices') {
    return target.deviceIds.length === 1
      ? names.deviceName(target.deviceIds[0]!)
      : t('automations.summary.devices', target.deviceIds.length)
  }
  // mid-sentence: "every shutter", "unless rooms with a TV playing"
  const what = kindLabel(target.kind, target.deviceClass, t).toLowerCase()
  const scope = [
    ...(target.levelIds ?? []).map((id) => names.levelName(id)),
    ...(target.roomIds ?? []).map((id) => names.roomName(id)),
    ...(target.zoneIds ?? []).map((id) => names.zoneName(id)),
  ]
  const where = scope.length ? scope.join(', ') : t('automations.summary.wholeHouse')
  const except = target.exceptRoomsWith ? ` ${t('automations.summary.exceptRooms', { what: kindLabel(target.exceptRoomsWith.kind, target.exceptRoomsWith.deviceClass, t).toLowerCase() })}` : ''
  return `${t('automations.summary.all', { what })} · ${where}${except}`
}

export function describeAction(a: ActionDraft, names: NameContext, t: Translate): string {
  if (a.type === 'recallScene') return t('automations.summary.scene', { name: names.sceneName(a.sceneId) })
  const key = choiceOf(a.command)?.key
  const verb = key ? t(`automations.command.${key}`, { n: paramOf(a.command) ?? '' }) : a.command.type
  const fade = a.command.type === 'light.set' && a.command.transitionMs ? ` · ${t('automations.summary.fade', { d: fadeLabel(a.command.transitionMs) })}` : ''
  const forMin = a.forMin && inverseCommand(a.command) ? ` · ${t('automations.summary.forMin', { n: a.forMin })}` : ''
  return `${verb} · ${describeTarget(a.target, names, t)}${fade}${forMin}`
}

/** The phrase of a list line: "When · unless … → Then". */
/** The exceptions, joined by "or" (one is enough to block); empty if there are none. */
export function describeUnless(unless: readonly Predicate[], names: NameContext, t: Translate, locale: string): string {
  return unless.map((p) => describePredicate(p, names, t, locale)).join(t('automations.summary.or'))
}

/** The actions, in their execution order. */
export function describeActions(actions: readonly ActionDraft[], names: NameContext, t: Translate): string {
  return actions.map((x) => describeAction(x, names, t)).join(' ; ')
}

/** The phrase of an automation, in the editor's order: "When → Then · unless …". */
export function describeAutomation(a: Pick<AutomationBody, 'trigger' | 'unless' | 'actions'>, names: NameContext, t: Translate, locale: string): string {
  const when = describeTrigger(a.trigger, names, t, locale)
  const unless = a.unless.length ? ` · ${t('automations.summary.unless', { conditions: describeUnless(a.unless, names, t, locale) })}` : ''
  return `${when} → ${describeActions(a.actions, names, t)}${unless}`
}

// ── draft ───────────────────────────────────────────────────────────────────────────────────────

export type MissingPart = 'name' | 'trigger' | 'unless' | 'actions'

/**
 * What is missing from the draft to be saveable, or `null`. We rely on the shared schema — the
 * same as the server's — rather than a copy of the rules: a draft accepted here is accepted over there.
 */
export function missingPart(draft: AutomationBody): MissingPart | null {
  const r = automationBodySchema.safeParse(draft)
  if (r.success) return null
  const first = r.error.issues[0]?.path[0]
  return first === 'name' || first === 'trigger' || first === 'unless' || first === 'actions' ? first : 'trigger'
}

/** Devices named by an automation (predicates and named targets), for the search. */
export function involvedDeviceIds(a: Pick<AutomationBody, 'trigger' | 'unless' | 'actions'>): string[] {
  const ids = new Set<string>()
  const walk = (p: Predicate) => {
    if (p.type === 'any') p.of.forEach(walk)
    else if ('deviceId' in p) ids.add(p.deviceId)
  }
  if (a.trigger.type === 'state') walk(a.trigger.when)
  a.unless.forEach(walk)
  for (const x of a.actions) if (x.type === 'command' && x.target.type === 'devices') x.target.deviceIds.forEach((id) => ids.add(id))
  return [...ids]
}

/** Rooms named by an automation, for the search. */
export function involvedRoomIds(a: Pick<AutomationBody, 'trigger' | 'unless' | 'actions'>): string[] {
  const ids = new Set<string>()
  const walk = (p: Predicate) => {
    if (p.type === 'any') p.of.forEach(walk)
    else if (p.type === 'anyInRoom') ids.add(p.roomId)
  }
  if (a.trigger.type === 'state') walk(a.trigger.when)
  a.unless.forEach(walk)
  for (const x of a.actions) if (x.type === 'command' && x.target.type === 'selector') x.target.roomIds?.forEach((id) => ids.add(id))
  return [...ids]
}

/**
 * Id of a new automation. `crypto.randomUUID` only exists in a secure context (https or
 * localhost); served over http on the local network, the app falls back to 32 hexadecimal characters,
 * also accepted by `AUTOMATION_ID_RE`.
 */
export function newAutomationId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  }
}

/** The copy of an automation: same rule, DISABLED (two identical rules would act twice). */
export function duplicateBody(body: AutomationBody, name: string): AutomationBody {
  return { ...structuredClone(body), name: name.slice(0, 80), enabled: false }
}

/** Draft of a new automation: every day at 07:30, no action (to be completed). */
export function blankAutomation(name = ''): AutomationBody {
  return { name, enabled: true, trigger: { type: 'time', at: { kind: 'clock', time: '07:30' } }, unless: [], actions: [] }
}

/** Condition types offered by the menus, in order of use. */
export const PREDICATE_TYPES = ['anyInRoom', 'deviceOn', 'device', 'vehicleOnSite', 'vehicleParkedAt', 'timeWindow', 'days', 'dateRange', 'any'] as const satisfies readonly Predicate['type'][]

/** A new condition, to be completed (an empty id makes the draft incomplete). */
export function blankPredicate(type: Predicate['type'], today = new Date()): Predicate {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  switch (type) {
    case 'device': return { type, deviceId: '', field: '', op: 'eq', value: true }
    case 'deviceOn': case 'vehicleOnSite': return { type, deviceId: '' }
    case 'vehicleParkedAt': return { type, deviceId: '', parkingId: '' }
    case 'anyInRoom': return { type, roomId: '', kind: 'light' }
    case 'timeWindow': return { type, from: '22:00', to: '06:00' }
    case 'days': return { type, days: [1, 2, 3, 4, 5] }
    case 'dateRange': return { type, from: iso(today), to: iso(new Date(today.getFullYear(), today.getMonth() + 1, today.getDate())) }
    case 'any': return { type, of: [] }
  }
}

/** A new action: turn on lights to choose, or recall a light scene to choose. */
export function blankAction(type: ActionDraft['type']): ActionDraft {
  return type === 'recallScene'
    ? { type, sceneId: '', recall: { mode: 'static' } }
    : { type, target: { type: 'devices', deviceIds: [] }, command: { type: 'light.set', on: true } }
}
