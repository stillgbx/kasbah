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

describe('éditeur du contour', () => {
  it('déplace le sommet choisi, arrondi à 10 cm', () => {
    const ed = editor()
    ed.selected = 2
    expect(ed.setSelectedXY([25.04, 22.96])).toBe(true)
    expect(ed.polygon[2]).toEqual([25, 23])
    expect(square[2]).toEqual([20, 20])               // le contour d'entrée n'est pas touché
  })

  it('refuse un déplacement qui ferait se croiser le contour', () => {
    const ed = editor()
    ed.selected = 2
    expect(ed.setSelectedXY([10, -5])).toBe(false)    // le coin nord-est passe sous le côté sud
    expect(ed.polygon[2]).toEqual([20, 20])
    expect(ed.canUndo).toBe(false)
  })

  it('ajoute un sommet au milieu d’un côté et le choisit', () => {
    const ed = editor()
    ed.insertOnEdge(3)                                // côté (0, 20) → (0, 0)
    expect(ed.polygon).toEqual([[0, 0], [20, 0], [20, 20], [0, 20], [0, 10]])
    expect(ed.selected).toBe(4)
    ed.insertOnEdge(0)
    expect(ed.polygon[1]).toEqual([10, 0])
    expect(ed.selected).toBe(1)
  })

  it('retire un sommet, jamais en dessous de trois', () => {
    const ed = editor()
    ed.selected = 1
    expect(ed.removeSelected()).toBe(true)
    expect(ed.polygon).toEqual([[0, 0], [20, 20], [0, 20]])
    expect(ed.selected).toBe(1)                       // le suivant prend la place : on retire en série
    expect(ed.canRemove).toBe(false)
    expect(ed.removeSelected()).toBe(false)
    expect(ed.polygon).toHaveLength(3)
  })

  it('refuse un retrait qui ferait se croiser le contour', () => {
    // un carré percé d'une pointe depuis l'ouest : sans le coin nord-est, la diagonale la traverse
    const ed = editor([[0, 0], [10, 0], [10, 10], [0, 10], [0, 6], [8, 5], [0, 4]])
    ed.selected = 2
    expect(ed.canRemove).toBe(false)
    expect(ed.removeSelected()).toBe(false)
    expect(ed.polygon).toHaveLength(7)
    ed.selected = 5                                   // la pointe, elle, peut partir
    expect(ed.canRemove).toBe(true)
  })

  it('annule et rétablit ajout, saisie et retrait', () => {
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

  it(`ne retient que ${OUTLINE_HISTORY} pas`, () => {
    const ed = editor()
    ed.selected = 2
    for (let k = 1; k <= OUTLINE_HISTORY + 5; k++) ed.setSelectedXY([20 + k, 20])
    let n = 0
    while (ed.undo()) n++
    expect(n).toBe(OUTLINE_HISTORY)
  })
})

describe('éditeur du contour : import', () => {
  it('remplace le contour en un pas d’historique, sans sommet choisi', () => {
    const ed = editor()
    ed.selected = 1
    ed.setPolygon([[0, 0], [5, 0], [5, 5]])
    expect(ed.polygon).toEqual([[0, 0], [5, 0], [5, 5]])
    expect(ed.selected).toBeNull()
    expect(ed.undo()).toBe(true)
    expect(ed.polygon).toEqual(square)
  })
})
