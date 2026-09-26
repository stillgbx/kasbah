import { describe, expect, it } from 'vitest'
import { HOUSE_DEFAULTS } from './defaults'
import { computeHouseGeometry } from './geometry'
import { defaultRoofYaw, roofAtPoint } from './geometry/surface'
import { fitSurfaceGap, newOpeningDims, slotFromSurfacePoint, surfaceCorners, surfaceFitsInPolygon, surfaceGaps, surfaceRectsOverlap } from './openings'
import { withPanelArrays, type PanelPlacement } from './panels'
import { isSurfaceOpening, openingSchema, type House, type Room } from './schema'
import { parseHouse } from './validate'

const square: Room = {
  id: 'r', levelId: 'l', name: 'Room', kind: 'room',
  polygon: [[0, 0], [6, 0], [6, 6], [0, 6]],
  openings: [],
}

describe('surface openings', () => {
  it('isSurfaceOpening recognises the two new types', () => {
    expect(isSurfaceOpening('skylight')).toBe(true)
    expect(isSurfaceOpening('roof-window')).toBe(true)
    expect(isSurfaceOpening('window')).toBe(false)
  })

  it('openingSchema accepts a skylight with x/y/yaw and rejects missing yaw', () => {
    expect(openingSchema.parse({
      id: 's', type: 'skylight', x: 2, y: 2, yaw: 0, width: 1, height: 1,
    }).type).toBe('skylight')
    expect(() => openingSchema.parse({
      id: 's', type: 'skylight', x: 2, y: 2, width: 1, height: 1,
    })).toThrow()
  })

  it('openingSchema still requires segment/offset for a wall window', () => {
    expect(() => openingSchema.parse({
      id: 'w', type: 'window', width: 1, height: 1,
    })).toThrow()
    expect(openingSchema.parse({
      id: 'w', type: 'window', segment: 0, offset: 1, width: 1, height: 1.2,
    }).segment).toBe(0)
  })

  it('newOpeningDims gives a 1.2 m square for surface types', () => {
    expect(newOpeningDims('skylight', HOUSE_DEFAULTS)).toEqual({ width: 1.2, height: 1.2, sill: 0 })
    expect(newOpeningDims('roof-window', HOUSE_DEFAULTS)).toEqual({ width: 1.2, height: 1.2, sill: 0 })
  })

  it('slotFromSurfacePoint keeps a centred tap and rejects an oversized rectangle', () => {
    const ok = slotFromSurfacePoint(square, [3, 3], 0, 1, 1)
    expect(ok).toEqual({ x: 3, y: 3, yaw: 0 })
    expect(slotFromSurfacePoint(square, [3, 3], 0, 7, 7)).toBeNull()
  })

  it('surfaceRectsOverlap detects intersecting rectangles', () => {
    expect(surfaceRectsOverlap(
      { x: 2, y: 2, yaw: 0, width: 2, height: 2 },
      { x: 2.5, y: 2.5, yaw: 0, width: 2, height: 2 },
    )).toBe(true)
    expect(surfaceRectsOverlap(
      { x: 1, y: 1, yaw: 0, width: 1, height: 1 },
      { x: 4, y: 4, yaw: 0, width: 1, height: 1 },
    )).toBe(false)
  })

  it('surfaceFitsInPolygon requires all corners inside', () => {
    expect(surfaceFitsInPolygon([3, 3], 0, 1, 1, square.polygon)).toBe(true)
    expect(surfaceFitsInPolygon([0.2, 0.2], 0, 1, 1, square.polygon)).toBe(false)
  })

  it('surfaceCorners are four distinct points', () => {
    const c = surfaceCorners([3, 3], 90, 2, 1)
    expect(new Set(c.map((p) => p.join(','))).size).toBe(4)
  })

  it('surfaceGaps measures the four sides from the rectangle to the room', () => {
    const opening = {
      id: 's', type: 'skylight' as const, x: 3, y: 3, yaw: 0, width: 2, height: 2,
    }
    expect(surfaceGaps(square, opening)).toEqual({ front: 2, back: 2, left: 2, right: 2 })
    const slid = fitSurfaceGap(square, opening, 'front', 1)
    expect(slid).toEqual({ x: 3, y: 4 })
    expect(surfaceGaps(square, { ...opening, ...slid! })).toMatchObject({ front: 1, back: 3 })
  })

  it('surfaceGaps of a roof-window start at the edge of its hole, shortened by the slope', () => {
    // 1,2 m le long d'une pente de 60° : 0,6 m vu du ciel, donc 2,7 m de chaque côté dans 6 m
    const velux = { id: 'v', type: 'roof-window' as const, x: 3, y: 3, yaw: 0, width: 1, height: 1.2 }
    const gaps = surfaceGaps(square, velux, 60)
    expect(gaps.front).toBeCloseTo(2.7, 9)
    expect(gaps.back).toBeCloseTo(2.7, 9)
    expect(gaps.left).toBeCloseTo(2.5, 9)                    // la largeur ne penche pas
    const slid = fitSurfaceGap(square, velux, 'front', 1, 60)!
    expect(surfaceGaps(square, { ...velux, ...slid }, 60).front).toBeCloseTo(1, 9)
  })
})

describe('demo house surface openings', () => {
  it('parses the fixture with skylight and roof-window', async () => {
    const { default: raw } = await import('./__fixtures__/demo-house.json')
    const house = parseHouse(raw) as House
    const skylight = house.rooms.flatMap((r) => r.openings).find((o) => o.id === 'puits-salon')
    const velux = house.rooms.flatMap((r) => r.openings).find((o) => o.id === 'velux-ch1')
    expect(skylight?.type).toBe('skylight')
    expect(velux?.type).toBe('roof-window')
    const geo = computeHouseGeometry(house)
    const floorHoles = geo.levels.flatMap((l) => l.floors).filter((f) => f.holes && f.holes.length > 0)
    expect(floorHoles.length).toBeGreaterThan(0)
    expect(geo.roof?.holes?.length).toBeGreaterThan(0)
    const surfaceRects = geo.levels.flatMap((l) => l.openings).filter((o) => o.host !== 'wall')
    expect(surfaceRects.some((o) => o.host === 'floor')).toBe(true)
    expect(surfaceRects.some((o) => o.host === 'roof')).toBe(true)
    if (geo.roof) {
      const at = roofAtPoint(geo.roof, velux!.x!, velux!.y!)
      expect(at).not.toBeNull()
      expect(defaultRoofYaw(geo.roof, velux!.x!, velux!.y!)).toBeTypeOf('number')
    }
  })

  it('keeps every roof-window clear of the solar panels', async () => {
    const { default: raw } = await import('./__fixtures__/demo-house.json')
    const house = parseHouse(raw) as House
    const veluxes = house.rooms.flatMap((r) => r.openings).filter((o) => o.type === 'roof-window')
    expect(veluxes.length).toBeGreaterThan(0)
    const panels = withPanelArrays(house).devices.flatMap((d) => (d.meta?.panel && d.position ? [{ d, at: d.position, p: d.meta.panel as PanelPlacement }] : []))
    expect(panels.length).toBeGreaterThan(0)
    for (const v of veluxes) {
      for (const { d, at, p } of panels) {
        // emprise du module vue du ciel : sa longueur penchée se raccourcit de cos(pente)
        const footprint = { x: at[0], y: at[1], yaw: d.yaw ?? 0, width: p.width, height: p.height * Math.cos((p.tilt * Math.PI) / 180) }
        expect(surfaceRectsOverlap(v as typeof footprint, footprint), `${v.id} sous ${d.id}`).toBe(false)
      }
    }
  })

  it('allows a roof-window stacked above a skylight in the same room (different hosts)', async () => {
    const { default: raw } = await import('./__fixtures__/demo-house.json')
    const house = JSON.parse(JSON.stringify(raw)) as House
    const room = house.rooms.find((r) => r.id === 'chambre2')!
    room.openings.push(
      { id: 'puits-ch2', type: 'skylight', x: 7.5, y: 2.5, yaw: 0, width: 1, height: 1 },
      { id: 'velux-ch2', type: 'roof-window', x: 7.5, y: 2.5, yaw: 0, width: 1, height: 1 },
    )
    expect(() => parseHouse(house)).not.toThrow()
  })
})
