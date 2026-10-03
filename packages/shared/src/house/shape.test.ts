import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { applyHouseEditToJson } from './edit'
import { insertVertex, moveVertex, pushWall, removeVertex, roomShape, setEdgeLength } from './shape'
import type { SurveyDoc } from './survey'

// Gestes sur la forme. RDC de la démo, en cotes (cm) : entrée x 0→310, salon x 310→1000 / y 0→500,
// cuisine x 310→1000 / y 500→800 ; la cloison x = 310 est commune aux trois.

const doc = demo as unknown as SurveyDoc

describe('pushWall', () => {
  it('une façade : seule la pièce bouge, et ses angles restent droits', () => {
    expect(pushWall(doc, 'salon', 0, 0.5)).toEqual({ salon: [[310, -50], [1000, -50], [1000, 500], [310, 500]] })
  })

  it('une cloison entraîne les pièces d’en face, du même déplacement', () => {
    const shapes = pushWall(doc, 'entree', 1, 0.2)
    expect(Object.keys(shapes).sort()).toEqual(['cuisine', 'entree', 'salon'])
    expect(shapes.entree).toEqual([[0, 0], [330, 0], [330, 800], [0, 800]])
    expect(shapes.salon![0]).toEqual([330, 0])
    expect(shapes.cuisine![3]).toEqual([330, 800])
    expect(applyHouseEditToJson(demo, { shapes }).blocking).toEqual([])
  })

  it('détachée, la cloison empiète sur les voisines : la séance est bloquée', () => {
    const shapes = pushWall(doc, 'entree', 1, 0.2, false)
    expect(Object.keys(shapes)).toEqual(['entree'])
    expect(applyHouseEditToJson(demo, { shapes }).blocking.length).toBeGreaterThan(0)
  })
})

describe('setEdgeLength', () => {
  it('le mur suivant recule : la façade sud passe à 7,50 m', () => {
    const shapes = setEdgeLength(doc, 'salon', 0, 7.5)!
    expect(shapes.salon).toEqual([[310, 0], [1060, 0], [1060, 500], [310, 500]])
  })
})

describe('sommets', () => {
  it('ajouter au milieu d’un côté, déplacer, retirer', () => {
    const one = insertVertex(doc, 'salon', 0)
    expect(one.salon).toEqual([[310, 0], [655, 0], [1000, 0], [1000, 500], [310, 500]])
    const moved = moveVertex(doc, 'salon', 1, [10, -1])
    expect(moved.salon![1]).toEqual([1000, -100])
    expect(removeVertex(doc, 'salon', 0)!.salon).toHaveLength(3)
    expect(removeVertex({ ...doc, rooms: [{ ...doc.rooms[0]!, polygon: [[0, 0], [1, 0], [0, 1]] }] } as SurveyDoc, 'entree', 0)).toBeNull()
  })

  it('roomShape lit les cotes en mètres, maison relevée ou non', () => {
    expect(roomShape(doc, 'salon')).toEqual([[3.1, 0], [10, 0], [10, 5], [3.1, 5]])
  })
})
