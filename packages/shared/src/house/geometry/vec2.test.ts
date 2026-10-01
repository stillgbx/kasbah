import { describe, expect, it } from 'vitest'
import { centroid, clipConvex, isCCW, isConvex, isSimplePolygon, lineIntersect, longestEdgeYawDeg, offsetPolygon, perpRight, pointInPolygon, signedArea, type Vec2 } from './vec2'

const square: Vec2[] = [[0, 0], [2, 0], [2, 2], [0, 2]]

describe('vec2', () => {
  it('signed area / orientation', () => {
    expect(signedArea(square)).toBe(4)
    expect(isCCW(square)).toBe(true)
    expect(isCCW([...square].reverse())).toBe(false)
  })
  it('perpRight of a CCW edge points outward', () => {
    expect(perpRight([1, 0])).toEqual([0, -1])
  })
  it('line intersection', () => {
    expect(lineIntersect([0, 0], [1, 0], [1, -1], [0, 1])).toEqual([1, 0])
    expect(lineIntersect([0, 0], [1, 0], [0, 1], [1, 0])).toBeNull()
  })
  it('point in polygon', () => {
    expect(pointInPolygon([1, 1], square)).toBe(true)
    expect(pointInPolygon([3, 1], square)).toBe(false)
  })
  it('centroid', () => {
    expect(centroid(square)).toEqual([1, 1])
  })
  it('isConvex distinguishes a square from a dart', () => {
    expect(isConvex(square)).toBe(true)
    expect(isConvex([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2]])).toBe(false)
  })
  it('clipConvex intersects two overlapping squares, and returns nothing when disjoint', () => {
    const shifted: Vec2[] = [[1, 1], [3, 1], [3, 3], [1, 3]]
    expect(signedArea(clipConvex(square, shifted))).toBeCloseTo(1)
    expect(clipConvex(square, [[5, 5], [7, 5], [7, 7], [5, 7]])).toEqual([])
  })
  it('offsetPolygon grows a square by the distance on each side', () => {
    const grown = offsetPolygon(square, 0.5)
    expect(grown).toHaveLength(4)
    for (const p of grown) {
      expect(Math.abs(p[0] - 1)).toBeCloseTo(1.5)
      expect(Math.abs(p[1] - 1)).toBeCloseTo(1.5)
    }
  })
})

describe('longestEdgeYawDeg', () => {
  it('donne le sens de la plus longue arête, dans la convention yaw (0 = +y)', () => {
    // garage 3 × 6 allongé selon y : une voiture s'y range face à +y, yaw 0
    expect(longestEdgeYawDeg([[0, 0], [3, 0], [3, 6], [0, 6]])).toBeCloseTo(0, 6)
    // le même couché selon x : un quart de tour
    expect(Math.abs(longestEdgeYawDeg([[0, 0], [6, 0], [6, 3], [0, 3]])!)).toBeCloseTo(90, 6)
  })
  it('rend null sur un polygone dégénéré', () => {
    expect(longestEdgeYawDeg([])).toBeNull()
    expect(longestEdgeYawDeg([[1, 1], [1, 1], [1, 1]])).toBeNull()
  })
})

describe('isSimplePolygon', () => {
  it('accepte un carré, un L, et les deux sens de parcours', () => {
    expect(isSimplePolygon(square)).toBe(true)
    expect(isSimplePolygon([...square].reverse())).toBe(true)
    expect(isSimplePolygon([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]])).toBe(true)
  })
  it('refuse un huit, un côté nul, un sommet posé sur un autre côté, et moins de trois points', () => {
    expect(isSimplePolygon([[0, 0], [2, 2], [2, 0], [0, 2]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [2, 0], [2, 0], [0, 2]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [2, 0]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [1, 0], [2, 0]])).toBe(false)     // aplati : pas d'aire
  })
})
