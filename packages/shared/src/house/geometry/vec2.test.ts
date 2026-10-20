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
  it('gives the direction of the longest edge, in the yaw convention (0 = +y)', () => {
    // 3 × 6 garage elongated along y: a car parks in it facing +y, yaw 0
    expect(longestEdgeYawDeg([[0, 0], [3, 0], [3, 6], [0, 6]])).toBeCloseTo(0, 6)
    // the same lying along x: a quarter turn
    expect(Math.abs(longestEdgeYawDeg([[0, 0], [6, 0], [6, 3], [0, 3]])!)).toBeCloseTo(90, 6)
  })
  it('returns null on a degenerate polygon', () => {
    expect(longestEdgeYawDeg([])).toBeNull()
    expect(longestEdgeYawDeg([[1, 1], [1, 1], [1, 1]])).toBeNull()
  })
})

describe('isSimplePolygon', () => {
  it('accepts a square, an L, and both winding directions', () => {
    expect(isSimplePolygon(square)).toBe(true)
    expect(isSimplePolygon([...square].reverse())).toBe(true)
    expect(isSimplePolygon([[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]])).toBe(true)
  })
  it('refuses a figure eight, a zero-length side, a vertex lying on another side, and fewer than three points', () => {
    expect(isSimplePolygon([[0, 0], [2, 2], [2, 0], [0, 2]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [2, 0], [2, 0], [0, 2]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [2, 0]])).toBe(false)
    expect(isSimplePolygon([[0, 0], [1, 0], [2, 0]])).toBe(false)     // flattened: no area
  })
})
