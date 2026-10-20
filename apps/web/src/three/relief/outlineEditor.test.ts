import { describe, expect, it } from 'vitest'
import { Color, Group, PerspectiveCamera } from 'three'
import type { Vec2 } from '@kasbah/shared'
import { OUTLINE_HISTORY, OutlineEditor } from './outlineEditor'

const square: Vec2[] = [[0, 0], [20, 0], [20, 20], [0, 20]]

function editor(polygon: Vec2[] = square) {
  return new OutlineEditor({
    canvas: {} as HTMLCanvasElement, camera: new PerspectiveCamera(), parent: new Group(),
    ground: () => 0, setControls: () => {}, invalidate: () => {},
    changed: () => {}, selectionChanged: () => {}, accent: new Color(0x8866ff),
  }, polygon, true)
}

describe('outline editor', () => {
  it('moves the chosen vertex, rounded to 10 cm', () => {
    const ed = editor()
    ed.selected = 2
    expect(ed.setSelectedXY([25.04, 22.96])).toBe(true)
    expect(ed.polygon[2]).toEqual([25, 23])
    expect(square[2]).toEqual([20, 20])               // the input outline is not touched
  })

  it('refuses a move that would make the outline cross itself', () => {
    const ed = editor()
    ed.selected = 2
    expect(ed.setSelectedXY([10, -5])).toBe(false)    // the north-east corner passes under the south side
    expect(ed.polygon[2]).toEqual([20, 20])
    expect(ed.canUndo).toBe(false)
  })

  it('adds a vertex in the middle of a side and selects it', () => {
    const ed = editor()
    ed.insertOnEdge(3)                                // side (0, 20) → (0, 0)
    expect(ed.polygon).toEqual([[0, 0], [20, 0], [20, 20], [0, 20], [0, 10]])
    expect(ed.selected).toBe(4)
    ed.insertOnEdge(0)
    expect(ed.polygon[1]).toEqual([10, 0])
    expect(ed.selected).toBe(1)
  })

  it('removes a vertex, never below three', () => {
    const ed = editor()
    ed.selected = 1
    expect(ed.removeSelected()).toBe(true)
    expect(ed.polygon).toEqual([[0, 0], [20, 20], [0, 20]])
    expect(ed.selected).toBe(1)                       // the next one takes its place: removal in series
    expect(ed.canRemove).toBe(false)
    expect(ed.removeSelected()).toBe(false)
    expect(ed.polygon).toHaveLength(3)
  })

  it('refuses a removal that would make the outline cross itself', () => {
    // a square pierced by a spike from the west: without the north-east corner, the diagonal crosses it
    const ed = editor([[0, 0], [10, 0], [10, 10], [0, 10], [0, 6], [8, 5], [0, 4]])
    ed.selected = 2
    expect(ed.canRemove).toBe(false)
    expect(ed.removeSelected()).toBe(false)
    expect(ed.polygon).toHaveLength(7)
    ed.selected = 5                                   // the spike, for its part, can go
    expect(ed.canRemove).toBe(true)
  })

  it('undoes and redoes add, edit and removal', () => {
    const ed = editor()
    ed.insertOnEdge(0)
    ed.setSelectedXY([10, -3])
    ed.removeSelected()
    expect(ed.polygon).toEqual(square)
    expect(ed.undo()).toBe(true)
    expect(ed.polygon[1]).toEqual([10, -3])
    expect(ed.undo()).toBe(true)
    expect(ed.polygon[1]).toEqual([10, 0])
    expect(ed.undo()).toBe(true)
    expect(ed.polygon).toEqual(square)
    expect(ed.canUndo).toBe(false)
    expect(ed.redo()).toBe(true)
    expect(ed.polygon).toHaveLength(5)
  })

  it(`keeps only ${OUTLINE_HISTORY} steps`, () => {
    const ed = editor()
    ed.selected = 2
    for (let k = 1; k <= OUTLINE_HISTORY + 5; k++) ed.setSelectedXY([20 + k, 20])
    let n = 0
    while (ed.undo()) n++
    expect(n).toBe(OUTLINE_HISTORY)
  })
})

describe('outline editor: import', () => {
  it('replaces the outline in one history step, with no vertex selected', () => {
    const ed = editor()
    ed.selected = 1
    ed.setPolygon([[0, 0], [5, 0], [5, 5]])
    expect(ed.polygon).toEqual([[0, 0], [5, 0], [5, 5]])
    expect(ed.selected).toBeNull()
    expect(ed.undo()).toBe(true)
    expect(ed.polygon).toEqual(square)
  })
})
