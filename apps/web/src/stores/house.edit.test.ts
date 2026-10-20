import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { setTransport } from '../api'
import { createMockTransport } from '../api/mockTransport'
import { useHouseStore } from './house'

// Appearance draft: each choice shows in the house given to the scene, nothing is written
// before "Apply", and the session can be undone, redone and abandoned.

describe('house store — editing session: appearance', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(createMockTransport()) })

  const salonOf = (h: ReturnType<typeof useHouseStore>['effective']) => h!.rooms.find((r) => r.id === 'salon')!

  it('the draft shows in the scene, without touching the written house', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setRoomFinish('salon', 'floor', { id: 'walnut' })
    store.setFacadeFinish({ id: 'red-brick' })
    expect(salonOf(store.effective).style?.floorFinish).toEqual({ id: 'walnut' })
    expect(store.effective!.style?.facade).toEqual({ id: 'red-brick' })
    expect(store.house.rooms.find((r) => r.id === 'salon')!.style?.floorFinish).toBeUndefined()
    expect(store.editDirty).toBe(true)
  })

  it('undo, redo, and a new choice cuts off what could be redone', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setRoomFinish('salon', 'floor', { id: 'walnut' })
    store.setRoomFinish('salon', 'floor', { id: 'oak' })
    store.undoEdit()
    expect(store.roomFinish('salon', 'floor')).toEqual({ id: 'walnut' })
    store.undoEdit()
    expect(store.roomFinish('salon', 'floor')).toBeUndefined()
    expect(store.editDirty).toBe(false)
    store.redoEdit()
    expect(store.roomFinish('salon', 'floor')).toEqual({ id: 'walnut' })
    store.setRoomFinish('salon', 'walls', { id: 'matte-paint', tint: '#336699' })
    expect(store.canRedoEdit).toBe(false)
    // going back to the file by hand is not a change to write
    store.discardEdit()
    store.setRoomFinish('salon', 'floor', { id: 'walnut' })
    store.setRoomFinish('salon', 'floor', null)
    expect(store.editDirty).toBe(false)
  })

  it('"Apply" writes the whole session at once and empties the draft', async () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setRoomFinish('salon', 'walls', { id: 'red-brick' })
    store.setRoomFinish('sdb', 'walls', { id: 'subway-tile' })
    expect(await store.saveEdit()).toBe(true)
    expect(store.house!.rooms.find((r) => r.id === 'sdb')!.style?.wallFinish).toEqual({ id: 'subway-tile' })
    expect(store.house!.rooms.find((r) => r.id === 'salon')!.style?.wallFinish).toEqual({ id: 'red-brick' })
    expect(store.canUndoEdit).toBe(false)
    expect(store.editDirty).toBe(false)
  })
})

describe('house store — editing session: shapes', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(createMockTransport()) })
  const poly = (h: ReturnType<typeof useHouseStore>['effective'], id: string) => h!.rooms.find((r) => r.id === id)!.polygon

  it('pushing a partition: the neighbor follows, undo goes back, nothing is written', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.pushRoomWall('entree', 1, 0.2)
    expect(poly(store.effective, 'entree')[1]![0]).toBeCloseTo(3.2, 4)       // finished face: 3.30 − half partition
    expect(poly(store.effective, 'salon')[0]![0]).toBeCloseTo(3.4, 4)
    expect(store.editBlocking).toEqual([])
    expect(store.editDirty).toBe(true)
    expect(poly(store.house, 'entree')[1]![0]).toBeCloseTo(3.0, 4)
    store.undoEdit()
    expect(store.editDirty).toBe(false)
    expect(store.shapeOf('entree')![1]).toEqual([3.1, 0])
  })

  it('detached, the partition blocks "Apply"; a drag makes only one history step', async () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.coupleWalls = false
    store.pushRoomWall('entree', 1, 0.3)
    expect(store.editBlocking.length).toBeGreaterThan(0)
    expect(await store.saveEdit()).toBe(false)
    store.discardEdit()
    store.coupleWalls = true
    store.beginShapeDrag()
    for (const d of [0.1, 0.2, 0.5]) store.previewRoomWall('salon', 0, d)
    expect(poly(store.effective, 'salon')[0]![1]).toBeCloseTo(-0.5, 4)
    store.endShapeDrag()
    store.undoEdit()
    expect(store.canUndoEdit).toBe(false)
  })

  it('an opening that no longer fits is named, and the scene keeps the last drawable shape', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setSideLength('salon', 0, 5)
    const good = poly(store.effective, 'salon')
    store.setSideLength('salon', 0, 2)
    expect(store.editBlocking.some((m) => m.includes('Salon'))).toBe(true)
    expect(poly(store.effective, 'salon')).toEqual(good)
  })

  it('a vertex added across an opening: blocked, but visible so that it can be moved', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.addCorner('salon', 0)                                  // the middle of the south facade cuts the bay window
    expect(store.editBlocking.length).toBeGreaterThan(0)
    expect(store.shapeOf('salon')).toHaveLength(5)               // the draft's dimensions…
    expect(poly(store.effective, 'salon')).toHaveLength(4)       // …the 3D keeps the last drawable shape
    store.removeCorner('salon', 1)
    expect(store.editBlocking).toEqual([])
    expect(store.editDirty).toBe(false)
  })

  it('"Apply" writes the dimensions', async () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.pushRoomWall('salon', 0, 0.5)
    expect(await store.saveEdit()).toBe(true)
    expect(poly(store.house, 'salon')[0]).toEqual([3.2, -0.5])
    expect(store.editDirty).toBe(false)
  })
})
