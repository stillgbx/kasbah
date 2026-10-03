// Gestes sur la FORME d'une pièce, exprimés sur ses cotes (le relevé) : pousser un mur, fixer la
// longueur d'un côté, déplacer / ajouter / retirer un sommet. Chaque geste rend les nouvelles cotes
// des pièces qu'il touche (unité et repère du relevé), prêtes pour `HouseEditPatch.shapes`.
//
// Pousser un mur garde les angles : le mur glisse le long de sa normale et ses deux sommets
// glissent le long des murs voisins. Un mur MITOYEN entraîne celui de la pièce d'en face (même
// ligne dans le relevé) : la cuisine grandit, le salon rétrécit d'autant, sans trou ni chevauchement.

import { houseToSurveyPoint, surveyEdges, surveyPointsToHouse, type SurveyConventions, type SurveyDoc } from './survey'
import { withSurveyPoints } from './edit'
import type { Vec2 } from './geometry/vec2'

export type Shapes = Record<string, Vec2[]>

/** Deux lignes de relevé plus proches que ça sont la MÊME cloison (m). */
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

/** Les cotes d'une pièce en mètres, dans le repère de la maison (conversion faite si la maison n'est pas relevée). */
export function roomShape(doc: SurveyDoc, roomId: string): Vec2[] {
  return rawOf(ctxOf(doc), roomId)
}

/** Intersection de deux droites (point, direction) ; `null` si parallèles. */
function meet(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = d[0] * e[1] - d[1] * e[0]
  if (Math.abs(den) < EPS) return null
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
  return [p[0] + d[0] * t, p[1] + d[1] * t]
}

/** L'arête `i` de `pts` repoussée de `delta` le long de sa normale extérieure ; ses sommets suivent les murs voisins. */
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

/** Les murs des AUTRES pièces du niveau qui sont la même cloison que l'arête `i` de `roomId`. */
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
 * Pousse le mur `edge` de `roomId` de `delta` mètres vers l'EXTÉRIEUR de la pièce (négatif = vers
 * l'intérieur). `coupled` : le mur de la pièce d'en face suit (même ligne de relevé).
 */
export function pushWall(doc: SurveyDoc, roomId: string, edge: number, delta: number, coupled = true): Shapes {
  const c = ctxOf(doc)
  const out: Shapes = { [roomId]: toSurvey(c, roomId, shiftEdge(rawOf(c, roomId), edge, delta)) }
  if (coupled) {
    for (const p of partnerEdges(c, roomId, edge)) {
      // en face, la normale est opposée : le même déplacement dans le monde est un `-delta`
      out[p.id] = toSurvey(c, p.id, shiftEdge(rawOf(c, p.id), p.edge, -delta))
    }
  }
  return out
}

/**
 * Donne la longueur `length` (m) au côté `edge` : c'est le mur SUIVANT qui recule ou avance (le
 * premier sommet du côté reste en place). `null` si le mur suivant prolonge celui-ci.
 */
export function setEdgeLength(doc: SurveyDoc, roomId: string, edge: number, length: number, coupled = true): Shapes | null {
  const pts = roomShape(doc, roomId)
  const es = surveyEdges(pts)
  const e = es[edge]!, next = es[(edge + 1) % pts.length]!
  const k = e.d[0] * next.n[0] + e.d[1] * next.n[1]
  if (Math.abs(k) < 1e-6) return null
  return pushWall(doc, roomId, (edge + 1) % pts.length, (length - e.L) / k, coupled)
}

/** Déplace le sommet `index` en `to` (m, repère de la maison). Aucune voisine n'est entraînée. */
export function moveVertex(doc: SurveyDoc, roomId: string, index: number, to: Vec2): Shapes {
  const c = ctxOf(doc)
  const pts = rawOf(c, roomId)
  pts[index] = to
  return { [roomId]: toSurvey(c, roomId, pts) }
}

/** Coupe le côté `edge` en deux par un sommet en son milieu (un décroché commence là). */
export function insertVertex(doc: SurveyDoc, roomId: string, edge: number): Shapes {
  const c = ctxOf(doc)
  const pts = rawOf(c, roomId)
  const a = pts[edge]!, b = pts[(edge + 1) % pts.length]!
  pts.splice(edge + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
  return { [roomId]: toSurvey(c, roomId, pts) }
}

/** Retire le sommet `index` ; `null` s'il n'en resterait que deux. */
export function removeVertex(doc: SurveyDoc, roomId: string, index: number): Shapes | null {
  const c = ctxOf(doc)
  const pts = rawOf(c, roomId)
  if (pts.length <= 3) return null
  pts.splice(index, 1)
  return { [roomId]: toSurvey(c, roomId, pts) }
}
