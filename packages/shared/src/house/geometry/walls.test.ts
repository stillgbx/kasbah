import { describe, expect, it } from 'vitest'
import { HOUSE_DEFAULTS } from '../defaults'
import { houseSchema, type Level, type Room } from '../schema'
import { clipConvex, signedArea, type Vec2 } from './vec2'
import { classifySegments, computeWalls, miterCorners, splitWall } from './walls'

const level: Level = { id: 'l', name: 'L', elevation: 0 }
const room = (partial: Partial<Room> & Pick<Room, 'id' | 'polygon'>): Room =>
  houseSchema.shape.rooms.element.parse({ levelId: 'l', name: partial.id, ...partial })

describe('classifySegments', () => {
  it('isolated rectangle → 4 exterior walls of exterior thickness', () => {
    const r = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] })
    const segs = classifySegments(r, [r], HOUSE_DEFAULTS)
    expect(segs.map((s) => s.kind)).toEqual(['exterior', 'exterior', 'exterior', 'exterior'])
    expect(segs[0]!.thickness).toBe(0.3)
    expect(segs[0]!.n).toEqual([0, -1])
  })
  it('two rooms 0.2 m apart → facing segments are interior', () => {
    const a = room({ id: 'a', polygon: [[0, 0], [3, 0], [3, 4], [0, 4]] })
    const b = room({ id: 'b', polygon: [[3.2, 0], [6, 0], [6, 4], [3.2, 4]] })
    const sa = classifySegments(a, [a, b], HOUSE_DEFAULTS)
    const sb = classifySegments(b, [a, b], HOUSE_DEFAULTS)
    expect(sa[1]!.kind).toBe('interior')
    expect(sa[1]!.thickness).toBe(0.1)
    expect(sb[3]!.kind).toBe('interior')
    expect(sa[0]!.kind).toBe('exterior')
  })
  it('overrides win', () => {
    const r = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], walls: [{ segment: 2, kind: 'none' }, { segment: 0, thickness: 0.5 }] })
    const segs = classifySegments(r, [r], HOUSE_DEFAULTS)
    expect(segs[2]!.kind).toBe('none')
    expect(segs[2]!.thickness).toBe(0)
    expect(segs[0]!.thickness).toBe(0.5)
  })
})

describe('miterCorners', () => {
  it('square corners are at ±thickness', () => {
    const r = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] })
    const corners = miterCorners(classifySegments(r, [r], HOUSE_DEFAULTS))
    expect(corners[0]!.outerStart[0]).toBeCloseTo(-0.3)
    expect(corners[0]!.outerStart[1]).toBeCloseTo(-0.3)
    expect(corners[0]!.outerEnd[0]).toBeCloseTo(4.3)
    expect(corners[0]!.outerEnd[1]).toBeCloseTo(-0.3)
  })
  it('mixed thickness corner lands on both offset lines', () => {
    const a = room({ id: 'a', polygon: [[0, 0], [3, 0], [3, 4], [0, 4]] })
    const b = room({ id: 'b', polygon: [[3.2, 0], [6, 0], [6, 4], [3.2, 4]] })
    const corners = miterCorners(classifySegments(a, [a, b], HOUSE_DEFAULTS))
    // fin du mur sud (ext 0.3) = début du mur est (int 0.1) → (3.1, -0.3)
    expect(corners[0]!.outerEnd[0]).toBeCloseTo(3.1)
    expect(corners[0]!.outerEnd[1]).toBeCloseTo(-0.3)
    expect(corners[1]!.outerStart).toEqual(corners[0]!.outerEnd)
  })
})

describe('splitWall', () => {
  it('no holes → one full piece', () => {
    expect(splitWall(4, 2.6, [])).toEqual([{ u0: 0, u1: 4, z0: 0, z1: 2.6 }])
  })
  it('a window → left, sill, lintel, right', () => {
    const pieces = splitWall(4, 2.6, [{ u0: 1, u1: 2, z0: 0.9, z1: 2.1, openingId: 'w', mirrored: false }])
    expect(pieces).toHaveLength(4)
    expect(pieces[1]).toMatchObject({ u0: 1, u1: 2, z0: 0, z1: 0.9, openingId: 'w' })
    expect(pieces[2]).toMatchObject({ u0: 1, u1: 2, z0: 2.1, z1: 2.6 })
  })
  it('a door flush at u=0 → lintel + right piece only', () => {
    const pieces = splitWall(4, 2.6, [{ u0: 0, u1: 0.9, z0: 0, z1: 2.1, openingId: 'd', mirrored: false }])
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toMatchObject({ u0: 0, u1: 0.9, z0: 2.1, z1: 2.6 })
  })
})

describe('computeWalls', () => {
  it('rectangle → 4 prisms, window → 7 (3 walls + left/sill/lintel/right), footprints are convex CCW quads', () => {
    const plain = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] })
    expect(computeWalls(level, [plain], HOUSE_DEFAULTS).prisms).toHaveLength(4)
    const withWindow = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]],
      openings: [{ id: 'w', type: 'window', segment: 0, offset: 1, width: 1, height: 1.2, sill: 0.9 }] })
    const { prisms, openings } = computeWalls(level, [withWindow], HOUSE_DEFAULTS)
    expect(prisms).toHaveLength(7)
    for (const p of prisms) expect(signedArea(p.footprint)).toBeGreaterThan(0)
    expect(openings).toHaveLength(1)
    expect(openings[0]).toMatchObject({ openingId: 'w', origin: [1, 0, 0.9], u: [1, 0], normal: [0, -1], width: 1, depth: 0.3 })
  })
  it('`none` segment emits no prism', () => {
    const r = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], walls: [{ segment: 2, kind: 'none' }] })
    const { prisms } = computeWalls(level, [r], HOUSE_DEFAULTS)
    expect(prisms).toHaveLength(3)
    expect(prisms.some((p) => p.segment === 2)).toBe(false)
  })
  it('an interior door is mirrored onto the facing room with a projected offset', () => {
    const a = room({ id: 'a', polygon: [[0, 0], [3, 0], [3, 4], [0, 4]],
      openings: [{ id: 'd', type: 'door', segment: 1, offset: 1, width: 0.9, height: 2.1 }] })
    const b = room({ id: 'b', polygon: [[3.2, 0], [6, 0], [6, 4], [3.2, 4]] })
    const { prisms } = computeWalls(level, [a, b], HOUSE_DEFAULTS)
    const aEast = prisms.filter((p) => p.roomId === 'a' && p.segment === 1)
    const bWest = prisms.filter((p) => p.roomId === 'b' && p.segment === 3)
    expect(aEast).toHaveLength(3)   // gauche, linteau, droite
    expect(bWest).toHaveLength(3)   // miroir
    const lintel = bWest.find((p) => p.openingId === 'd')!
    expect(lintel.z0).toBeCloseTo(2.1)
    // b.segment 3 va de (3.2,4) à (3.2,0) : u = 4 - y ; la porte est en y ∈ [1, 1.9] → u ∈ [2.1, 3]
    const ys = lintel.footprint.map((p) => p[1])
    expect(Math.min(...ys)).toBeCloseTo(1)
    expect(Math.max(...ys)).toBeCloseTo(1.9)
  })
  it('terrace rooms have no walls', () => {
    const t = room({ id: 't', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], kind: 'terrace' })
    expect(computeWalls(level, [t], HOUSE_DEFAULTS).prisms).toHaveLength(0)
  })
  it('building corner: the wall whose stub the neighbour covers is trimmed back', () => {
    // `a` pousse son mur est de 0.3 vers +x (bande x ∈ [2, 2.3]) ; `b` pousse son mur sud de
    // 0.3 vers -y (bande y ∈ [1.7, 2]) et arrive en x = 2.1, donc DANS la bande de `a`.
    // Le bout de `b` est entièrement repris par le mur de `a` : c'est `b` qui recule.
    const a = room({ id: 'a', polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] })
    const b = room({ id: 'b', polygon: [[2.1, 2], [5, 2], [5, 4], [2.1, 4]], walls: [{ segment: 3, kind: 'none' }] })
    const { prisms } = computeWalls(level, [a, b], HOUSE_DEFAULTS)
    const bSouth = prisms.filter((p) => p.roomId === 'b' && p.segment === 0)
    const aEast = prisms.find((p) => p.roomId === 'a' && p.segment === 1)!
    expect(bSouth).toHaveLength(1)
    expect(Math.min(...bSouth[0]!.footprint.map((v) => v[0]))).toBeCloseTo(2.3)
    const overlap = clipConvex(bSouth[0]!.footprint as Vec2[], aEast.footprint as Vec2[])
    expect(Math.abs(signedArea(overlap))).toBeLessThan(1e-9)
  })
  it('building corner: nothing is trimmed when neither wall covers the other', () => {
    // Ici le mitre de `b` sort de la bande de `a` : reculer `b` ouvrirait une fente, on garde
    // donc le recouvrement (moins laid qu'un trou).
    const a = room({ id: 'a', polygon: [[0, 0], [2, 0], [2, 2], [0, 2]] })
    const b = room({ id: 'b', polygon: [[2.1, 2], [5, 2], [5, 4], [2.1, 4]] })
    const { prisms } = computeWalls(level, [a, b], HOUSE_DEFAULTS)
    const bSouth = prisms.find((p) => p.roomId === 'b' && p.segment === 0)!
    expect(Math.min(...bSouth.footprint.map((v) => v[0]))).toBeCloseTo(1.8)
  })
  it('L-shaped room: reflex corner still yields convex quads', () => {
    const l = room({ id: 'l', polygon: [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]] })
    const { prisms } = computeWalls(level, [l], HOUSE_DEFAULTS)
    expect(prisms).toHaveLength(6)
    for (const p of prisms) {
      expect(signedArea(p.footprint)).toBeGreaterThan(0)
      // convexité : tous les produits vectoriels consécutifs de même signe
      const f = p.footprint
      for (let i = 0; i < 4; i++) {
        const a = f[i]!, b = f[(i + 1) % 4]!, c = f[(i + 2) % 4]!
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        expect(cr).toBeGreaterThanOrEqual(-1e-9)
      }
    }
  })
})
