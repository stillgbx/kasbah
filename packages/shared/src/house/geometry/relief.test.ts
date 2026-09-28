import { describe, expect, it } from 'vitest'
import { emptyReliefGrid, footprintCeiling, PAD_BLEND, PAD_FLAT, padWeight, parseRelief, reliefDelta, reliefRange, reliefSurface, serializeRelief, terrainFootprints, terrainHeight } from './relief'
import { computeTerrain } from './site'
import type { Relief, Site } from '../schema'
import type { Vec2 } from './vec2'

const square = (x0: number, y0: number, s: number): Vec2[] => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]]
const bump: Relief = { step: 2, origin: [0, 0], rows: ['0 0 0 0', '0 50 0 0', '0 0 0 0', '0 0 0 -20'] }

describe('relief du terrain', () => {
  it('se relit tel qu’il a été écrit', () => {
    expect(serializeRelief(parseRelief(bump)!)).toEqual(bump)
  })

  it('passe PAR les nœuds et se prolonge par le bord hors de la grille', () => {
    const g = parseRelief(bump)!
    expect(reliefDelta(g, 2, 2)).toBeCloseTo(0.5, 6)
    expect(reliefDelta(g, 6, 6)).toBeCloseTo(-0.2, 6)
    expect(reliefDelta(g, 40, 40)).toBeCloseTo(-0.2, 6)       // coin nord-est prolongé
    expect(reliefDelta(g, 3, 2)).toBeGreaterThan(0)            // entre deux nœuds, la bosse retombe en douceur
    expect(reliefDelta(g, 3, 2)).toBeLessThan(0.5)
    expect(reliefRange(g)).toEqual([-0.2, 0.5])
  })

  it('un plateau suivi d’une chute ne gagne ni bosse avant la descente, ni creux au pied', () => {
    // plateau à 1 m sur trois nœuds, puis chute à 0 : sur toute la rangée, jamais au-dessus de 1 m ni sous 0
    const g = parseRelief({ step: 2, origin: [0, 0], rows: Array.from({ length: 4 }, () => '100 100 100 0 0 0') })!
    for (let x = 0; x <= 10; x += 0.1) {
      const h = reliefDelta(g, x, 2)
      expect(h).toBeLessThanOrEqual(1 + 1e-9)
      expect(h).toBeGreaterThanOrEqual(-1e-9)
    }
    expect(reliefDelta(g, 3, 2)).toBeCloseTo(1, 9)             // le plateau reste plat jusqu'à son bord
    expect(reliefDelta(g, 5, 2)).toBeCloseTo(0.5, 9)           // la descente est symétrique
  })

  it('reste plat autour d’un bassin, puis revient en douceur', () => {
    const pads = [square(0, 0, 4)]
    expect(padWeight(pads, 2, 2)).toBe(0)
    expect(padWeight(pads, 4 + PAD_FLAT - 0.01, 2)).toBe(0)
    const mid = padWeight(pads, 4 + PAD_FLAT + PAD_BLEND / 2, 2)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
    expect(padWeight(pads, 4 + PAD_FLAT + PAD_BLEND + 0.01, 2)).toBe(1)
    expect(padWeight(pads, 100, 100)).toBe(1)
  })

  it('sans relief, le terrain est à sa cote partout — comme avant le champ', () => {
    const site: Site = { elevation: -0.15, terrain: square(-10, -10, 40), zones: [], parkings: [], garden: [] }
    expect(terrainHeight(computeTerrain(site), 20, 20)).toBe(-0.15)
  })

  it('monte jusqu’au mur, mais s’écrête sous le plancher de la pièce', () => {
    const house = {
      site: { elevation: -0.15 },
      levels: [{ id: 'rdc', elevation: 0 }, { id: 'etage', elevation: 2.85 }],
      rooms: [{ levelId: 'rdc', polygon: square(4, 4, 4) }, { levelId: 'etage', polygon: square(4, 12, 4) }],
    }
    const footprints = terrainFootprints(house, { slabThickness: 0.25, exteriorWallThickness: 0.3 })
    // l'emprise déborde de la moitié du mur, et son plafond est le dessous de la dalle (jamais sous le terrain)
    expect(footprintCeiling(footprints, 3.9, 6)).toBe(-0.15)
    expect(footprintCeiling(footprints, 3.8, 6)).toBe(Infinity)
    expect(footprintCeiling(footprints, 6, 14)).toBeCloseTo(2.6, 6)   // sous un étage : son plancher
    const hill: Relief = { step: 2, origin: [0, 0], rows: Array.from({ length: 10 }, () => Array(10).fill('120').join(' ')) }
    const t = computeTerrain({ elevation: -0.15, terrain: square(0, 0, 20), relief: hill, zones: [], parkings: [], garden: [] }, [], footprints)
    expect(terrainHeight(t, 3.5, 6)).toBeCloseTo(1.05, 6)            // contre le mur : à sa vraie hauteur
    expect(terrainHeight(t, 6, 6)).toBe(-0.15)                        // dans la pièce : sous le sol
    expect(reliefSurface(t, 6, 6)).toBeCloseTo(1.05, 6)               // …mais le nœud, lui, est bien là-haut
    expect(terrainHeight(t, 6, 14)).toBeCloseTo(1.05, 6)              // sous l'étage en surplomb : libre sous 2,6 m
  })

  it('une grille vide couvre le contour avec une maille de marge, calée sur le pas', () => {
    const g = emptyReliefGrid(square(-3, 1, 5), 2)
    expect(g.origin).toEqual([-6, -2])
    expect(g.origin[0] + (g.cols - 1) * g.step).toBeGreaterThanOrEqual(2 + 2)
    expect(g.origin[1] + (g.rows - 1) * g.step).toBeGreaterThanOrEqual(6 + 2)
    expect(g.cm.every((v) => v === 0)).toBe(true)
  })
})
