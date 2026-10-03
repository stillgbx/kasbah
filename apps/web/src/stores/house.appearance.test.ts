import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { setTransport } from '../api'
import { createMockTransport } from '../api/mockTransport'
import { useHouseStore } from './house'

// Brouillon d'apparence : chaque choix se voit dans la maison donnée à la scène, rien n'est écrit
// avant « Valider », et la séance s'annule, se rétablit et s'abandonne.

describe('house store — apparence', () => {
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
    expect(store.appearanceDirty).toBe(true)
  })

  it('annuler, rétablir, et un choix neuf coupe ce qu’on pouvait rétablir', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setRoomFinish('salon', 'floor', { id: 'walnut' })
    store.setRoomFinish('salon', 'floor', { id: 'oak' })
    store.undoAppearance()
    expect(store.roomFinish('salon', 'floor')).toEqual({ id: 'walnut' })
    store.undoAppearance()
    expect(store.roomFinish('salon', 'floor')).toBeUndefined()
    expect(store.appearanceDirty).toBe(false)
    store.redoAppearance()
    expect(store.roomFinish('salon', 'floor')).toEqual({ id: 'walnut' })
    store.setRoomFinish('salon', 'walls', { id: 'matte-paint', tint: '#336699' })
    expect(store.canRedoAppearance).toBe(false)
    // revenir au fichier à la main n'est pas une modification à écrire
    store.discardAppearance()
    store.setRoomFinish('salon', 'floor', { id: 'walnut' })
    store.setRoomFinish('salon', 'floor', null)
    expect(store.appearanceDirty).toBe(false)
  })

  it('« Valider » écrit toute la séance d’un coup et vide le brouillon', async () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setRoomFinish('salon', 'walls', { id: 'red-brick' })
    store.setRoomFinish('sdb', 'walls', { id: 'subway-tile' })
    expect(await store.saveAppearance()).toBe(true)
    expect(store.house!.rooms.find((r) => r.id === 'sdb')!.style?.wallFinish).toEqual({ id: 'subway-tile' })
    expect(store.house!.rooms.find((r) => r.id === 'salon')!.style?.wallFinish).toEqual({ id: 'red-brick' })
    expect(store.canUndoAppearance).toBe(false)
    expect(store.appearanceDirty).toBe(false)
  })
})
