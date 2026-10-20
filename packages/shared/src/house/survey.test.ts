import { describe, expect, it } from 'vitest'
import { fitSurvey, overlappingRooms, type SurveyDoc } from './survey'
import type { Vec2 } from './geometry/vec2'

// `fitSurvey` (port of house/fit-survey.mjs) on a minimal surveyed house: two walled rooms
// back to back (8 cm partition) and a terrace against the south facade.

const room = (id: string, points: Vec2[], kind?: string) => ({ id, levelId: 'rdc', name: id, polygon: [] as Vec2[], openings: [], ...(kind ? { kind } : {}), meta: { survey: { points } } })
const house = (): SurveyDoc => ({
  levels: [{ id: 'rdc' }],
  defaults: { interiorWallThickness: 0.1, exteriorWallThickness: 0.3 },
  meta: { survey: { unit: 'cm', partition: 0.08 } },
  rooms: [
    room('a', [[0, 0], [400, 0], [400, 300], [0, 300]]),
    room('b', [[400, 0], [700, 0], [700, 300], [400, 300]]),
    room('t', [[0, -330], [700, -330], [700, 0], [0, 0]], 'terrace'),
  ],
})
const poly = (d: SurveyDoc, id: string) => d.rooms.find((r) => r.id === id)!.polygon

describe('fitSurvey', () => {
  it('shared partition: half-partition on each side, shared override written', () => {
    const { doc, problems } = fitSurvey(house())
    expect(problems).toEqual([])
    expect(poly(doc, 'a')).toEqual([[0, 0], [3.96, 0], [3.96, 3], [0, 3]])
    expect(poly(doc, 'b')).toEqual([[4.04, 0], [7, 0], [7, 3], [4.04, 3]])
    expect(doc.rooms.find((r) => r.id === 'a')!.walls).toEqual([{ segment: 1, kind: 'interior', thickness: 0.04 }])
  })

  it('terrace against a facade: the walled room keeps its face, the terrace absorbs the wall', () => {
    const { doc } = fitSurvey(house())
    expect(poly(doc, 't')[2]).toEqual([7, -0.3])
    expect(poly(doc, 't')[3]).toEqual([0, -0.3])
    expect(poly(doc, 'a')[0]).toEqual([0, 0])
  })

  it('level footprint = box of the walled rooms, enlarged by the exterior wall', () => {
    const { doc } = fitSurvey(house())
    expect(doc.levels[0]!.outline).toEqual([[-0.3, -0.3], [7.3, -0.3], [7.3, 3.3], [-0.3, 3.3]])
  })

  it('does not modify the received document, and gives the same result a second time', () => {
    const input = house()
    const once = fitSurvey(input)
    expect(input.rooms[0]!.polygon).toEqual([])
    const twice = fitSurvey(once.doc)
    expect(twice.changed).toBe(0)
  })

  it('overlap: seen by overlappingRooms, not by the facing-gap check', () => {
    const h = house()
    h.rooms[0]!.meta!.survey!.points = [[0, 0], [450, 0], [450, 300], [0, 300]]
    const { doc, problems } = fitSurvey(h)
    expect(problems).toEqual([])
    expect(overlappingRooms(doc)).toEqual(['a ↔ b : les pièces se chevauchent'])
  })
})
