import type { Capability, Command, DeviceDescriptor, JournalEntry, JournalSeverity, MowerRestriction, SiteMapShape, StateFor, StatePatch } from '@kasbah/shared'
import { MOWER_RESTRICTIONS } from '@kasbah/shared'
import type { PluginSiteMap } from '../../core/plugin'
import { messageSchema, messagesResponseSchema, mowerDataSchema, mowerSectionSchema, plannerSchema, positionSchema, stayOutZoneSchema, workAreaSchema, type MowerData, type WsEvent } from './types'

// Automower Connect API → contrat Kasbah. Fonctions PURES, testées sur les fixtures.
//
// Un robot = un appareil `mower`, identifié par l'UUID que le fabricant lui donne (stable, sans `:`
// ni espace : c'est ce que house.json liera). Deux sources qui disent la même chose sous deux formes :
//   - `toStatePatch` : la LISTE (`GET /mowers`) rend l'état complet de chaque robot ;
//   - `applyEvent` : le WebSocket pousse un DELTA — capturé le 2026-09-16 : `{ mower: { state:
//     "STOPPED" } }` seul, `{ mower: { inactiveReason: "PLANNING" } }` seul, un `planner` SANS
//     `nextStartTimestamp`. Un delta ne se mappe pas seul (le piège Overkiz du wiki) : il se FOND
//     dans la dernière lecture complète du robot, et c'est l'état fondu qui se mappe. D'où la
//     signature : l'événement ET le robot tel qu'on le connaît, en sortie le robot mis à jour ET le patch.

export const PLUGIN_ID = 'automower'

/** Ce que le robot sait faire : partir, se garer, dire sa batterie, suivre un planning, tenir son journal. */
export const CAPABILITIES = ['mow', 'park', 'battery', 'schedule', 'journal'] as const

/** Valide ressource par ressource : un robot à la forme inattendue ne prive pas la maison des autres. */
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
 * Ce que le robot déclare EN PLUS, d'après ses `capabilities` : des zones de travail, des zones
 * d'exclusion, et une carte pour un robot qui se positionne (GPS ou EPOS) — un robot sans position
 * n'a pas de terrain relevé à montrer.
 */
function optionalCapabilities(m: MowerData): Capability[] {
  const c = m.attributes.capabilities
  return [
    ...(c?.workAreas ? ['work_areas' as const] : []),
    ...(c?.stayOutZones ? ['stay_out_zones' as const] : []),
    ...(c?.position ? ['site_map' as const] : []),
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

/** Le robot parle au cloud du fabricant. Absent = on le suppose joignable, la lecture le dira. */
export function connectedOf(m: MowerData): boolean { return m.attributes.metadata?.connected !== false }

export type MowerActivity = StateFor<'mower'>['activity']

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/**
 * Deux champs du fabricant pour une activité Kasbah. `state` prime quand il dit une ERREUR, une
 * PAUSE ou un ARRÊT — le robot peut être « garé » de son point de vue et arrêté (capturé : un
 * `ParkUntilFurtherNotice` fait passer `state: STOPPED` avant que `activity` ne suive) ; puis
 * `activity` dit ce qu'il fait. `stopped` couvre le bouton STOP, l'arrêt dans le jardin, le robot
 * éteint et celui qui attend de se rallumer sans activité connue : ni garé, ni en pause, arrêté là
 * où il est.
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
 * Horodatages du fabricant. `nextStartTimestamp` et `errorCodeTimestamp` sont l'heure LOCALE du
 * robot écrite comme si elle était UTC (la bibliothèque de référence le documente ainsi) ; on la
 * ramène à un vrai instant avec le fuseau de la maison. La valeur est en millisecondes, parfois en
 * secondes sur d'anciens firmwares (même seuil que la référence : au-delà de l'an 3000 en secondes,
 * c'est des millisecondes). `statusTimestamp`, lui, est en UTC : il ne passe pas par ici.
 */
export function localTimestamp(raw: number, tz: string): number {
  const ms = raw > 32_503_680_000 ? raw : raw * 1000
  // deux passes : le décalage en vigueur à l'instant VRAI, pas à l'instant décalé (heure d'été)
  const guess = ms - tzOffsetMs(tz, ms)
  return ms - tzOffsetMs(tz, guess)
}

/** Décalage (ms) entre l'heure murale de `tz` et UTC à l'instant `at`. Fuseau inconnu = UTC. */
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

/** Le fuseau est valide pour `Intl` (la configuration le vérifie avant de l'accepter). */
export function isTimeZone(tz: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export interface MapOptions {
  /** Fuseau de la maison : celui dans lequel le robot écrit ses horodatages « locaux ». */
  tz: string
  /** Maintenant (ms) : date une position reçue sans horodatage. */
  now: number
}

const clampPct = (v: number | null | undefined) => Math.max(0, Math.min(100, Math.round(v ?? 0)))
const pos = (n: number | null | undefined) => (typeof n === 'number' && n > 0 ? n : undefined)

/** Texte du fabricant pour un code d'erreur ; un code hors table garde son numéro. */
export function errorText(code: number): string { return ERROR_TEXT[code] ?? `Error ${code}` }

/** Ce qu'une section `mower` dit de l'erreur : code, texte, date — ou leur effacement (`null`). */
function errorFields(mower: { errorCode?: number | null; errorCodeTimestamp?: number | null } | null | undefined, tz: string): Pick<StatePatch<'mower'>, 'errorCode' | 'errorMessage' | 'errorAt'> {
  const code = mower?.errorCode ?? 0
  if (code <= 0) return { errorCode: null, errorMessage: null, errorAt: null }
  const at = pos(mower?.errorCodeTimestamp)
  return { errorCode: code, errorMessage: errorText(code), errorAt: at === undefined ? null : localTimestamp(at, tz) }
}

/**
 * Pourquoi le robot reste à la station. Le `restrictedReason` du planificateur, SAUF quand le robot
 * est en mode `HOME` : c'est ainsi que le fabricant encode « garé jusqu'à nouvel ordre » (capturé
 * le 2026-09-16 après un `ParkUntilFurtherNotice` : `mode: HOME`, et le planificateur disait
 * toujours `WEEK_SCHEDULE`). Le mode prime : il dit que le robot ne partira pas tout seul.
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

/** Zones de travail lisibles ; une entrée à la forme inattendue est sautée. Absent = le robot n'en dit rien. */
function workAreasOf(a: MowerData['attributes']): StateFor<'mower'>['workAreas'] {
  if (!a.workAreas) return undefined
  return a.workAreas.flatMap((raw) => {
    const w = workAreaSchema.safeParse(raw)
    return w.success ? [{ id: w.data.workAreaId, name: w.data.name?.trim() ?? '', enabled: w.data.enabled !== false }] : []
  })
}

/** Zones d'exclusion : la section est ABSENTE tant qu'aucune n'est tracée — c'est une liste vide, pas une inconnue. */
function stayOutZonesOf(a: MowerData['attributes']): StateFor<'mower'>['stayOutZones'] {
  if (!a.capabilities?.stayOutZones) return undefined
  return (a.stayOutZones?.zones ?? []).flatMap((raw) => {
    const z = stayOutZoneSchema.safeParse(raw)
    return z.success ? [{ id: z.data.id, name: z.data.name?.trim() ?? '', enabled: z.data.enabled === true }] : []
  })
}

/** L'état complet d'un robot tel que la LISTE le rend. */
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
    battery: clampPct(a.battery?.batteryPercent),
    ...errorFields(a.mower, o.tz),
    ...plannerFields(a.planner, a.mower, o.tz),
    ...(typeof height === 'number' && height >= 1 && height <= 9 ? { cuttingHeight: Math.round(height) } : {}),
    ...(statusAt === undefined ? {} : { statusAt }),
    // la liste ne date pas ses positions : le dernier statut reçu est ce qui s'en approche le plus
    ...(first.success ? { location: { lat: first.data.latitude, lon: first.data.longitude, at: statusAt ?? o.now } } : {}),
    ...(stats ? { statistics: stats } : {}),
  }
}

/** Les clés PRÉSENTES d'un delta, sans celles qu'il ne nomme pas : c'est ce qu'on fond dans l'état connu. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/** Le relevé garde au plus autant de positions que le fabricant en rend dans la liste. */
const POSITIONS_MAX = 50

export interface AppliedEvent {
  /** Le robot tel qu'on le connaît APRÈS l'événement : c'est lui qu'on garde pour le suivant. */
  next: MowerData
  /** Ce que l'événement change dans l'état publié. */
  patch: StatePatch<'mower'>
}

/**
 * Un événement du WebSocket, fondu dans le robot tel qu'on le connaît → le robot mis à jour et le
 * patch à publier. `null` = rien pour nous (calendrier, phares, messages, forme inattendue).
 *
 * Les événements sont des DELTAS (capture du 2026-09-16) : `{ mower: { state: "STOPPED" } }` ne dit
 * rien de l'activité ni de l'erreur, `{ planner: { override, restrictedReason } }` ne redit pas le
 * prochain départ. Mapper le fragment seul effaçait l'erreur (`errorCode` absent lu comme « plus
 * d'erreur ») et le prochain départ (`nextStartTimestamp` absent lu comme « aucun »). On fond donc le
 * fragment dans la section connue, puis on mappe la section entière — comme si la liste l'avait rendue.
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
        patch: { activity: toActivity(mower), ...errorFields(mower, o.tz), ...plannerFields(a.planner, mower, o.tz) },
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

// ---- Journal ------------------------------------------------------------------------------------

/** Gravités du fabricant (majuscules) → contrat. Inconnue = information. */
function toSeverity(raw: string | null | undefined): JournalSeverity {
  switch (lower(raw)) {
    case 'fatal': case 'fatal_error': return 'fatal'
    case 'error': return 'error'
    case 'warning': return 'warning'
    default: return 'info'
  }
}

/**
 * Une ligne du journal, ou `null` si elle n'a ni date ni code. Position gardée seulement si elle en
 * est une : le journal capturé porte des `(2e-7 ; 6.2e-6)` — un GPS sans fix écrit presque zéro,
 * et ce n'est pas un point du jardin.
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

/** `GET /mowers/{id}/messages` → entrées du plus récent au plus ancien ; une ligne illisible est sautée. */
export function toJournal(raw: unknown, tz: string): JournalEntry[] {
  const parsed = messagesResponseSchema.safeParse(raw)
  const list = parsed.success ? parsed.data.data.attributes?.messages ?? [] : []
  return list.map((m) => toJournalEntry(m, tz)).filter((e): e is JournalEntry => e !== null).sort((a, b) => b.at - a.at)
}

/**
 * Corps JSON:API d'une commande. « Tondre » sans durée = REPRENDRE LE PLANNING (le robot décide),
 * avec durée = partir pour ce temps ; se garer jusqu'au prochain créneau ou jusqu'à nouvel ordre.
 * `null` = commande que ce plugin ne sait pas traduire.
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

// ---- Carte du terrain ---------------------------------------------------------------------------

/** Les attributs d'une balise SVG (`name="valeur"`), sans dépendre d'un DOM côté serveur. */
function svgAttributes(raw: string): Record<string, string> {
  return Object.fromEntries([...raw.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1]!, m[2]!]))
}

/** `"x,y x,y …"` en millimètres → points en mètres ; un nombre impair ou illisible ferme la liste. */
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
 * Une carte SVG du fabricant → les formes du contrat. Husqvarna code la nature par la COULEUR (sa
 * documentation : vert = zone de travail, rouge = zone d'exclusion, bleu = chemin, jaune = station).
 * Relevé sur un vrai 435X AWD le 2026-10-12 : coordonnées en MILLIMÈTRES, `x` vers l'est et `y`
 * vers le nord (même forme que la carte de l'appli) ; dans la carte GÉNÉRÉE, le vert est le terrain
 * entier (`main_area_0`), le rouge un obstacle relevé par le robot (`island_*`, la maison, un arbre)
 * et le bleu un câble guide (`guide_*`) ; c'est dans la carte de ZONES que le vert est une zone de
 * travail tracée à la main (id UUID, `title` = son nom, avec ses espaces) et le rouge une zone
 * d'exclusion (même UUID que dans `stayOutZones`) — ou de RÉENSAUVAGEMENT quand il porte
 * `rewildingzone="true"`, zone que la liste ne connaît pas. Désactivée, une zone y reste avec
 * `display="none"` (relevé du 2026-10-12).
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
    // une zone désactivée reste sur la carte, masquée (`display="none"`)
    const toggled = kind === 'stay_out' || kind === 'rewilding'
    shapes.push({ kind, id, ...(a.title?.trim() ? { name: a.title.trim() } : {}), ...(toggled ? { enabled: lower(a.display) !== 'none' } : {}), points })
  }
  return shapes
}

/**
 * Les cartes d'un robot fondues en une. La station est le PREMIER point de la ligne jaune : sur le
 * relevé, les câbles guides en partent tous, c'est la plaque de charge. Sans ligne jaune, pas de
 * station, et la carte ne pourra pas se poser sur le monde.
 */
export function toSiteMap(maps: { svg: string; source: 'generated' | 'zone' | 'site' }[]): PluginSiteMap {
  const shapes = maps.flatMap((m) => parseSvgMap(m.svg, m.source))
  const station = shapes.find((s) => s.kind === 'station')?.points[0] ?? null
  return { station, shapes }
}

/**
 * Les codes d'erreur du fabricant et leur texte (anglais, tels qu'il les publie). La table vient de
 * la bibliothèque de référence (aioautomower), qui la tient à jour d'après la documentation. Le
 * texte est publié tel quel dans `errorMessage` : traduire 160 libellés techniques n'apporterait
 * rien, et c'est ce texte que le support et les forums connaissent.
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
