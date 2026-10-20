// Gestures on the SHAPE of a room, expressed on its measurements (the survey): push a wall, set the
// length of a side, move / add / remove a vertex. Each gesture returns the new measurements
// of the rooms it touches (unit and reference frame of the survey), ready for `HouseEditPatch.shapes`.
//
// Pushing a wall keeps the angles: the wall slides along its normal and its two vertices
// slide along the neighboring walls. A SHARED wall drags that of the room across (same
// line in the survey): the kitchen grows, the living room shrinks by as much, without gap or overlap.

import { houseToSurveyPoint, surveyEdges, surveyPointsToHouse, type SurveyConventions, type SurveyDoc } from './survey'
import { withSurveyPoints } from './edit'
import type { Vec2 } from './geometry/vec2'

export type Shapes = Record<string, Vec2[]>

/** Two survey lines closer than this are the SAME partition (m). */
const SAME_LINE_M = 0.02
const EPS = 1e-9

interface Ctx { doc: SurveyDoc; conv: SurveyConventions }
const ctxOf = (input: SurveyDoc): Ctx => {
  const doc = withSurveyPoints(input)
  return { doc, conv: doc.meta?.survey ?? {} }
}
const rawOf = (c: Ctx, id: string): Vec2[] => {
  const r = c.doc.rooms.find((x) => x.id === id)
  if (!r) throw new Error(`unknown room "${id}"`)
  return surveyPointsToHouse(r.meta!.survey!.points!, r.levelId, c.conv)
}
const levelOf = (c: Ctx, id: string) => c.doc.rooms.find((x) => x.id === id)!.levelId
const toSurvey = (c: Ctx, id: string, pts: readonly Vec2[]): Vec2[] => pts.map((p) => houseToSurveyPoint(p, levelOf(c, id), c.conv))

/** The measurements of a room in meters, in the house reference frame (conversion done if the house is not surveyed). */
export function roomShape(doc: SurveyDoc, roomId: string): Vec2[] {
  return rawOf(ctxOf(doc), roomId)
}

/** Intersection of two lines (point, direction); `null` if parallel. */
function meet(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0]
  if (Math.abs(den) < EPS) return null
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
  return [p[0] + d[0] * t, p[1] + d[1] * t]
}

/** The edge `i` of `pts` pushed by `delta` along its outward normal; its vertices follow the neighboring walls. */
function shiftEdge(pts: readonly Vec2[], i: number, delta: number): Vec2[] {
  const n = pts.length
  const es = surveyEdges(pts)
  const e = es[i]!
  const a: Vec2 = [e.a[0] + e.n[0] * delta, e.a[1] + e.n[1] * delta]
  const prev = es[(i - 1 + n) % n]!, next = es[(i + 1) % n]!
  const va = meet(prev.a, prev.d, a, e.d) ?? a
  const vb = meet(next.a, next.d, a, e.d) ?? [e.b[0] + e.n[0] * delta, e.b[1] + e.n[1] * delta]
  const out = pts.map((p) => [p[0], p[1]] as Vec2)
  out[i] = va
  out[(i + 1) % n] = vb
  return out
}

/** The walls of the OTHER rooms of the level that are the same partition as the edge `i` of `roomId`. */
function partnerEdges(c: Ctx, roomId: string, i: number): { id: string; edge: number }[] {
  const e = surveyEdges(rawOf(c, roomId))[i]!
  const level = levelOf(c, roomId)
  const out: { id: string; edge: number }[] = []
  for (const r of c.doc.rooms) {
    if (r.id === roomId || r.levelId !== level) continue
    surveyEdges(rawOf(c, r.id)).forEach((o, j) => {
      if (e.d[0] * o.d[0] + e.d[1] * o.d[1] > -0.999) return
      const gap = (o.a[0] - e.a[0]) * e.n[0] + (o.a[1] - e.a[1]) * e.n[1]
      if (Math.abs(gap) > SAME_LINE_M) return
      const u = (p: Vec2) => (p[0] - e.a[0]) * e.d[0] + (p[1] - e.a[1]) * e.d[1]
      const lo = Math.max(0, Math.min(u(o.a), u(o.b))), hi = Math.min(e.L, Math.max(u(o.a), u(o.b)))
      if (hi - lo > 0.01) out.push({ id: r.id, edge: j })
    })
  }
  return out
}

/**
 * Pushes the wall `edge` of `roomId` by `delta` meters toward the OUTSIDE of the room (negative = toward
 * the inside). `coupled`: the wall of the room across follows (same survey line).
 */
export function pushWall(doc: SurveyDoc, roomId: string, edge: number, delta: number, coupled = true): Shapes {
  const c = ctxOf(doc)
  const out: Shapes = { [roomId]: toSurvey(c, roomId, shiftEdge(rawOf(c, roomId), edge, delta)) }
  if (coupled) {
    for (const p of partnerEdges(c, roomId, edge)) {
      // across, the normal is opposite: the same displacement in the world is a `-delta`
      out[p.id] = toSurvey(c, p.id, shiftEdge(rawOf(c, p.id), p.edge, -delta))
    }
  }
  return out
}

/**
 * Gives the length `length` (m) to the side `edge`: it is the NEXT wall that backs off or advances (the
 * first vertex of the side stays in place). `null` if the next wall extends this one.
 */
export function setEdgeLength(doc: SurveyDoc, roomId: string, edge: number, length: number, coupled = true): Shapes | null {
  const pts = roomShape(doc, roomId)
  const es = surveyEdges(pts)
  const e = es[edge]!, next = es[(edge + 1) % pts.length]!
  const k = e.d[0] * next.n[0] + e.d[1] * next.n[1]
  if (Math.abs(k) < 1e-6) return null
  return pushWall(doc, roomId, (edge + 1) % pts.length, (length - e.L) / k, coupled)
}

/** Moves the vertex `index` to `to` (m, house reference frame). No neighbor is dragged. */
export function moveVertex(doc: SurveyDoc, roomId: string, index: number, to: Vec2): Shapes {
  const c = ctxOf(doc)
  const pts = rawOf(c, roomId)
  pts[index] = to
  return { [roomId]: toSurvey(c, roomId, pts) }
}

/** Cuts the side `edge` in two with a vertex at its middle (a step starts there). */
export function insertVertex(doc: SurveyDoc, roomId: string, edge: number): Shapes {
  const c = ctxOf(doc)
  const pts = rawOf(c, roomId)
  const a = pts[edge]!, b = pts[(edge + 1) % pts.length]!
  pts.splice(edge + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
  return { [roomId]: toSurvey(c, roomId, pts) }
}

/** Removes the vertex `index`; `null` if only two would remain. */
export function removeVertex(doc: SurveyDoc, roomId: string, index: number): Shapes | null {
  const c = ctxOf(doc)
  const pts = rawOf(c, roomId)
  if (pts.length <= 3) return null
  pts.splice(index, 1)
  return { [roomId]: toSurvey(c, roomId, pts) }
}

/** Depth of a room placed against a wall (m). */
export const NEW_ROOM_DEPTH = 3
/** Side of a room placed on tap (m). */
export const NEW_ROOM_SIDE = 4

/**
 * The measurements of a room born AGAINST the wall `edge` of `roomId`: a rectangle of the length of the
 * wall by `depth` m, on the other side. It shares exactly the survey line: `fitSurvey` makes it
 * a shared partition, and the wall slid afterwards drags both rooms.
 */
export function roomAgainstWall(doc: SurveyDoc, roomId: string, edge: number, depth = NEW_ROOM_DEPTH): Vec2[] {
  const c = ctxOf(doc)
  const e = surveyEdges(rawOf(c, roomId))[edge]
  if (!e) throw new Error(`room "${roomId}" has no wall ${edge}`)
  const out = (p: Vec2): Vec2 => [p[0] + e.n[0] * depth, p[1] + e.n[1] * depth]
  return toSurvey(c, roomId, [e.b, e.a, out(e.a), out(e.b)])
}

/** The measurements of a `w` × `d` m rectangle centered on `at` (house reference frame), corners snapped to the decimeter. */
export function rectRoomAt(doc: SurveyDoc, levelId: string, at: Vec2, w = NEW_ROOM_SIDE, d = NEW_ROOM_SIDE): Vec2[] {
  const c = ctxOf(doc)
  const snap = (v: number) => Math.round(v * 10) / 10
  const x0 = snap(at[0] - w / 2), y0 = snap(at[1] - d / 2)
  return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + d], [x0, y0 + d]].map((p) => houseToSurveyPoint(p as Vec2, levelId, c.conv))
}
