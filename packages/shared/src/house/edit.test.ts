import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse, safeParseHouse } from './validate'
import { applyHouseEditToJson, withSurveyPoints } from './edit'
import { fitSurvey } from './survey'
import { PlacementError } from './place'
import type { Vec2 } from './geometry/vec2'

// Séance d'édition : la forme des pièces s'écrit en COTES, le polygone en est déduit.

type Room = { id: string; polygon: Vec2[]; openings: { id: string; segment?: number; offset?: number; width: number }[]; walls?: { segment: number; kind?: string; thickness?: number }[]; meta?: { survey?: { points: Vec2[] } } }
type Doc = { rooms: Room[]; levels: { id: string; outline?: Vec2[] }[] }
const room = (d: unknown, id: string) => (d as Doc).rooms.find((r) => r.id === id)!
const pointsOf = (d: unknown, id: string) => room(d, id).meta!.survey!.points

/** Centre absolu d'une ouverture murale (m). */
function centre(d: unknown, roomId: string, openingId: string): Vec2 {
  const r = room(d, roomId)
  const o = r.openings.find((x) => x.id === openingId)!
  const a = r.polygon[o.segment!]!, b = r.polygon[(o.segment! + 1) % r.polygon.length]!
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const t = (o.offset! + o.width / 2) / L
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

describe('withSurveyPoints : une maison jamais relevée reçoit ses cotes', () => {
  it('fitSurvey en redonne exactement les polygones, passage ouvert compris', () => {
    const fit = fitSurvey(withSurveyPoints(demo as never))
    expect(fit.problems).toEqual([])
    for (const r of demo.rooms) {
      const got = room(fit.doc, r.id).polygon
      r.polygon.forEach((p, i) => { expect(got[i]![0]).toBeCloseTo(p[0]!, 4); expect(got[i]![1]).toBeCloseTo(p[1]!, 4) })
    }
    // cloison salon | entrée : une seule ligne dans le relevé, à mi-chemin des deux faces
    expect(pointsOf(fit.doc, 'salon')[0]).toEqual([310, 0])
    expect(pointsOf(fit.doc, 'entree')[1]).toEqual([310, 0])
    expect(() => parseHouse(fit.doc)).not.toThrow()
  })

  it('ne touche pas une maison déjà relevée', () => {
    const once = withSurveyPoints(demo as never)
    expect(withSurveyPoints(once)).toBe(once)
  })
})

describe('applyHouseEditToJson : la forme', () => {
  it('agrandir le salon vers le sud : polygone recalculé, la baie garde sa place réelle', () => {
    const before = centre(demo, 'salon', 'baie')
    const shape: Vec2[] = [[310, -50], [1000, -50], [1000, 500], [310, 500]]
    const { doc, blocking } = applyHouseEditToJson(demo, { shapes: { salon: shape } })
    expect(blocking).toEqual([])
    expect(room(doc, 'salon').polygon[0]).toEqual([3.2, -0.5])
    const after = centre(doc, 'salon', 'baie')
    expect(after[0]).toBeCloseTo(before[0], 4)            // même abscisse : elle a suivi son mur, sans glisser
    expect(after[1]).toBeCloseTo(-0.5, 4)
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('pousser la cloison entrée | salon | cuisine : les portes restent à leur place le long des murs', () => {
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
    expect(centre(doc, 'salon', 'baie')[0]).toBeCloseTo(baie[0], 4)   // le coin a bougé, pas la baie
    expect(centre(doc, 'entree', 'porte-salon')[1]).toBeCloseTo(porte[1], 4)
    expect(centre(doc, 'entree', 'porte-salon')[0]).toBeCloseTo(x / 100 - 0.1, 4)   // sur la cloison déplacée
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('ajouter un sommet décale les numéros d’arête, pas les ouvertures', () => {
    const before = centre(demo, 'salon', 'fen-salon-est')
    // sommet colinéaire à x = 9 m, hors de la baie (4,70 → 7,10 m)
    const shape: Vec2[] = [[310, 0], [900, 0], [1000, 0], [1000, 500], [310, 500]]
    const { doc, blocking } = applyHouseEditToJson(demo, { shapes: { salon: shape } })
    expect(blocking).toEqual([])
    const o = room(doc, 'salon').openings.find((x) => x.id === 'fen-salon-est')!
    expect(o.segment).toBe(2)                              // était 1
    const after = centre(doc, 'salon', 'fen-salon-est')
    expect(after[0]).toBeCloseTo(before[0], 4)
    expect(after[1]).toBeCloseTo(before[1], 4)
    // le passage ouvert vers la cuisine a suivi son arête (2 → 3)
    expect(room(doc, 'salon').walls!.find((w) => w.kind === 'none')!.segment).toBe(3)
    expect(() => parseHouse(doc)).not.toThrow()
  })

  it('une pièce qui empiète sur sa voisine BLOQUE, sans lever', () => {
    const { blocking } = applyHouseEditToJson(demo, { shapes: { entree: [[0, 0], [360, 0], [360, 800], [0, 800]] } })
    expect(blocking.length).toBeGreaterThan(0)
  })

  it('une ouverture qui ne tient plus sur un mur raccourci est refusée par la validation', () => {
    // la baie (2,40 m, à 1,50 m du coin) ne tient plus sur une façade sud de 2 m
    const { doc, blocking } = applyHouseEditToJson(demo, { shapes: { salon: [[310, 0], [510, 0], [510, 500], [310, 500]] } })
    expect(blocking).toEqual([])
    const r = safeParseHouse(doc)
    expect(r.success).toBe(false)
  })

  it('refuse une pièce inconnue', () => {
    expect(() => applyHouseEditToJson(demo, { shapes: { nope: [[0, 0], [1, 0], [1, 1]] } })).toThrow(PlacementError)
  })

  it('l’apparence seule ne convertit pas la maison en relevé', () => {
    const { doc } = applyHouseEditToJson(demo, { appearance: { facade: { id: 'red-brick' } } })
    expect(room(doc, 'salon').meta?.survey).toBeUndefined()
  })
})
