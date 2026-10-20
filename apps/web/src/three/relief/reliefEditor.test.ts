import { describe, expect, it } from 'vitest'
import { Color, Group, PerspectiveCamera } from 'three'
import { computeTerrain, emptyReliefGrid, type Site, type Vec2 } from '@kasbah/shared'
import { RELIEF_HISTORY, ReliefEditor } from './reliefEditor'

const square = (s: number): Vec2[] => [[0, 0], [s, 0], [s, s], [0, s]]

function editor() {
  const site: Site = { elevation: 0, terrain: square(20), zones: [], parkings: [], garden: [] }
  const grid = emptyReliefGrid(site.terrain, 2)
  const terrain = { ...computeTerrain(site), relief: grid }
  let current = grid                                  // the grid the editor holds (the history replaces it)
  const ed: ReliefEditor = new ReliefEditor({
    canvas: {} as HTMLCanvasElement, camera: new PerspectiveCamera(), parent: new Group(),
    terrain: () => ({ ...terrain, relief: current }), setControls: () => {}, invalidate: () => {},
    changed: () => {}, selectionChanged: () => {}, accent: new Color(0x8866ff),
  }, grid, true)
  current = ed.grid
  ed.selected = { i: 3, j: 3 }
  return ed
}

describe('relief editor: undo / redo', () => {
  it('undoes and redoes an edit, and a new change clears the redo', () => {
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

  it('an edit that changes nothing does not add a step', () => {
    const ed = editor()
    expect(ed.setSelectedCm(0)).toBe(false)
    expect(ed.canUndo).toBe(false)
  })

  it(`keeps only ${RELIEF_HISTORY} steps`, () => {
    const ed = editor()
    for (let k = 1; k <= RELIEF_HISTORY + 5; k++) ed.setSelectedCm(k * 10)
    let n = 0
    while (ed.undo()) n++
    expect(n).toBe(RELIEF_HISTORY)
    expect(ed.selectedCm()).toBe(50)                // the 5th state: the first 5 steps are forgotten
  })
})
