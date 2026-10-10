import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { setTransport } from '../api'
import { createMockTransport } from '../api/mockTransport'
import { useHouseStore } from './house'

// Structure dans la séance : une pièce ou un niveau qui naît entre dans le brouillon (annuler,
// rétablir, rien d'écrit avant « Valider ») et devient tout de suite la sélection.

describe('house store — séance d’édition : structure', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(createMockTransport()) })

  it('une pièce contre un mur : sélectionnée, nommée, annulable', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.addRoomAgainstWall('salon', 0)
    const id = store.selectedRoomId!
    expect(store.selectedRoom?.name).toBe('Room 8')   // les tests tournent en anglais
    expect(store.selectedRoom?.levelId).toBe('rdc')
    expect(store.editBlocking).toEqual([])
    expect(store.editDirty).toBe(true)
    store.setRoomIdentity(id, { name: 'Bureau' })
    store.setRoomIdentity(id, { kind: 'garage' })
    expect(store.selectedRoom).toMatchObject({ name: 'Bureau', kind: 'garage' })
    store.undoEdit(); store.undoEdit(); store.undoEdit()
    expect(store.effective!.rooms.some((r) => r.id === id)).toBe(false)
    expect(store.editDirty).toBe(false)
  })

  it('annuler une pièce ou un niveau né remonte à la maison : ni panneau ni onglet vides', async () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.addRoomAgainstWall('salon', 0)
    await nextTick()
    expect(store.selectedRoom).not.toBeNull()
    store.undoEdit()
    await nextTick()
    expect(store.selectedRoomId).toBeNull()
    store.addLevel('above')
    await nextTick()
    store.discardEdit()
    await nextTick()
    expect(store.focusedLevelId).toBeNull()
    expect(store.editDirty).toBe(false)
  })

  it('renommer un niveau et la propriété : dans le brouillon, annulable', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.setLevelIdentity('etage', { name: 'Premier' })
    store.setLevelIdentity('etage', { shortName: 'R+1' })
    store.setPropertyName('Maison du lac')
    expect(store.effective!.levels.find((l) => l.id === 'etage')).toMatchObject({ name: 'Premier', shortName: 'R+1' })
    expect(store.effective!.name).toBe('Maison du lac')
    expect(store.editDirty).toBe(true)
    store.discardEdit()
    expect(store.effective!.name).toBe(parseHouse(demo).name)
  })

  it('poser au tap : le niveau de l’onglet, puis l’arme retombe', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.focusLevel('etage')
    store.startPlacingRoom()
    expect(store.placingRoom).toBe('etage')
    store.placeRoomAt([14, 3])
    expect(store.placingRoom).toBeNull()
    expect(store.selectedRoom?.levelId).toBe('etage')
  })

  it('« Valider » écrit les pièces nées et retirées d’un coup', async () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.addRoomAgainstWall('salon', 0)
    const id = store.selectedRoomId!
    store.removeRoom('cuisine')
    expect(await store.saveEdit()).toBe(true)
    expect(store.house!.rooms.map((r) => r.id)).toContain(id)
    expect(store.house!.rooms.some((r) => r.id === 'cuisine')).toBe(false)
    expect(store.canUndoEdit).toBe(false)
  })

  it('un étage au-dessus : « Floor 2 », onglet ouvert, et seul un niveau vide se retire', () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.addLevel('above')
    const id = store.focusedLevelId!
    expect(store.effective!.levels.find((l) => l.id === id)?.name).toBe('Floor 2')
    expect(store.levelRemovable(id)).toBe(true)
    expect(store.levelRemovable('etage')).toBe(false)
    store.removeLevel(id)
    expect(store.effective!.levels.some((l) => l.id === id)).toBe(false)
    expect(store.focusedLevelId).toBeNull()
  })
})
