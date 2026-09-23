import {
  deviceClassOf, geoDistance, HOME_RADIUS_M, isDeviceOn, stateKeys,
  type DeviceEntry, type LeafPredicate, type Predicate, type PredicateOp, type Target,
} from '@kasbah/shared'
import type { EvalContext } from './context'
import { isoDay } from './schedule'

// Évaluation d'un prédicat à TROIS valeurs : vrai, faux, ou `null` = on ne sait pas (appareil
// absent, indisponible, pas encore relevé, champ que le fabricant ne publie pas). Seul `true` compte
// comme vrai partout : un déclencheur ne part que sur un passage faux → vrai, un « sauf si » ne
// bloque que s'il est vrai. Un inconnu ne déclenche donc rien et n'empêche rien.

export type Tri = boolean | null

/** Champs de base qui ne sont pas des mesures : on ne compare pas sur eux. */
const NOT_FIELDS = new Set(['kind', 'updatedAt', 'available'])

/** Le champ existe-t-il dans l'état de ce kind ? */
export function isComparableField(entry: DeviceEntry, field: string): boolean {
  return !NOT_FIELDS.has(field) && stateKeys(entry.descriptor.kind).has(field)
}

function compare(actual: unknown, op: PredicateOp, expected: string | number | boolean): Tri {
  if (actual === undefined || actual === null) return null
  if (typeof actual === 'number' && typeof expected === 'number') {
    switch (op) {
      case 'eq': return actual === expected
      case 'ne': return actual !== expected
      case 'gt': return actual > expected
      case 'gte': return actual >= expected
      case 'lt': return actual < expected
      case 'lte': return actual <= expected
    }
  }
  if (typeof actual !== typeof expected) return null
  if (op === 'eq') return actual === expected
  if (op === 'ne') return actual !== expected
  return null                                    // un ordre sur un booléen ou un mot n'a pas de sens
}

/** L'appareil, s'il est là, joignable et relevé depuis son apparition ; sinon rien. */
function known(id: string, ctx: EvalContext): DeviceEntry | undefined {
  const e = ctx.device(id)
  return e && e.state.available && ctx.fresh(id) ? e : undefined
}

function minutesOf(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function leaf(p: LeafPredicate, ctx: EvalContext): Tri {
  switch (p.type) {
    case 'device': {
      const e = known(p.deviceId, ctx)
      if (!e || !isComparableField(e, p.field)) return null
      return compare((e.state as Record<string, unknown>)[p.field], p.op, p.value)
    }
    case 'deviceOn': {
      const e = known(p.deviceId, ctx)
      return e ? isDeviceOn(e.state, e.descriptor) : null
    }
    case 'vehicleOnSite': {
      const e = known(p.deviceId, ctx)
      const loc = e && 'location' in e.state ? e.state.location : undefined
      return loc ? geoDistance(ctx.house.origin, loc) < HOME_RADIUS_M : null
    }
    case 'vehicleParkedAt': {
      const e = known(p.deviceId, ctx)
      if (!e || !('location' in e.state) || !e.state.location) return null
      if (!ctx.house.site.parkings.some((pk) => pk.id === p.parkingId)) return null
      return ctx.parkingOf(p.deviceId) === p.parkingId
    }
    case 'anyInRoom': {
      if (!ctx.index.roomsById.has(p.roomId)) return null
      let unknown = false
      for (const e of ctx.entries()) {
        if (e.descriptor.kind !== p.kind || ctx.roomOf(e.descriptor.id) !== p.roomId) continue
        if (p.deviceClass && deviceClassOf(e.descriptor) !== p.deviceClass) continue
        if (!known(e.descriptor.id, ctx)) { unknown = true; continue }
        if (isDeviceOn(e.state, e.descriptor)) return true
      }
      return unknown ? null : false
    }
    case 'timeWindow': {
      const d = new Date(ctx.now)
      const m = d.getHours() * 60 + d.getMinutes()
      const from = minutesOf(p.from)
      const to = minutesOf(p.to)
      return from <= to ? m >= from && m < to : m >= from || m < to
    }
    case 'days': return p.days.includes(new Date(ctx.now).getDay())
    case 'dateRange': {
      const d = isoDay(new Date(ctx.now))
      return d >= p.from && d <= p.to
    }
  }
}

/** Au moins un vrai → vrai ; sinon au moins un inconnu → inconnu ; sinon faux. */
export function anyOf(values: Tri[]): Tri {
  if (values.includes(true)) return true
  return values.includes(null) ? null : false
}

export function evaluatePredicate(p: Predicate, ctx: EvalContext): Tri {
  const v = p.type === 'any' ? anyOf(p.of.map((q) => leaf(q, ctx))) : leaf(p, ctx)
  return p.not && v !== null ? !v : v
}

/**
 * Le changement d'état de cet appareil peut-il changer la valeur du prédicat ? Filtre les
 * déclencheurs d'état à réévaluer : ceux qui ne parlent que de l'heure ne dépendent d'aucun appareil.
 */
export function touches(p: Predicate, deviceId: string, ctx: EvalContext): boolean {
  if (p.type === 'any') return p.of.some((q) => touches(q, deviceId, ctx))
  switch (p.type) {
    case 'device': case 'deviceOn': case 'vehicleOnSite': return p.deviceId === deviceId
    // l'accrochage d'un engin dépend aussi des AUTRES engins (une place ne prend qu'un occupant)
    case 'vehicleParkedAt': { const k = ctx.device(deviceId)?.descriptor.kind; return p.deviceId === deviceId || k === 'vehicle' || k === 'mower' }
    case 'anyInRoom': return ctx.roomOf(deviceId) === p.roomId
    default: return false
  }
}

/**
 * Appareils visés par une action. Une cible NOMMÉE rend aussi les ids absents (erreur à rapporter) ;
 * une SÉLECTION se résout sur ce qui existe et répond au moment d'agir — une lampe injoignable n'en
 * fait pas partie, sans quoi chaque exécution nocturne se solderait par un échec partiel.
 */
export function resolveTarget(t: Target, ctx: EvalContext): { entries: DeviceEntry[]; missing: string[] } {
  if (t.type === 'devices') {
    const entries: DeviceEntry[] = []
    const missing: string[] = []
    for (const id of t.deviceIds) {
      const e = ctx.device(id)
      if (e) entries.push(e)
      else missing.push(id)
    }
    return { entries, missing }
  }
  const scoped = !!(t.roomIds?.length || t.levelIds?.length || t.zoneIds?.length)
  const inScope = (id: string) => {
    if (!scoped) return true
    const room = ctx.roomOf(id)
    const level = ctx.levelOf(id)
    const zone = ctx.zoneOf(id)
    return (!!room && !!t.roomIds?.includes(room)) || (!!level && !!t.levelIds?.includes(level)) || (!!zone && !!t.zoneIds?.includes(zone))
  }
  const excluded = new Set<string>()
  if (t.exceptRoomsWith) {
    const { kind, deviceClass } = t.exceptRoomsWith
    for (const e of ctx.entries()) {
      if (e.descriptor.kind !== kind || (deviceClass && deviceClassOf(e.descriptor) !== deviceClass)) continue
      const room = ctx.roomOf(e.descriptor.id)
      if (room && known(e.descriptor.id, ctx) && isDeviceOn(e.state, e.descriptor)) excluded.add(room)
    }
  }
  const entries = ctx.entries().filter((e) => {
    const id = e.descriptor.id
    if (e.descriptor.kind !== t.kind || !e.state.available) return false
    if (t.deviceClass && deviceClassOf(e.descriptor) !== t.deviceClass) return false
    if (!inScope(id)) return false
    const room = ctx.roomOf(id)
    return !(room && excluded.has(room))
  })
  return { entries, missing: [] }
}
