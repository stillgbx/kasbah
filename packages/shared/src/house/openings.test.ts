import { describe, expect, it } from 'vitest'
import { HOUSE_DEFAULTS } from './defaults'
import { classifySegments, openingLeaves } from './geometry/walls'
import { fitGap, fitHeight, fitWidth, freeSpan, hostSegments, newOpeningDims, openingGaps, openingLabel, openingLimits, slotFromPoint } from './openings'
import { openingPatchSchema, patchOpeningInJson, PlacementError, placeDeviceInJson } from './place'
import { houseSchema, openingSchema, type Opening, type Room } from './schema'

// 4 m by 4 m square, corners in CCW order: segment 0 = bottom edge (y = 0), 1 = right, 2 = top, 3 = left.
const room = (partial: Partial<Room> & Pick<Room, 'id' | 'polygon'>): Room =>
  houseSchema.shape.rooms.element.parse({ levelId: 'l', name: partial.id, ...partial })
const opening = (partial: Partial<Opening> & Pick<Opening, 'id'>): Opening =>
  openingSchema.parse({ type: 'window', segment: 0, offset: 1, width: 1, height: 1, ...partial })

const square = (openings: Opening[] = []) =>
  room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], openings })

describe('hostSegments', () => {
  it('leaves out the walls that are too short and the ones set to "none"', () => {
    const r = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 1], [0, 1]], walls: [{ segment: 0, kind: 'none' }] })
    const hosts = hostSegments(r, [r], HOUSE_DEFAULTS, 2, 'x').map((h) => h.seg.index)
    expect(hosts).toEqual([2])            // 0 is "none", 1 and 3 are only one meter long
  })
  it('a room without walls hosts nothing', () => {
    const r = room({ id: 'a', kind: 'terrace', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] })
    expect(hostSegments(r, [r], HOUSE_DEFAULTS, 1, 'x')).toEqual([])
  })
  it('a neighbour splits the wall into two free ranges', () => {
    const r = square([opening({ id: 'o1', segment: 0, offset: 1.5, width: 1 })])
    const seg0 = hostSegments(r, [r], HOUSE_DEFAULTS, 1, 'o2')!.find((h) => h.seg.index === 0)!
    expect(seg0.ranges).toEqual([{ min: 0, max: 0.5 }, { min: 2.5, max: 3 }])
  })
  it('the opening being moved does not block itself', () => {
    const r = square([opening({ id: 'o1', segment: 0, offset: 0, width: 4 })])
    const seg0 = hostSegments(r, [r], HOUSE_DEFAULTS, 4, 'o1')!.find((h) => h.seg.index === 0)
    expect(seg0?.ranges).toEqual([{ min: 0, max: 0 }])
  })
})

describe('slotFromPoint', () => {
  it('a point in front of a wall lands centred on it', () => {
    const r = square([opening({ id: 'o1' })])
    expect(slotFromPoint(r, [r], HOUSE_DEFAULTS, [2, 0.1], 1, 'o1')).toEqual({ segment: 0, offset: 1.5 })
  })
  it('a point dragged past the corner moves to the next wall', () => {
    const r = square([opening({ id: 'o1' })])
    expect(slotFromPoint(r, [r], HOUSE_DEFAULTS, [3.9, 2], 1, 'o1')).toEqual({ segment: 1, offset: 1.5 })
  })
  it('a wall too short for the opening is skipped, the drag runs on to the next one', () => {
    // edge 1 (right) is only one meter long: a 2 m opening cannot be placed on it
    const r = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 1], [0, 1]], openings: [opening({ id: 'o1', width: 2 })] })
    const slot = slotFromPoint(r, [r], HOUSE_DEFAULTS, [4, 0.5], 2, 'o1')
    expect(slot?.segment === 0 || slot?.segment === 2).toBe(true)
  })
  it('butts up against a neighbour instead of jumping over it', () => {
    // o1 occupies [0, 1] on the bottom wall, o2 [2, 3]: the finger goes past o2, o1 must STOP
    // at its edge (offset 1) and not reappear on the other side (offset 3).
    const r = square([opening({ id: 'o1', offset: 0 }), opening({ id: 'o2', offset: 2, width: 1 })])
    const from = { segment: 0, offset: 0 }
    expect(slotFromPoint(r, [r], HOUSE_DEFAULTS, [2.9, 0.1], 1, 'o1', from)).toEqual({ segment: 0, offset: 1 })
    // without `from`, the closest wins: the opening jumps over
    expect(slotFromPoint(r, [r], HOUSE_DEFAULTS, [2.9, 0.1], 1, 'o1')).toEqual({ segment: 0, offset: 3 })
  })
  it('still turns the corner when the finger leaves the wall', () => {
    const r = square([opening({ id: 'o1', offset: 0 }), opening({ id: 'o2', offset: 2, width: 1 })])
    const from = { segment: 0, offset: 0 }
    expect(slotFromPoint(r, [r], HOUSE_DEFAULTS, [0.1, 2], 1, 'o1', from)?.segment).toBe(3)
  })
  it('keeps clear of a neighbour even when the finger is right on top of it', () => {
    const r = square([opening({ id: 'o1', offset: 0 }), opening({ id: 'o2', offset: 2, width: 1 })])
    const slot = slotFromPoint(r, [r], HOUSE_DEFAULTS, [2.5, 0.1], 1, 'o1')!
    expect(slot.segment === 0 ? slot.offset + 1 <= 2 || slot.offset >= 3 : true).toBe(true)
  })
})

describe('freeSpan', () => {
  it('is the whole wall when nothing else sits on it', () => {
    const r = square([opening({ id: 'o1', offset: 1, width: 1 })])
    expect(freeSpan(r, [r], HOUSE_DEFAULTS, r.openings[0]!)).toEqual({ u0: 0, u1: 4 })
  })
  it('is bounded by the neighbours on each side, not by the opening itself', () => {
    const r = square([
      opening({ id: 'left', offset: 0, width: 0.5 }),
      opening({ id: 'o1', offset: 1.5, width: 1 }),
      opening({ id: 'right', offset: 3, width: 0.5 }),
    ])
    expect(freeSpan(r, [r], HOUSE_DEFAULTS, r.openings[1]!)).toEqual({ u0: 0.5, u1: 3 })
  })
  it('gives nothing on a wall set to "none"', () => {
    const r = room({ id: 'a', polygon: [[0, 0], [4, 0], [4, 4], [0, 4]], walls: [{ segment: 0, kind: 'none' }], openings: [opening({ id: 'o1' })] })
    expect(freeSpan(r, [r], HOUSE_DEFAULTS, r.openings[0]!)).toBeNull()
  })
})

describe('fitWidth', () => {
  it('keeps the left edge while there is room on the right', () => {
    const r = square([opening({ id: 'o1', offset: 1, width: 1 })])
    expect(fitWidth(r, [r], HOUSE_DEFAULTS, r.openings[0]!, 2)).toEqual({ width: 2, offset: 1 })
  })
  it('slides the opening left instead of shrinking what was typed', () => {
    // o1 occupies [1, 2]; its neighbor starts at 2.5: there is only 0.5 m on the right, but 2.5 m of free wall
    const r = square([opening({ id: 'o1', offset: 1, width: 1 }), opening({ id: 'o2', offset: 2.5, width: 1 })])
    expect(fitWidth(r, [r], HOUSE_DEFAULTS, r.openings[0]!, 2)).toEqual({ width: 2, offset: 0.5 })
  })
  it('caps at the free span, and then sits flush in it', () => {
    const r = square([opening({ id: 'o1', offset: 1, width: 1 }), opening({ id: 'o2', offset: 2.5, width: 1 })])
    expect(fitWidth(r, [r], HOUSE_DEFAULTS, r.openings[0]!, 9)).toEqual({ width: 2.5, offset: 0 })
  })
  it('never goes below the smallest opening', () => {
    const r = square([opening({ id: 'o1', offset: 1, width: 1 })])
    expect(fitWidth(r, [r], HOUSE_DEFAULTS, r.openings[0]!, 0.01)?.width).toBe(0.3)
  })
})

describe('fitHeight', () => {
  it('lowers the sill rather than shrinking what was typed', () => {
    expect(fitHeight(0.9, 1.2, 2.5, 2.2)).toEqual({ height: 2.2, sill: 0.3 })
  })
  it('leaves the sill alone when the height still fits above it', () => {
    expect(fitHeight(0.9, 1.2, 2.5, 1.5)).toEqual({ height: 1.5, sill: 0.9 })
  })
  it('caps at the ceiling, sill on the floor', () => {
    expect(fitHeight(0.9, 1.2, 2.5, 9)).toEqual({ height: 2.5, sill: 0 })
  })
})

describe('fitGap', () => {
  const r = () => square([opening({ id: 'o1', offset: 1, width: 1 }), opening({ id: 'o2', offset: 2.5, width: 1 })])
  it('sets the distance measured from the right, which is where `offset` starts', () => {
    expect(fitGap(r(), [r()], HOUSE_DEFAULTS, r().openings[0]!, 'right', 0.4)).toBe(0.4)
  })
  it('sets the distance measured from the left, the other one following', () => {
    // 4 m wall, 1 m opening: 2.6 m from the other end → offset 0.4
    expect(fitGap(r(), [r()], HOUSE_DEFAULTS, r().openings[0]!, 'left', 2.6)).toBe(0.4)
  })
  it('stops at the neighbour instead of overlapping it', () => {
    expect(fitGap(r(), [r()], HOUSE_DEFAULTS, r().openings[0]!, 'right', 9)).toBe(1.5)
  })
})

describe('openingLimits', () => {
  it('the width may take the whole free span, not just what is on its right', () => {
    const r = square([opening({ id: 'o1', offset: 1, width: 1 }), opening({ id: 'o2', offset: 2.5, width: 1 })])
    expect(openingLimits(r, [r], HOUSE_DEFAULTS, r.openings[0]!, 2.5).maxWidth).toBe(2.5)
  })
  it('the height may take the whole room, the sill what the height leaves', () => {
    const r = square([opening({ id: 'o1', height: 1.2, sill: 0.9 })])
    const limits = openingLimits(r, [r], HOUSE_DEFAULTS, r.openings[0]!, 2.5)
    expect(limits.maxHeight).toBe(2.5)
    expect(limits.maxSill).toBeCloseTo(1.3, 6)
  })
})

describe('openingGaps', () => {
  it('measures the distance to each end of the wall', () => {
    const r = square([opening({ id: 'o1', offset: 1, width: 1.5 })])
    expect(openingGaps(r, r.openings[0]!)).toEqual({ right: 1, left: 1.5 })
  })
  it('never reports a negative gap, even on a wall the survey got wrong', () => {
    const r = square([opening({ id: 'o1', segment: 0, offset: 3.5, width: 1 })])
    expect(openingGaps(r, r.openings[0]!).left).toBe(0)
  })
  /**
   * The direction is told FROM INSIDE the room, and that is what this test guards: the polygons are
   * counterclockwise, so an observer in the room, turned toward the wall, has the corner
   * `polygon[segment]` — the origin of `offset` — on their RIGHT. The interface once displayed the opposite.
   */
  it('names the sides as seen from INSIDE the room', () => {
    const r = square([opening({ id: 'o1', offset: 1, width: 1 })])
    const seg = classifySegments(r, [r], HOUSE_DEFAULTS)[0]!
    // the observer looks outward (the wall normal); their right = forward × up
    const rightDir: [number, number] = [seg.n[1], -seg.n[0]]
    // the corner from which `offset` starts is opposite to the direction of the edge
    const towardsOrigin: [number, number] = [-seg.d[0], -seg.d[1]]
    expect(rightDir[0] * towardsOrigin[0] + rightDir[1] * towardsOrigin[1]).toBeGreaterThan(0)
    expect(openingGaps(r, r.openings[0]!).right).toBe(r.openings[0]!.offset)
  })
})

describe('openingLabel', () => {
  it('prefers the name, falls back to the survey id', () => {
    expect(openingLabel(opening({ id: 'baie', name: 'Baie du salon' }))).toBe('Baie du salon')
    expect(openingLabel(opening({ id: 'baie' }))).toBe('baie')
  })
})

type JsonLike = Record<string, unknown>
describe('patchOpeningInJson', () => {
  const doc = () => ({
    rooms: [
      { id: 'a', openings: [{ id: 'o1', type: 'window', segment: 0, offset: 1, width: 1, height: 1 }] },
      { id: 'b', openings: [{ id: 'o2', type: 'door', segment: 0, offset: 0, width: 0.9, height: 2.1 }] },
    ],
  })
  it('writes only the given fields, and only in the right room', () => {
    const out = patchOpeningInJson(doc(), 'a', 'o1', { width: 1.4, sill: 0.95 })
    const rooms = out.rooms as { id: string; openings: Record<string, unknown>[] }[]
    expect(rooms[0]!.openings[0]).toEqual({ id: 'o1', type: 'window', segment: 0, offset: 1, width: 1.4, height: 1, sill: 0.95 })
    expect(rooms[1]!.openings[0]!.width).toBe(0.9)
  })
  it('leaves the source document untouched', () => {
    const d = doc()
    patchOpeningInJson(d, 'a', 'o1', { width: 3 })
    expect(d.rooms[0]!.openings[0]!.width).toBe(1)
  })
  it('refuses an unknown room or opening', () => {
    expect(() => patchOpeningInJson(doc(), 'zz', 'o1', { width: 1 })).toThrow(PlacementError)
    expect(() => patchOpeningInJson(doc(), 'a', 'o2', { width: 1 })).toThrow(PlacementError)
  })
  it('writes a name, and an empty string takes it back off', () => {
    const named = patchOpeningInJson(doc(), 'a', 'o1', { name: 'Baie du salon' })
    expect((named.rooms as { openings: Record<string, unknown>[] }[])[0]!.openings[0]!.name).toBe('Baie du salon')
    const cleared = patchOpeningInJson(named, 'a', 'o1', { name: '' })
    expect((cleared.rooms as { openings: Record<string, unknown>[] }[])[0]!.openings[0]).not.toHaveProperty('name')
  })
  it('an empty patch changes nothing', () => {
    expect(patchOpeningInJson(doc(), 'a', 'o1', openingPatchSchema.parse({}))).toEqual(doc())
  })
  it('writes the joinery, and the empty string hands back to the default', () => {
    const at = (d: JsonLike) => (d.rooms as { openings: Record<string, unknown>[] }[])[0]!.openings[0]!
    const set = patchOpeningInJson(doc(), 'a', 'o1', { leaves: 2, material: 'metal', color: '#c0c4c8' })
    expect(at(set)).toMatchObject({ leaves: 2, material: 'metal', color: '#c0c4c8' })
    // the empty string REMOVES the key: handing back to the default is not writing the deduced value
    const cleared = patchOpeningInJson(set, 'a', 'o1', { leaves: '', material: '', color: '' })
    for (const key of ['leaves', 'material', 'color']) expect(at(cleared)).not.toHaveProperty(key)
  })
  it('refuses a color that is not a #rrggbb and a number of leaves out of bounds', () => {
    expect(openingPatchSchema.safeParse({ color: 'rouge' }).success).toBe(false)
    expect(openingPatchSchema.safeParse({ leaves: 0 }).success).toBe(false)
    expect(openingPatchSchema.safeParse({ leaves: 11 }).success).toBe(false)
    expect(openingPatchSchema.safeParse({ leaves: 10 }).success).toBe(true)
    expect(openingPatchSchema.safeParse({ leaves: '' }).success).toBe(true)
  })
})

describe('openingLeaves', () => {
  it('a single leaf by default, whatever the width', () => {
    for (const type of ['door', 'window', 'passage', 'garage', 'glass-door'] as const) {
      expect(openingLeaves(opening({ id: 'o', type, width: 3 }))).toBe(1)
    }
  })
  it('the glazed bay is deduced from its width: a sliding door, two to three leaves', () => {
    expect(openingLeaves(opening({ id: 'o', type: 'bay', width: 1.2 }))).toBe(2)
    expect(openingLeaves(opening({ id: 'o', type: 'bay', width: 3.2 }))).toBe(2)
    expect(openingLeaves(opening({ id: 'o', type: 'bay', width: 6 }))).toBe(3)
  })
  it('the file number takes precedence over what is deduced', () => {
    expect(openingLeaves(opening({ id: 'o', type: 'bay', width: 6, leaves: 1 }))).toBe(1)
    expect(openingLeaves(opening({ id: 'o', type: 'window', width: 1, leaves: 4 }))).toBe(4)
  })
})

describe('placeDeviceInJson — opening link', () => {
  const doc = () => ({
    levels: [{ id: 'l' }],
    rooms: [{ id: 'a', levelId: 'l', openings: [{ id: 'o1', type: 'window', segment: 0, offset: 1, width: 1, height: 1 }] }],
    devices: [{ id: 'd1', deviceId: 'mock:cover', roomId: 'b' }],
  })
  it('linking an opening re-anchors the device on the room that carries it', () => {
    const out = placeDeviceInJson(doc(), 'd1', { openingId: 'o1' })
    expect((out.devices as Record<string, unknown>[])[0]).toMatchObject({ openingId: 'o1', roomId: 'a' })
  })
  it('an empty string unlinks it', () => {
    const linked = placeDeviceInJson(doc(), 'd1', { openingId: 'o1' })
    const out = placeDeviceInJson(linked, 'd1', { openingId: '' })
    expect((out.devices as Record<string, unknown>[])[0]).not.toHaveProperty('openingId')
  })
  it('refuses an opening no room carries', () => {
    expect(() => placeDeviceInJson(doc(), 'd1', { openingId: 'nope' })).toThrow(PlacementError)
  })
})

describe('newOpeningDims', () => {
  it('places everything that goes down to the floor at the door height of the house, zero sill', () => {
    for (const type of ['door', 'passage', 'garage', 'bay', 'glass-door'] as const) {
      expect(newOpeningDims(type, HOUSE_DEFAULTS)).toMatchObject({ height: HOUSE_DEFAULTS.doorHeight, sill: 0 })
    }
    expect(newOpeningDims('garage', HOUSE_DEFAULTS).width).toBe(2.4)
    expect(newOpeningDims('door', HOUSE_DEFAULTS).width).toBe(0.9)
  })
  it('the window arrives at the top at the height of a door: it is what one sees on a facade', () => {
    const w = newOpeningDims('window', { ...HOUSE_DEFAULTS, windowSill: 0.9, doorHeight: 2.1 })
    expect(w.sill + w.height).toBe(HOUSE_DEFAULTS.doorHeight)
  })
  it('follows the defaults of THE house: setting the sill once applies to what is placed next', () => {
    expect(newOpeningDims('window', { ...HOUSE_DEFAULTS, windowSill: 1.1 }).sill).toBe(1.1)
    expect(newOpeningDims('door', { ...HOUSE_DEFAULTS, doorHeight: 2.4 }).height).toBe(2.4)
  })
})
