import { describe, expect, it } from 'vitest'
import { centroid, isCCW, lineIntersect, offsetPolygon, perpRight, pointInPolygon, signedArea, type Vec2 } from './vec2'

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
  it('offsetPolygon grows a square by the distance on each side', () => {
    const grown = offsetPolygon(square, 0.5)
    expect(grown).toHaveLength(4)
    for (const p of grown) {
      expect(Math.abs(p[0] - 1)).toBeCloseTo(1.5)
      expect(Math.abs(p[1] - 1)).toBeCloseTo(1.5)
    }
  })
})
