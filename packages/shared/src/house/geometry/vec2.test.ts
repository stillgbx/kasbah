import { describe, expect, it } from 'vitest'
import { centroid, clipConvex, isCCW, isConvex, lineIntersect, offsetPolygon, perpRight, pointInPolygon, signedArea, type Vec2 } from './vec2'

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
