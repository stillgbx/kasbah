import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import { indexHouse } from './lookup'
import { autoPlaceDevices, roomKey, type PlaceableDevice } from './autoplace'
import { pointInPolygon } from './geometry/vec2'

const house = parseHouse(demo)
const index = indexHouse(house)
const light = (id: string, room?: string): PlaceableDevice => ({ id, kind: 'light', ...(room ? { room } : {}) })

describe('roomKey', () => {
  it('ignores accents, case and separators', () => {
    expect(roomKey('Chambre 1')).toBe('chambre1')
    expect(roomKey('Entrée')).toBe(roomKey('entree'))
    expect(roomKey("Salle d'eau")).toBe('salledeau')
  })
})

describe('autoPlaceDevices', () => {
  it('places an unbound device in the room matching its plugin room', () => {
    const { placed, unplaced } = autoPlaceDevices(house, [light('hue:a', 'Salon')], index)
    expect(unplaced).toHaveLength(0)
    expect(placed).toHaveLength(1)
    const d = placed[0]!
    expect(d.roomId).toBe('salon')
    expect(d.deviceId).toBe('hue:a')
    expect(d.id).toBe('auto.hue-a')
    expect(d.mount).toBe('ceiling')
    expect(d.name).toBeUndefined()
    expect(d.meta).toEqual({ autoPlaced: true })
    expect(pointInPolygon([d.position![0], d.position![1]], index.roomsById.get('salon')!.polygon)).toBe(true)
    expect(d.position![2]).toBeCloseTo(2.45, 2) // plafond du niveau (2.6) moins le retrait
  })

  it('matches the room id as well as the room name', () => {
    const { placed } = autoPlaceDevices(house, [light('hue:a', 'chambre1')], index)
    expect(placed[0]!.roomId).toBe('chambre1')
  })

  it('leaves a device unplaced when no room matches', () => {
    const { placed, unplaced } = autoPlaceDevices(house, [light('hue:a', 'Véranda'), light('hue:b')], index)
    expect(placed).toHaveLength(0)
    expect(unplaced.map((d) => d.id)).toEqual(['hue:a', 'hue:b'])
  })

  it('skips devices already bound by the JSON', () => {
    const bound = house.devices.find((d) => d.deviceId?.startsWith('mock:light'))!
    const { placed, unplaced } = autoPlaceDevices(house, [light(bound.deviceId!, 'Salon')], index)
    expect(placed).toHaveLength(0)
    expect(unplaced).toHaveLength(0)
  })

  it('spreads several devices of the same room and keeps ids unique', () => {
    const { placed } = autoPlaceDevices(house, [light('hue:a', 'Salon'), light('hue:b', 'Salon'), light('hue:c', 'Salon')], index)
    expect(placed).toHaveLength(3)
    expect(new Set(placed.map((d) => d.id)).size).toBe(3)
    const xy = new Set(placed.map((d) => `${d.position![0]},${d.position![1]}`))
    expect(xy.size).toBe(3)
  })

  it('places a non-light at hand height, not at the ceiling', () => {
    const { placed } = autoPlaceDevices(house, [{ id: 'hue:a', kind: 'sensor', room: 'Salon' }], index)
    expect(placed[0]!.mount).toBe('free')
    expect(placed[0]!.position![2]).toBe(1.2)
  })

  it('keeps the result parseable as a house', () => {
    const { placed } = autoPlaceDevices(house, [light('hue:a', 'Salon'), light('hue:b', 'Cuisine')], index)
    const merged = parseHouse({ ...demo, devices: [...demo.devices, ...placed] })
    expect(merged.devices).toHaveLength(house.devices.length + 2)
  })
})
