import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { applyHouseEditToJson } from './edit'
import { insertVertex, moveVertex, pushWall, removeVertex, roomShape, setEdgeLength } from './shape'
import type { SurveyDoc } from './survey'

// Gestures on the shape. Demo ground floor, in measurements (cm): entrance x 0→310, living room x 310→1000 / y 0→500,
// kitchen x 310→1000 / y 500→800; the partition x = 310 is shared by the three.

const doc = demo as unknown as SurveyDoc

describe('pushWall', () => {
  it('a facade: only the room moves, and its corners stay square', () => {
    expect(pushWall(doc, 'salon', 0, 0.5)).toEqual({ salon: [[310, -50], [1000, -50], [1000, 500], [310, 500]] })
  })

  it('a partition drags the rooms across from it, by the same displacement', () => {
    const shapes = pushWall(doc, 'entree', 1, 0.2)
    expect(Object.keys(shapes).sort()).toEqual(['cuisine', 'entree', 'salon'])
    expect(shapes.entree).toEqual([[0, 0], [330, 0], [330, 800], [0, 800]])
    expect(shapes.salon![0]).toEqual([330, 0])
    expect(shapes.cuisine![3]).toEqual([330, 800])
    expect(applyHouseEditToJson(demo, { shapes }).blocking).toEqual([])
  })

  it('detached, the partition encroaches on the neighbors: the session is blocked', () => {
    const shapes = pushWall(doc, 'entree', 1, 0.2, false)
    expect(Object.keys(shapes)).toEqual(['entree'])
    expect(applyHouseEditToJson(demo, { shapes }).blocking.length).toBeGreaterThan(0)
  })
})

describe('setEdgeLength', () => {
  it('the next wall backs off: the south facade goes to 7.50 m', () => {
    const shapes = setEdgeLength(doc, 'salon', 0, 7.5)!
    expect(shapes.salon).toEqual([[310, 0], [1060, 0], [1060, 500], [310, 500]])
  })
})

describe('vertices', () => {
  it('add in the middle of a side, move, remove', () => {
    const one = insertVertex(doc, 'salon', 0)
    expect(one.salon).toEqual([[310, 0], [655, 0], [1000, 0], [1000, 500], [310, 500]])
    const moved = moveVertex(doc, 'salon', 1, [10, -1])
    expect(moved.salon![1]).toEqual([1000, -100])
    expect(removeVertex(doc, 'salon', 0)!.salon).toHaveLength(3)
    expect(removeVertex({ ...doc, rooms: [{ ...doc.rooms[0]!, polygon: [[0, 0], [1, 0], [0, 1]] }] } as SurveyDoc, 'entree', 0)).toBeNull()
  })

  it('roomShape reads the measurements in meters, surveyed house or not', () => {
    expect(roomShape(doc, 'salon')).toEqual([[3.1, 0], [10, 0], [10, 5], [3.1, 5]])
  })
})
