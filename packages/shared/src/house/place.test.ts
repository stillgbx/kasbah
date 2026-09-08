import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import { PlacementError, placeDeviceInJson, setRoomOrderInJson } from './place'

const devices = (doc: Record<string, unknown>) => doc.devices as Record<string, unknown>[]

describe('placeDeviceInJson', () => {
  it('moves an existing device and keeps the rest of its entry', () => {
    const out = placeDeviceInJson(demo, 'light.salon', { position: [5, 3, 0.75], mount: 'free' })
    const d = devices(out).find((x) => x.id === 'light.salon')!
    expect(d).toMatchObject({ name: 'Plafonnier salon', deviceId: 'mock:light-living', roomId: 'salon', position: [5, 3, 0.75], mount: 'free' })
    expect(devices(out)).toHaveLength(demo.devices.length)
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('re-anchors to another room of the level and follows its levelId', () => {
    const out = placeDeviceInJson(demo, 'light.salon', { position: [6.6, 6.5, 2.4], roomId: 'cuisine' })
    const d = devices(out).find((x) => x.id === 'light.salon')!
    expect(d.roomId).toBe('cuisine')
    expect(d.levelId).toBe('rdc')
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('creates a minimal entry for a device absent from the JSON', () => {
    const out = placeDeviceInJson(demo, 'auto.hue-abc', { position: [1, 1, 2.4], roomId: 'salon', mount: 'ceiling', deviceId: 'hue:abc' })
    expect(devices(out).at(-1)).toEqual({ id: 'auto.hue-abc', deviceId: 'hue:abc', position: [1, 1, 2.4], roomId: 'salon', mount: 'ceiling' })
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('refuses to create without deviceId and rejects unknown rooms', () => {
    expect(() => placeDeviceInJson(demo, 'nope', { position: [0, 0, 0] })).toThrow(PlacementError)
    expect(() => placeDeviceInJson(demo, 'light.salon', { position: [0, 0, 0], roomId: 'veranda' })).toThrow(PlacementError)
  })

  it('does not mutate the input document', () => {
    const before = JSON.stringify(demo)
    placeDeviceInJson(demo, 'light.salon', { position: [0, 0, 0] })
    expect(JSON.stringify(demo)).toBe(before)
  })
})

describe('setRoomOrderInJson', () => {
  const levels = (doc: Record<string, unknown>) => doc.levels as Record<string, unknown>[]

  it('writes the order on the level and keeps the rest of it', () => {
    const out = setRoomOrderInJson(demo, 'etage', ['sdb', 'chambre1'])
    const l = levels(out).find((x) => x.id === 'etage')!
    expect(l.roomOrder).toEqual(['sdb', 'chambre1'])
    expect(l.name).toBe(demo.levels.find((x) => x.id === 'etage')!.name)
    expect(levels(out).find((x) => x.id === 'rdc')!.roomOrder).toBeUndefined()
    expect(() => parseHouse(out)).not.toThrow()
  })

  it('rejects an unknown level, a room of another level and duplicates', () => {
    expect(() => setRoomOrderInJson(demo, 'cave', ['sdb'])).toThrow(PlacementError)
    expect(() => setRoomOrderInJson(demo, 'etage', ['salon'])).toThrow(PlacementError)
    expect(() => setRoomOrderInJson(demo, 'etage', ['sdb', 'sdb'])).toThrow(PlacementError)
  })

  it('does not mutate the input document', () => {
    const before = JSON.stringify(demo)
    setRoomOrderInJson(demo, 'etage', ['sdb'])
    expect(JSON.stringify(demo)).toBe(before)
  })
})
