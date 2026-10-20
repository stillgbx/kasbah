import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { parseHouse } from '@kasbah/shared'
import demo from '@kasbah/shared/demo-house.json'
import { setTransport } from '../api'
import { createMockTransport } from '../api/mockTransport'
import { useHouseStore } from './house'

// House breadcrumb: device → its parent → house. The parent of a device placed outside
// any room is the LEVEL that carries it (a camera on the roof); that of a room device
// remains its room.

/** The demo house, plus a camera placed on the roof level (outside any room). */
function houseWithRoofDevice() {
  return parseHouse({
    ...demo,
    devices: [...demo.devices, { id: 'cam.toit', name: 'Caméra Toit', position: [4, 4, 0.5], levelId: 'toit', mount: 'free' }],
  })
}

describe('house store', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null) })

  it("in Move mode, the tab only navigates; the level selector takes the device along", async () => {
    setTransport(createMockTransport())
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.selectDevice('light.salon')                 // living room ceiling light: ground floor (0,2), z 2.5
    store.startPlacing()
    expect(store.placementLevelId).toBe('rdc')

    // going to look at the upper floor moves NOTHING (that is what had anchored a light to the roof)
    store.focusLevel('etage')
    expect(store.placementLevelId).toBe('rdc')
    expect(store.house.devices.find((d) => d.id === 'light.salon')!.position).toEqual([6.6, 2.5, 2.5])

    // the selector, for its part, re-anchors: room under the point, same height IN SPACE, and the view follows
    await store.setPlacementLevel('etage')
    const moved = store.house!.devices.find((d) => d.id === 'light.salon')!
    expect(moved.roomId).toBe('chambre2')            // (6,6 ; 2,5) falls in bedroom 2
    expect(moved.position?.[2]).toBeCloseTo(2.5 + 0.2 - 3.05)
    expect(store.placementLevelId).toBe('etage')
    expect(store.focusedLevelId).toBe('etage')
  })

  it("goes up to the level for a device outside a room, to the room otherwise", () => {
    const store = useHouseStore()
    store.house = houseWithRoofDevice()

    store.selectDevice('cam.toit')
    expect(store.focusedLevelId).toBe('toit')
    store.backFromDevice()
    expect(store.selectedKey).toBeNull()
    expect(store.selectedLevelId).toBe('toit')

    // a device INSIDE a room goes up to its room: the level does not get involved
    store.selectDevice('light.salon')
    expect(store.selectedLevelId).toBeNull()
    store.backFromDevice()
    expect(store.selectedRoomId).toBe('salon')
    expect(store.selectedLevelId).toBeNull()
  })

  it('goes up from a room to its level', () => {
    const store = useHouseStore()
    store.house = houseWithRoofDevice()

    store.selectRoom('salon')
    store.backFromRoom()
    expect(store.selectedRoomId).toBeNull()
    expect(store.selectedLevelId).toBe('rdc')
    // from a level, the same back goes to the house
    store.backFromRoom()
    expect(store.selectedLevelId).toBeNull()
  })

  it("closes the selected level as soon as another tab or a room takes over", () => {
    const store = useHouseStore()
    store.house = houseWithRoofDevice()

    store.selectLevel('toit')
    expect(store.floorTab).toBe('toit')
    expect(store.selectedLevelId).toBe('toit')
    store.setFloorTab('toit')             // the same tab closes nothing
    expect(store.selectedLevelId).toBe('toit')

    store.setFloorTab('etage')
    expect(store.selectedLevelId).toBeNull()

    store.selectLevel('toit')
    store.selectRoom('salon')
    expect(store.selectedLevelId).toBeNull()
  })

  it("a level tab deselects the device so as not to be reframed", () => {
    const store = useHouseStore()
    store.house = parseHouse(demo)
    store.selectDevice('light.salon')
    expect(store.selectedKey).toBe('light.salon')
    store.setFloorTab('etage')
    expect(store.selectedKey).toBeNull()
    expect(store.focusedLevelId).toBe('etage')
  })
})
