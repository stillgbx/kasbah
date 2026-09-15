import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { setTransport } from '../api'
import { createMockTransport } from '../api/mockTransport'
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

  it("en mode « Déplacer », l'onglet ne fait que naviguer ; le sélecteur de niveau emmène l'appareil", async () => {
    setTransport(createMockTransport())
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.selectDevice('light.salon')                 // plafonnier du salon : rdc (0,2), z 2,5
    store.startPlacing()
    expect(store.placementLevelId).toBe('rdc')

    // aller regarder l'étage ne déplace RIEN (c'est ce qui avait ancré une lampe au toit)
    store.focusLevel('etage')
    expect(store.placementLevelId).toBe('rdc')
    expect(store.house.devices.find((d) => d.id === 'light.salon')!.position).toEqual([6.6, 2.5, 2.5])

    // le sélecteur, lui, ré-ancre : pièce sous le point, même hauteur DANS L'ESPACE, et la vue suit
    await store.setPlacementLevel('etage')
    const moved = store.house!.devices.find((d) => d.id === 'light.salon')!
    expect(moved.roomId).toBe('chambre2')            // (6,6 ; 2,5) tombe dans la chambre 2
    expect(moved.position?.[2]).toBeCloseTo(2.5 + 0.2 - 3.05)
    expect(store.placementLevelId).toBe('etage')
    expect(store.focusedLevelId).toBe('etage')
  })

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
