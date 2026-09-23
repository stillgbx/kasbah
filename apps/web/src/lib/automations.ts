import {
  automationBodySchema, CLIMATE_MODES,
  type AutomationBody, type AutomationHealth, type Capability, type CommandInput, type DeviceKind,
  type LeafPredicate, type Predicate, type SunEvent, type Target, type Trigger,
} from '@kasbah/shared'
import type { IconName } from './strokeIcons'

// Lecture humaine d'une automatisation, et ce que l'éditeur propose. Tout est PUR : les noms
// (appareils, pièces, places, ambiances) arrivent par un contexte, les mots par `t` — testable sans
// store ni composant.

/** Action telle qu'on l'écrit (type d'ENTRÉE : `mower.park` a un défaut que zod pose au parse). */
export type ActionDraft = AutomationBody['actions'][number]

type Translate = (key: string, named?: Record<string, unknown> | number, plural?: number) => string

/** Ce qu'il faut pour NOMMER ce qu'une automatisation référence. Un id inconnu se rend tel quel. */
export interface NameContext {
  deviceName(id: string): string
  roomName(id: string): string
  levelName(id: string): string
  zoneName(id: string): string
  parkingName(id: string): string
  sceneName(id: string): string
}

// ── icônes et couleurs ──────────────────────────────────────────────────────────────────────────

export function triggerIcon(trigger: Trigger): IconName {
  if (trigger.type === 'state') return 'sensor'
  return trigger.at.kind === 'sun' ? 'sunHorizon' : 'clock'
}

/** Mêmes teintes que la santé d'un plugin dans les Réglages (`PluginSection`). */
export const HEALTH_DOT: Record<AutomationHealth, string> = {
  ok: 'var(--accent)',
  incomplete: '#d38b22',
  unavailable: '#d24a43',
}

// ── commandes proposées ─────────────────────────────────────────────────────────────────────────

/** Paramètre d'une commande : un pourcentage, un nombre, une adresse, ou un mode dans une liste. */
export type CommandParam =
  | { type: 'pct' }
  | { type: 'number'; min: number; max: number; step: number; unit: string }
  | { type: 'url' }
  | { type: 'enum'; values: readonly string[] }

export interface CommandChoice {
  /** Clé i18n `automations.command.<key>` et identité dans l'éditeur. */
  key: string
  kind: DeviceKind
  /** Capacité qu'un appareil doit déclarer pour se voir proposer la commande. */
  requires: Capability
  param?: CommandParam
  build(param?: number | string): CommandInput
  /** Cette commande est-elle celle-ci ? (relire une automatisation enregistrée) */
  matches(cmd: CommandInput): boolean
}

const is = (type: string) => (cmd: CommandInput) => cmd.type === type
const choice = (c: CommandChoice) => c

/**
 * Commandes offertes par kind, dans l'ordre des menus : l'usage courant d'abord. Ce n'est pas tout
 * le contrat — la mangeoire (portions par modèle) et les scènes de lampe attendront d'en avoir besoin.
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
  choice({ key: 'ev_charger.start', kind: 'ev_charger', requires: 'charge_control', build: () => ({ type: 'ev_charger.start' }), matches: is('ev_charger.start') }),
  choice({ key: 'ev_charger.stop', kind: 'ev_charger', requires: 'charge_control', build: () => ({ type: 'ev_charger.stop' }), matches: is('ev_charger.stop') }),
  choice({ key: 'pet_fountain.on', kind: 'pet_fountain', requires: 'on_off', build: () => ({ type: 'pet_fountain.set_power', on: true }), matches: (c) => c.type === 'pet_fountain.set_power' && c.on }),
  choice({ key: 'pet_fountain.off', kind: 'pet_fountain', requires: 'on_off', build: () => ({ type: 'pet_fountain.set_power', on: false }), matches: (c) => c.type === 'pet_fountain.set_power' && !c.on }),
]

/** Kinds qu'une action peut commander (ceux qui ont au moins une commande proposée). */
export const COMMANDABLE_KINDS: readonly DeviceKind[] = [...new Set(COMMAND_CHOICES.map((c) => c.kind))]

export function choicesFor(kind: DeviceKind): CommandChoice[] {
  return COMMAND_CHOICES.filter((c) => c.kind === kind)
}

export function choiceOf(cmd: CommandInput): CommandChoice | undefined {
  return COMMAND_CHOICES.find((c) => c.matches(cmd))
}

/** Valeur du paramètre portée par une commande enregistrée (ce que l'éditeur ré-affiche). */
export function paramOf(cmd: CommandInput): number | string | undefined {
  switch (cmd.type) {
    case 'light.set': return cmd.brightness
    case 'cover.set_position': return cmd.position
    case 'media_player.set_volume': return cmd.volume
    case 'media_player.play_url': return cmd.url
    case 'climate.set_mode': return cmd.mode
    case 'climate.set_target_temp': return cmd.targetTempC
    default: return undefined
  }
}

// ── phrases ─────────────────────────────────────────────────────────────────────────────────────

/** « Tous les jours », « Lun–ven », « Week-end », ou la liste des jours abrégés. */
export function daysLabel(days: readonly number[] | undefined, t: Translate, locale: string): string {
  if (!days || days.length === 7) return t('automations.summary.everyDay')
  const set = new Set(days)
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return t('automations.summary.weekdays')
  if (set.size === 2 && set.has(0) && set.has(6)) return t('automations.summary.weekend')
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  // lundi en tête : 4 janvier 2026 est un dimanche
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

/** Libellé d'un kind, précisé par sa nature quand elle est donnée (« Téléviseur » plutôt que « Lecteur »). */
export function kindLabel(kind: DeviceKind, deviceClass: string | undefined, t: Translate): string {
  if (deviceClass) {
    const ns = kind === 'cover' ? 'cover' : kind === 'media_player' ? 'media' : kind === 'camera' ? 'camera' : null
    if (ns) return t(`${ns}.classes.${deviceClass}`)
  }
  return t(`kinds.${kind}`)
}

/** Espaces i18n existants qui nomment déjà les valeurs d'un champ énuméré. */
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
  // en milieu de phrase : « chaque volet », « sauf pièces avec téléviseur en marche »
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
  return `${verb} · ${describeTarget(a.target, names, t)}`
}

/** La phrase d'une ligne de liste : « Quand · sauf si … → Alors ». */
/** Les exceptions, jointes par « ou » (il suffit d'une pour bloquer) ; vide s'il n'y en a pas. */
export function describeUnless(unless: readonly Predicate[], names: NameContext, t: Translate, locale: string): string {
  return unless.map((p) => describePredicate(p, names, t, locale)).join(t('automations.summary.or'))
}

/** Les actions, dans leur ordre d'exécution. */
export function describeActions(actions: readonly ActionDraft[], names: NameContext, t: Translate): string {
  return actions.map((x) => describeAction(x, names, t)).join(' ; ')
}

/** La phrase d'une automatisation, dans l'ordre de l'éditeur : « Quand → Alors · sauf si … ». */
export function describeAutomation(a: Pick<AutomationBody, 'trigger' | 'unless' | 'actions'>, names: NameContext, t: Translate, locale: string): string {
  const when = describeTrigger(a.trigger, names, t, locale)
  const unless = a.unless.length ? ` · ${t('automations.summary.unless', { conditions: describeUnless(a.unless, names, t, locale) })}` : ''
  return `${when} → ${describeActions(a.actions, names, t)}${unless}`
}

// ── brouillon ───────────────────────────────────────────────────────────────────────────────────

export type MissingPart = 'name' | 'trigger' | 'unless' | 'actions'

/**
 * Ce qui manque au brouillon pour être enregistrable, ou `null`. On se fie au schéma partagé — le
 * même que le serveur — plutôt qu'à une copie des règles : un brouillon accepté ici l'est là-bas.
 */
export function missingPart(draft: AutomationBody): MissingPart | null {
  const r = automationBodySchema.safeParse(draft)
  if (r.success) return null
  const first = r.error.issues[0]?.path[0]
  return first === 'name' || first === 'trigger' || first === 'unless' || first === 'actions' ? first : 'trigger'
}

/** Appareils nommés par une automatisation (prédicats et cibles nommées), pour la recherche. */
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

/** Pièces nommées par une automatisation, pour la recherche. */
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

/** Brouillon d'une automatisation neuve : chaque jour à 07:30, sans action (à compléter). */
export function blankAutomation(name = ''): AutomationBody {
  return { name, enabled: true, trigger: { type: 'time', at: { kind: 'clock', time: '07:30' } }, unless: [], actions: [] }
}

/** Types de condition offerts par les menus, dans l'ordre d'usage. */
export const PREDICATE_TYPES = ['anyInRoom', 'deviceOn', 'device', 'vehicleOnSite', 'vehicleParkedAt', 'timeWindow', 'days', 'dateRange', 'any'] as const satisfies readonly Predicate['type'][]

/** Une condition neuve, à compléter (un id vide rend le brouillon incomplet). */
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

/** Une action neuve : allumer des lumières à choisir, ou rappeler une ambiance à choisir. */
export function blankAction(type: ActionDraft['type']): ActionDraft {
  return type === 'recallScene'
    ? { type, sceneId: '', recall: { mode: 'static' } }
    : { type, target: { type: 'devices', deviceIds: [] }, command: { type: 'light.set', on: true } }
}
