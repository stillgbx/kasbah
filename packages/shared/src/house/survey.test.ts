import { describe, expect, it } from 'vitest'
import { fitSurvey, overlappingRooms, type SurveyDoc } from './survey'
import type { Vec2 } from './geometry/vec2'

// `fitSurvey` (portage de house/fit-survey.mjs) sur une maison relevée minimale : deux pièces murées
// dos à dos (cloison de 8 cm) et une terrasse contre la façade sud.

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
  it('cloison commune : demi-cloison de chaque côté, surcharge mitoyenne écrite', () => {
    const { doc, problems } = fitSurvey(house())
    expect(problems).toEqual([])
    expect(poly(doc, 'a')).toEqual([[0, 0], [3.96, 0], [3.96, 3], [0, 3]])
    expect(poly(doc, 'b')).toEqual([[4.04, 0], [7, 0], [7, 3], [4.04, 3]])
    expect(doc.rooms.find((r) => r.id === 'a')!.walls).toEqual([{ segment: 1, kind: 'interior', thickness: 0.04 }])
  })

  it('terrasse contre une façade : la pièce murée garde sa face, la terrasse absorbe le mur', () => {
    const { doc } = fitSurvey(house())
    expect(poly(doc, 't')[2]).toEqual([7, -0.3])
    expect(poly(doc, 't')[3]).toEqual([0, -0.3])
    expect(poly(doc, 'a')[0]).toEqual([0, 0])
  })

  it('emprise du niveau = boîte des pièces murées, élargie du mur extérieur', () => {
    const { doc } = fitSurvey(house())
    expect(doc.levels[0]!.outline).toEqual([[-0.3, -0.3], [7.3, -0.3], [7.3, 3.3], [-0.3, 3.3]])
  })

  it('ne modifie pas le document reçu, et redonne le même résultat une seconde fois', () => {
    const input = house()
    const once = fitSurvey(input)
    expect(input.rooms[0]!.polygon).toEqual([])
    const twice = fitSurvey(once.doc)
    expect(twice.changed).toBe(0)
  })

  it('chevauchement : vu par overlappingRooms, pas par le contrôle des vis-à-vis', () => {
    const h = house()
    h.rooms[0]!.meta!.survey!.points = [[0, 0], [450, 0], [450, 300], [0, 300]]
    const { doc, problems } = fitSurvey(h)
    expect(problems).toEqual([])
    expect(overlappingRooms(doc)).toEqual(['a ↔ b : les pièces se chevauchent'])
  })
})
