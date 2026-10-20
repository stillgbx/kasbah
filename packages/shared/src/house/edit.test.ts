import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse, safeParseHouse } from './validate'
import { applyHouseEditToJson, withSurveyPoints } from './edit'
import { fitSurvey } from './survey'
import { PlacementError } from './place'
import type { Vec2 } from './geometry/vec2'

// Editing session: the shape of the rooms is written as MEASUREMENTS, the polygon is deduced from them.

type Room = { id: string; polygon: Vec2[]; openings: { id: string; segment?: number; offset?: number; width: number }[]; walls?: { segment: number; kind?: string; thickness?: number }[]; meta?: { survey?: { points: Vec2[] } } }
type Doc = { rooms: Room[]; levels: { id: string; outline?: Vec2[] }[] }
const room = (d: unknown, id: string) => (d as Doc).rooms.find((r) => r.id === id)!
const pointsOf = (d: unknown, id: string) => room(d, id).meta!.survey!.points

/** Absolute center of a wall opening (m). */
function centre(d: unknown, roomId: string, openingId: string): Vec2 {
  const r = room(d, roomId)
  const o = r.openings.find((x) => x.id === openingId)!
  const a = r.polygon[o.segment!]!, b = r.polygon[(o.segment! + 1) % r.polygon.length]!
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const t = (o.offset! + o.width / 2) / L
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

describe('withSurveyPoints: a house never surveyed receives its measurements', () => {
  it('fitSurvey gives back exactly the polygons, open passage included', () => {
    const fit = fitSurvey(withSurveyPoints(demo as never))
    expect(fit.problems).toEqual([])
    for (const r of demo.rooms) {
      const got = room(fit.doc, r.id).polygon
      r.polygon.forEach((p, i) => { expect(got[i]![0]).toBeCloseTo(p[0]!, 4); expect(got[i]![1]).toBeCloseTo(p[1]!, 4) })
    }
    // living room | entrance partition: a single line in the survey, halfway between the two faces
    expect(pointsOf(fit.doc, 'salon')[0]).toEqual([310, 0])
    expect(pointsOf(fit.doc, 'entree')[1]).toEqual([310, 0])
    expect(() => parseHouse(fit.doc)).not.toThrow()
  })

  it('does not touch a house already surveyed', () => {
    const once = withSurveyPoints(demo as never)
    expect(withSurveyPoints(once)).toBe(once)
  })
})

describe('applyHouseEditToJson: the shape', () => {
  it('enlarge the living room toward the south: polygon recomputed, the bay keeps its real place', () => {
    const before = centre(demo, 'salon', 'baie')
    const shape: Vec2[] = [[310, -50], [1000, -50], [1000, 500], [310, 500]]
    const { doc, blocking } = applyHouseEditToJson(demo, { shapes: { salon: shape } })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon').polygon[0]).toEqual([3.2, -0.5])
    const after = centre(doc, 'salon', 'baie')
    expect(after[0]).toBeCloseTo(before[0], 4)            // same abscissa: it followed its wall, without sliding
    expect(after[1]).toBeCloseTo(-0.5, 4)
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('push the entrance | living room | kitchen partition: the doors stay in place along the walls', () => {
    const x = 330
    const shapes: Record<string, Vec2[]> = {
      entree: [[0, 0], [x, 0], [x, 800], [0, 800]],
      salon: [[x, 0], [1000, 0], [1000, 500], [x, 500]],
      cuisine: [[x, 500], [1000, 500], [1000, 800], [x, 800]],
    }
    const baie = centre(demo, 'salon', 'baie')
    const porte = centre(demo, 'entree', 'porte-salon')
    const { doc, blocking } = applyHouseEditToJson(demo, { shapes })
    expect(blocking).toEqual([])
    expect(centre(doc, 'salon', 'baie')[0]).toBeCloseTo(baie[0], 4)   // the corner moved, not the bay
    expect(centre(doc, 'entree', 'porte-salon')[1]).toBeCloseTo(porte[1], 4)
    expect(centre(doc, 'entree', 'porte-salon')[0]).toBeCloseTo(x / 100 - 0.1, 4)   // on the moved partition
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('adding a vertex shifts the edge numbers, not the openings', () => {
    const before = centre(demo, 'salon', 'fen-salon-est')
    // collinear vertex at x = 9 m, outside the bay (4.70 → 7.10 m)
    const shape: Vec2[] = [[310, 0], [900, 0], [1000, 0], [1000, 500], [310, 500]]
    const { doc, blocking } = applyHouseEditToJson(demo, { shapes: { salon: shape } })
    expect(blocking).toEqual([])
    const o = room(doc, 'salon').openings.find((x) => x.id === 'fen-salon-est')!
    expect(o.segment).toBe(2)                              // was 1
    const after = centre(doc, 'salon', 'fen-salon-est')
    expect(after[0]).toBeCloseTo(before[0], 4)
    expect(after[1]).toBeCloseTo(before[1], 4)
    // the open passage to the kitchen followed its edge (2 → 3)
    expect(room(doc, 'salon').walls!.find((w) => w.kind === 'none')!.segment).toBe(3)
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('a room that encroaches on its neighbor BLOCKS, without throwing', () => {
    const { blocking } = applyHouseEditToJson(demo, { shapes: { entree: [[0, 0], [360, 0], [360, 800], [0, 800]] } })
    expect(blocking.length).toBeGreaterThan(0)
  })

  it('an opening that no longer fits on a shortened wall is refused by the validation', () => {
    // the bay (2.40 m, 1.50 m from the corner) no longer fits on a 2 m south facade
    const { doc, blocking } = applyHouseEditToJson(demo, { shapes: { salon: [[310, 0], [510, 0], [510, 500], [310, 500]] } })
    expect(blocking).toEqual([])
    const r = safeParseHouse(doc)
    expect(r.success).toBe(false)
  })

  it('refuses an unknown room', () => {
    expect(() => applyHouseEditToJson(demo, { shapes: { nope: [[0, 0], [1, 0], [1, 1]] } })).toThrow(PlacementError)
  })

  it('appearance alone does not convert the house into a survey', () => {
    const { doc } = applyHouseEditToJson(demo, { appearance: { facade: { id: 'red-brick' } } })
    expect(room(doc, 'salon').meta?.survey).toBeUndefined()
  })
})
