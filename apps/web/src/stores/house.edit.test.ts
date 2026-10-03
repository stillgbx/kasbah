import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { setTransport } from '../api'
import { createMockTransport } from '../api/mockTransport'
import { useHouseStore } from './house'

// Brouillon d'apparence : chaque choix se voit dans la maison donnée à la scène, rien n'est écrit
// avant « Valider », et la séance s'annule, se rétablit et s'abandonne.

describe('house store — séance d’édition : apparence', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(createMockTransport()) })

  const salonOf = (h: ReturnType<typeof useHouseStore>['effective']) => h!.rooms.find((r) => r.id === 'salon')!

  it('le brouillon se voit dans la scène, sans toucher à la maison écrite', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setRoomFinish('salon', 'floor', { id: 'walnut' })
    store.setFacadeFinish({ id: 'red-brick' })
    expect(salonOf(store.effective).style?.floorFinish).toEqual({ id: 'walnut' })
    expect(store.effective!.style?.facade).toEqual({ id: 'red-brick' })
    expect(store.house.rooms.find((r) => r.id === 'salon')!.style?.floorFinish).toBeUndefined()
    expect(store.editDirty).toBe(true)
  })

  it('annuler, rétablir, et un choix neuf coupe ce qu’on pouvait rétablir', () => {
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
    // revenir au fichier à la main n'est pas une modification à écrire
    store.discardEdit()
    store.setRoomFinish('salon', 'floor', { id: 'walnut' })
    store.setRoomFinish('salon', 'floor', null)
    expect(store.editDirty).toBe(false)
  })

  it('« Valider » écrit toute la séance d’un coup et vide le brouillon', async () => {
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

describe('house store — séance d’édition : formes', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(createMockTransport()) })
  const poly = (h: ReturnType<typeof useHouseStore>['effective'], id: string) => h!.rooms.find((r) => r.id === id)!.polygon

  it('pousser une cloison : la voisine suit, annuler revient, rien n’est écrit', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.pushRoomWall('entree', 1, 0.2)
    expect(poly(store.effective, 'entree')[1]![0]).toBeCloseTo(3.2, 4)       // face finie : 3,30 − demi-cloison
    expect(poly(store.effective, 'salon')[0]![0]).toBeCloseTo(3.4, 4)
    expect(store.editBlocking).toEqual([])
    expect(store.editDirty).toBe(true)
    expect(poly(store.house, 'entree')[1]![0]).toBeCloseTo(3.0, 4)
    store.undoEdit()
    expect(store.editDirty).toBe(false)
    expect(store.shapeOf('entree')![1]).toEqual([3.1, 0])
  })

  it('détachée, la cloison bloque « Valider » ; un glissement ne fait qu’un pas d’historique', async () => {
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

  it('une ouverture qui ne tient plus est nommée, et la scène garde la dernière forme dessinable', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setSideLength('salon', 0, 5)
    const good = poly(store.effective, 'salon')
    store.setSideLength('salon', 0, 2)
    expect(store.editBlocking.some((m) => m.includes('Salon'))).toBe(true)
    expect(poly(store.effective, 'salon')).toEqual(good)
  })

  it('un sommet ajouté au travers d’une ouverture : bloqué, mais visible pour qu’on le déplace', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.addCorner('salon', 0)                                  // le milieu de la façade sud coupe la baie
    expect(store.editBlocking.length).toBeGreaterThan(0)
    expect(store.shapeOf('salon')).toHaveLength(5)               // les cotes du brouillon…
    expect(poly(store.effective, 'salon')).toHaveLength(4)       // …la 3D garde la dernière forme dessinable
    store.removeCorner('salon', 1)
    expect(store.editBlocking).toEqual([])
    expect(store.editDirty).toBe(false)
  })

  it('« Valider » écrit les cotes', async () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.pushRoomWall('salon', 0, 0.5)
    expect(await store.saveEdit()).toBe(true)
    expect(poly(store.house, 'salon')[0]).toEqual([3.2, -0.5])
    expect(store.editDirty).toBe(false)
  })
})
