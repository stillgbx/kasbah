import { describe, expect, it } from 'vitest'
import demo from './__fixtures__/demo-house.json'
import { parseHouse } from './validate'
import { PlacementError, placeDeviceInJson } from './place'

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
