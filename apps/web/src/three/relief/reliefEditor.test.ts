import { describe, expect, it } from 'vitest'
import { Color, Group, PerspectiveCamera } from 'three'
import { computeTerrain, emptyReliefGrid, type Site, type Vec2 } from '@kasbah/shared'
import { RELIEF_HISTORY, ReliefEditor } from './reliefEditor'

const square = (s: number): Vec2[] => [[0, 0], [s, 0], [s, s], [0, s]]

function editor() {
  const site: Site = { elevation: 0, terrain: square(20), zones: [], parkings: [] }
  const grid = emptyReliefGrid(site.terrain, 2)
  const terrain = { ...computeTerrain(site), relief: grid }
  let current = grid                                  // la grille que l'éditeur tient (l'historique la remplace)
  const ed: ReliefEditor = new ReliefEditor({
    canvas: {} as HTMLCanvasElement, camera: new PerspectiveCamera(), parent: new Group(),
    terrain: () => ({ ...terrain, relief: current }), setControls: () => {}, invalidate: () => {},
    changed: () => {}, selectionChanged: () => {}, accent: new Color(0x8866ff),
  }, grid, true)
  current = ed.grid
  ed.selected = { i: 3, j: 3 }
  return ed
}

describe('éditeur du relief : annuler / rétablir', () => {
  it('annule et rétablit une saisie, et une nouvelle modification efface le rétablissement', () => {
    const ed = editor()
    expect(ed.canUndo).toBe(false)
    ed.setSelectedCm(50)
    ed.setSelectedCm(80)
    expect(ed.undo()).toBe(true)
    expect(ed.selectedCm()).toBe(50)
    expect(ed.undo()).toBe(true)
    expect(ed.selectedCm()).toBe(0)
    expect(ed.canUndo).toBe(false)
    expect(ed.redo()).toBe(true)
    expect(ed.selectedCm()).toBe(50)
    ed.setSelectedCm(20)
    expect(ed.canRedo).toBe(false)
  })

  it('une saisie qui ne change rien ne fait pas de pas', () => {
    const ed = editor()
    expect(ed.setSelectedCm(0)).toBe(false)
    expect(ed.canUndo).toBe(false)
  })

  it(`ne retient que ${RELIEF_HISTORY} pas`, () => {
    const ed = editor()
    for (let k = 1; k <= RELIEF_HISTORY + 5; k++) ed.setSelectedCm(k * 10)
    let n = 0
    while (ed.undo()) n++
    expect(n).toBe(RELIEF_HISTORY)
    expect(ed.selectedCm()).toBe(50)                // le 5e état : les 5 premiers pas sont oubliés
  })
})
