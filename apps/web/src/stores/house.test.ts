import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { setTransport } from '../api'
import { useHouseStore } from './house'

// Fil d'Ariane de la maison : appareil → son parent → maison. Le parent d'un appareil posé hors de
// toute pièce est le NIVEAU qui le porte (une caméra sur le toit) ; celui d'un appareil de pièce
// reste sa pièce.

/** La maison de démonstration, plus une caméra posée sur le niveau du toit (hors de toute pièce). */
function houseWithRoofDevice() {
  return parseHouse({
    ...demo,
    devices: [...demo.devices, { id: 'cam.toit', name: 'Caméra Toit', position: [4, 4, 0.5], levelId: 'toit', mount: 'free' }],
  })
}

describe('house store', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it("remonte au niveau pour un appareil hors pièce, à la pièce sinon", () => {
    const store = useHouseStore()
    store.house = houseWithRoofDevice()

    store.selectDevice('cam.toit')
    expect(store.focusedLevelId).toBe('toit')
    store.backFromDevice()
    expect(store.selectedKey).toBeNull()
    expect(store.selectedLevelId).toBe('toit')

    // un appareil DANS une pièce remonte à sa pièce : le niveau ne s'en mêle pas
    store.selectDevice('light.salon')
    expect(store.selectedLevelId).toBeNull()
    store.backFromDevice()
    expect(store.selectedRoomId).toBe('salon')
    expect(store.selectedLevelId).toBeNull()
  })

  it('remonte une pièce à son niveau', () => {
    const store = useHouseStore()
    store.house = houseWithRoofDevice()

    store.selectRoom('salon')
    store.backFromRoom()
    expect(store.selectedRoomId).toBeNull()
    expect(store.selectedLevelId).toBe('rdc')
    // depuis un niveau, le même retour ramène à la maison
    store.backFromRoom()
    expect(store.selectedLevelId).toBeNull()
  })

  it("ferme le niveau sélectionné dès qu'un autre onglet ou une pièce prend la main", () => {
    const store = useHouseStore()
    store.house = houseWithRoofDevice()

    store.selectLevel('toit')
    expect(store.floorTab).toBe('toit')
    expect(store.selectedLevelId).toBe('toit')
    store.setFloorTab('toit')             // le même onglet ne referme rien
    expect(store.selectedLevelId).toBe('toit')

    store.setFloorTab('etage')
    expect(store.selectedLevelId).toBeNull()

    store.selectLevel('toit')
    store.selectRoom('salon')
    expect(store.selectedLevelId).toBeNull()
  })
})
