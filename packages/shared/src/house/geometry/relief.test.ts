import { describe, expect, it } from 'vitest'
import { emptyReliefGrid, extendReliefGrid, footprintCeiling, PAD_BLEND, PAD_FLAT, padWeight, parseRelief, reliefDelta, reliefRange, reliefSurface, serializeRelief, terrainFootprints, terrainHeight } from './relief'
import { computeTerrain } from './site'
import type { Relief, Site } from '../schema'
import type { Vec2 } from './vec2'

const square = (x0: number, y0: number, s: number): Vec2[] => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]]
const bump: Relief = { step: 2, origin: [0, 0], rows: ['0 0 0 0', '0 50 0 0', '0 0 0 0', '0 0 0 -20'] }

describe('terrain relief', () => {
  it('reads back as it was written', () => {
    expect(serializeRelief(parseRelief(bump)!)).toEqual(bump)
  })

  it('passes THROUGH the nodes and extends by the edge outside the grid', () => {
    const g = parseRelief(bump)!
    expect(reliefDelta(g, 2, 2)).toBeCloseTo(0.5, 6)
    expect(reliefDelta(g, 6, 6)).toBeCloseTo(-0.2, 6)
    expect(reliefDelta(g, 40, 40)).toBeCloseTo(-0.2, 6)       // north-east corner extended
    expect(reliefDelta(g, 3, 2)).toBeGreaterThan(0)            // between two nodes, the bump falls back gently
    expect(reliefDelta(g, 3, 2)).toBeLessThan(0.5)
    expect(reliefRange(g)).toEqual([-0.2, 0.5])
  })

  it('a plateau followed by a drop gains neither a bump before the descent, nor a dip at the foot', () => {
    // plateau at 1 m over three nodes, then a drop to 0: over the whole row, never above 1 m nor below 0
    const g = parseRelief({ step: 2, origin: [0, 0], rows: Array.from({ length: 4 }, () => '100 100 100 0 0 0') })!
    for (let x = 0; x <= 10; x += 0.1) {
      const h = reliefDelta(g, x, 2)
      expect(h).toBeLessThanOrEqual(1 + 1e-9)
      expect(h).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(reliefDelta(g, 3, 2)).toBeCloseTo(1, 9)             // the plateau stays flat up to its edge
    expect(reliefDelta(g, 5, 2)).toBeCloseTo(0.5, 9)           // the descent is symmetric
  })

  it('stays flat around a basin, then comes back gently', () => {
    const pads = [square(0, 0, 4)]
    expect(padWeight(pads, 2, 2)).toBe(0)
    expect(padWeight(pads, 4 + PAD_FLAT - 0.01, 2)).toBe(0)
    const mid = padWeight(pads, 4 + PAD_FLAT + PAD_BLEND / 2, 2)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
    expect(padWeight(pads, 4 + PAD_FLAT + PAD_BLEND + 0.01, 2)).toBe(1)
    expect(padWeight(pads, 100, 100)).toBe(1)
  })

  it('without relief, the terrain is at its elevation everywhere — as before the field', () => {
    const site: Site = { elevation: -0.15, terrain: square(-10, -10, 40), zones: [], parkings: [], garden: [] }
    expect(terrainHeight(computeTerrain(site), 20, 20)).toBe(-0.15)
  })

  it('rises up to the wall, but is clipped below the floor of the room', () => {
    const house = {
      site: { elevation: -0.15 },
      levels: [{ id: 'rdc', elevation: 0 }, { id: 'etage', elevation: 2.85 }],
      rooms: [{ levelId: 'rdc', polygon: square(4, 4, 4) }, { levelId: 'etage', polygon: square(4, 12, 4) }],
    }
    const footprints = terrainFootprints(house, { slabThickness: 0.25, exteriorWallThickness: 0.3 })
    // the footprint overflows by half the wall, and its ceiling is the underside of the slab (never below the terrain)
    expect(footprintCeiling(footprints, 3.9, 6)).toBe(-0.15)
    expect(footprintCeiling(footprints, 3.8, 6)).toBe(Infinity)
    expect(footprintCeiling(footprints, 6, 14)).toBeCloseTo(2.6, 6)   // under an upper floor: its floor
    const hill: Relief = { step: 2, origin: [0, 0], rows: Array.from({ length: 10 }, () => Array(10).fill('120').join(' ')) }
    const t = computeTerrain({ elevation: -0.15, terrain: square(0, 0, 20), relief: hill, zones: [], parkings: [], garden: [] }, [], footprints)
    expect(terrainHeight(t, 3.5, 6)).toBeCloseTo(1.05, 6)            // against the wall: at its true height
    expect(terrainHeight(t, 6, 6)).toBe(-0.15)                        // in the room: below the floor
    expect(reliefSurface(t, 6, 6)).toBeCloseTo(1.05, 6)               // …but the node itself is indeed up there
    expect(terrainHeight(t, 6, 14)).toBeCloseTo(1.05, 6)              // under the overhanging upper floor: free below 2.6 m
  })

  it('an empty grid covers the outline with a margin of one cell, aligned on the step', () => {
    const g = emptyReliefGrid(square(-3, 1, 5), 2)
    expect(g.origin).toEqual([-6, -2])
    expect(g.origin[0] + (g.cols - 1) * g.step).toBeGreaterThanOrEqual(2 + 2)
    expect(g.origin[1] + (g.rows - 1) * g.step).toBeGreaterThanOrEqual(6 + 2)
    expect(g.cm.every((v) => v === 0)).toBe(true)
  })
})

describe('extendReliefGrid', () => {
  it('gives back the same grid when it already covers the outline', () => {
    const grid = emptyReliefGrid(square(0, 0, 10), 2)
    expect(extendReliefGrid(grid, square(0, 0, 10))).toBe(grid)
  })
  it('enlarges without moving the existing nodes, the new ones at the height of the edge', () => {
    const grid = parseRelief(bump)!
    const t0 = computeTerrain({ elevation: 0, terrain: square(0, 0, 6), zones: [], parkings: [], garden: [] })
    const grown = extendReliefGrid(grid, square(-5, 0, 11))
    expect(grown.step).toBe(2)
    expect(grown.origin).toEqual([-8, -2])
    // same surface everywhere: what was read outside the grid (the edge) is now read inside the grid
    for (const [x, y] of [[-6, 0], [2, 2], [7, 5], [-3, 9], [11, 11]] as Vec2[]) {
      expect(terrainHeight({ ...t0, relief: grown }, x, y)).toBeCloseTo(terrainHeight({ ...t0, relief: grid }, x, y), 6)
    }
  })
})
