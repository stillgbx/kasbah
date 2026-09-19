import type { z } from 'zod'
import { resolveDefaults } from './defaults'
import { houseSchema, isSurfaceOpening, type House } from './schema'
import { dist } from './geometry/vec2'
import { classifySegments, isWalled, openingSill, roomHeight } from './geometry/walls'
import { surfaceFitsInPolygon, surfaceRectsOverlap } from './openings'

// Validation croisée (références, ouvertures dans leur segment…) et lint non bloquant.

export interface HouseIssue { path: string; message: string }

export class HouseValidationError extends Error {
  constructor(readonly issues: HouseIssue[]) {
    super(`invalid house:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`)
    this.name = 'HouseValidationError'
  }
}

function crossRefs(house: House, ctx: z.RefinementCtx) {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  const defaults = resolveDefaults(house.defaults)
  const seen = new Map<string, string>()
  const unique = (id: string, path: (string | number)[]) => {
    const prev = seen.get(id)
    if (prev) issue(path, `duplicate id "${id}" (already used by ${prev})`)
    else seen.set(id, path.join('.'))
  }
  house.levels.forEach((l, i) => unique(l.id, ['levels', i, 'id']))
  house.rooms.forEach((r, i) => unique(r.id, ['rooms', i, 'id']))
  house.site.zones.forEach((zn, i) => unique(zn.id, ['site', 'zones', i, 'id']))
  house.site.parkings.forEach((pk, i) => unique(pk.id, ['site', 'parkings', i, 'id']))
  house.devices.forEach((d, i) => unique(d.id, ['devices', i, 'id']))
  house.arrays.forEach((a, i) => unique(a.id, ['arrays', i, 'id']))
  house.rooms.forEach((r, ri) => r.openings.forEach((o, oi) => unique(o.id, ['rooms', ri, 'openings', oi, 'id'])))

  const levels = new Map(house.levels.map((l) => [l.id, l]))
  const rooms = new Map(house.rooms.map((r) => [r.id, r]))
  const zones = new Set(house.site.zones.map((zn) => zn.id))
  const openingRoom = new Map<string, string>()
  house.rooms.forEach((r) => r.openings.forEach((o) => openingRoom.set(o.id, r.id)))

  const elevations = house.levels.map((l) => l.elevation)
  if (new Set(elevations).size !== elevations.length) issue(['levels'], 'two levels share the same elevation')

  house.rooms.forEach((room, ri) => {
    const level = levels.get(room.levelId)
    if (!level) { issue(['rooms', ri, 'levelId'], `unknown level "${room.levelId}"`); return }
    const n = room.polygon.length
    const H = roomHeight(room, level, defaults)
    room.walls?.forEach((w, wi) => {
      if (w.segment >= n) issue(['rooms', ri, 'walls', wi, 'segment'], `segment ${w.segment} out of range (polygon has ${n} edges)`)
    })
    const roomsOnLevel = house.rooms.filter((r) => r.levelId === room.levelId)
    const segs = isWalled(room) ? classifySegments(room, roomsOnLevel, defaults) : null
    const bySegment = new Map<number, { u0: number; u1: number; id: string }[]>()
    const surfaceList: { x: number; y: number; yaw: number; width: number; height: number; id: string; type: string }[] = []
    const roofLevelId = house.roof?.levelId ?? [...house.levels].sort((a, b) => b.elevation - a.elevation)[0]?.id
    room.openings.forEach((o, oi) => {
      const path = ['rooms', ri, 'openings', oi]
      if (isSurfaceOpening(o.type)) {
        if (o.x === undefined || o.y === undefined || o.yaw === undefined) return // schéma a déjà signalé
        if (o.type === 'roof-window' && roofLevelId && room.levelId !== roofLevelId) {
          issue(path, `roof-window must belong to a room on the roof level ("${roofLevelId}")`)
        }
        if (!surfaceFitsInPolygon([o.x, o.y], o.yaw, o.width, o.height, room.polygon)) {
          issue(path, `surface opening does not fit inside room polygon`)
        }
        // Sol et toit sont deux porteurs distincts : un puits de lumière et une fenêtre de toit
        // peuvent partager la même emprise en plan (puits traversant) sans se chevaucher.
        for (const other of surfaceList) {
          if (other.type !== o.type) continue
          if (surfaceRectsOverlap(
            { x: o.x, y: o.y, yaw: o.yaw, width: o.width, height: o.height },
            other,
          )) issue(path, `overlaps opening "${other.id}"`)
        }
        surfaceList.push({ x: o.x, y: o.y, yaw: o.yaw, width: o.width, height: o.height, id: o.id, type: o.type })
        return
      }
      if (o.segment === undefined || o.offset === undefined) return
      if (o.segment >= n) { issue([...path, 'segment'], `segment ${o.segment} out of range (polygon has ${n} edges)`); return }
      if (!isWalled(room)) { issue(path, `room kind "${room.kind}" has no walls`); return }
      const seg = segs![o.segment]!
      if (seg.kind === 'none') issue([...path, 'segment'], `segment ${o.segment} has wall kind "none"`)
      const L = dist(room.polygon[o.segment]!, room.polygon[(o.segment + 1) % n]!)
      if (o.offset + o.width > L + 1e-6) issue([...path, 'offset'], `opening exceeds segment length (${(o.offset + o.width).toFixed(2)} > ${L.toFixed(2)} m)`)
      if (openingSill(o, defaults) + o.height > H + 1e-6) issue([...path, 'height'], `opening exceeds room height (${H} m)`)
      const list = bySegment.get(o.segment) ?? []
      for (const other of list) {
        if (o.offset < other.u1 - 1e-6 && o.offset + o.width > other.u0 + 1e-6) issue(path, `overlaps opening "${other.id}"`)
      }
      list.push({ u0: o.offset, u1: o.offset + o.width, id: o.id })
      bySegment.set(o.segment, list)
    })
  })

  house.site.parkings.forEach((pk, i) => {
    if (pk.levelId && !levels.has(pk.levelId)) issue(['site', 'parkings', i, 'levelId'], `unknown level "${pk.levelId}"`)
  })

  house.devices.forEach((d, di) => {
    const path = ['devices', di]
    if (d.levelId && !levels.has(d.levelId)) issue([...path, 'levelId'], `unknown level "${d.levelId}"`)
    if (d.zoneId && !zones.has(d.zoneId)) issue([...path, 'zoneId'], `unknown zone "${d.zoneId}"`)
    if (d.roomId) {
      const room = rooms.get(d.roomId)
      if (!room) issue([...path, 'roomId'], `unknown room "${d.roomId}"`)
      else if (d.levelId && room.levelId !== d.levelId) issue([...path, 'levelId'], `room "${d.roomId}" is on level "${room.levelId}", not "${d.levelId}"`)
    }
    if (d.openingId) {
      const owner = openingRoom.get(d.openingId)
      if (!owner) issue([...path, 'openingId'], `unknown opening "${d.openingId}"`)
      else if (d.roomId && owner !== d.roomId) issue([...path, 'openingId'], `opening "${d.openingId}" belongs to room "${owner}"`)
    }
  })

  // un module lié deux fois (à un appareil posé, ou à deux emplacements) donnerait deux marqueurs pour un onduleur
  const bound = new Map<string, string>()
  house.devices.forEach((d, i) => { if (d.deviceId) bound.set(d.deviceId, `devices[${i}]`) })
  house.arrays.forEach((a, ai) => {
    const path = ['arrays', ai]
    if (!levels.has(a.levelId)) issue([...path, 'levelId'], `unknown level "${a.levelId}"`)
    if (a.panels.length > a.rows * a.cols) issue([...path, 'panels'], `${a.panels.length} panels for ${a.rows} × ${a.cols} slots`)
    a.panels.forEach((id, pi) => {
      if (!id) return
      const prev = bound.get(id)
      if (prev) issue([...path, 'panels', pi], `device "${id}" is already placed (${prev})`)
      else bound.set(id, `arrays[${ai}].panels[${pi}]`)
    })
  })

  if (house.roof?.levelId && !levels.has(house.roof.levelId)) issue(['roof', 'levelId'], `unknown level "${house.roof.levelId}"`)
}

export const houseSchemaStrict = houseSchema.superRefine(crossRefs)

function toIssues(err: z.ZodError): HouseIssue[] {
  return err.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') || '(root)',
    message: i.message,
  }))
}

/** Parse + validation croisée. Lève `HouseValidationError` avec des chemins lisibles. */
export function parseHouse(json: unknown): House {
  const r = houseSchemaStrict.safeParse(json)
  if (!r.success) throw new HouseValidationError(toIssues(r.error))
  return r.data
}

export function safeParseHouse(json: unknown): { success: true; house: House } | { success: false; issues: HouseIssue[] } {
  const r = houseSchemaStrict.safeParse(json)
  return r.success ? { success: true, house: r.data } : { success: false, issues: toIssues(r.error) }
}

export interface HouseWarning { code: string; path: string; message: string }

/** Avertissements non bloquants (choses légales mais probablement involontaires). */
export function lintHouse(house: House, knownDeviceIds?: ReadonlySet<string>): HouseWarning[] {
  const out: HouseWarning[] = []
  const devicesPerRoom = new Map<string, number>()
  house.devices.forEach((d) => { if (d.roomId) devicesPerRoom.set(d.roomId, (devicesPerRoom.get(d.roomId) ?? 0) + 1) })
  house.rooms.forEach((r, i) => {
    if (!devicesPerRoom.get(r.id) && r.kind === 'room') out.push({ code: 'ROOM_WITHOUT_DEVICE', path: `rooms[${i}]`, message: `room "${r.id}" has no device` })
  })
  house.levels.forEach((l, i) => {
    if (Math.abs(l.elevation - house.site.elevation) < 1e-6) out.push({ code: 'LEVEL_AT_TERRAIN', path: `levels[${i}].elevation`, message: `level "${l.id}" is at terrain elevation (floor/terrain z-fight); raise it by the slab thickness` })
  })
  house.devices.forEach((d, i) => {
    if (!d.deviceId) out.push({ code: 'DEVICE_UNBOUND', path: `devices[${i}]`, message: `device "${d.id}" is not bound to a plugin device` })
    else if (knownDeviceIds && !knownDeviceIds.has(d.deviceId)) out.push({ code: 'DEVICE_UNKNOWN', path: `devices[${i}].deviceId`, message: `no plugin device "${d.deviceId}"` })
  })
  return out
}
