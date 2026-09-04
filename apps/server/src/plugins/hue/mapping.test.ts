import { describe, expect, it } from 'vitest'
import { DEVICES, GROUPED_LIGHTS, LIGHTS, ROOMS, ZIGBEE } from './__fixtures__/bridge'
import { connectivityToAvailability, indexResources, toDescriptor, toGroupDescriptor, toLightPatch, toPutBody } from './mapping'
import { hueDeviceSchema, hueGroupedLightSchema, hueLightSchema, hueRoomSchema, hueZigbeeConnectivitySchema } from './types'

const lights = LIGHTS.map((l) => hueLightSchema.parse(l))
const devices = DEVICES.map((d) => hueDeviceSchema.parse(d))
const rooms = ROOMS.map((r) => hueRoomSchema.parse(r))
const idx = indexResources(lights, devices, rooms)

describe('hue mapping', () => {
  it('infers capabilities from resource features', () => {
    const color = toDescriptor(lights[0]!, idx.devices.get('d-color'), idx.roomOfDevice.get('d-color'))
    expect(color).toMatchObject({ id: 'hue:l-color', kind: 'light', name: 'Salon plafonnier', capabilities: ['on_off', 'brightness', 'color_temp', 'color'] })
    expect(color.meta).toMatchObject({ manufacturer: 'Signify Netherlands B.V.', model: 'Hue color lamp', room: 'Salon', colorTempMirek: [153, 500] })
    const white = toDescriptor(lights[1]!, idx.devices.get('d-white'), idx.roomOfDevice.get('d-white'))
    expect(white.capabilities).toEqual(['on_off', 'brightness', 'color_temp'])
    const plain = toDescriptor(lights[2]!, idx.devices.get('d-plain'), idx.roomOfDevice.get('d-plain'))
    expect(plain.capabilities).toEqual(['on_off'])
    expect(plain.meta.room).toBeUndefined()
  })
  it('maps a room group', () => {
    const g = toGroupDescriptor(hueGroupedLightSchema.parse(GROUPED_LIGHTS[0]), rooms[0])
    expect(g).toMatchObject({ id: 'hue:g-living', name: 'Salon', capabilities: ['on_off', 'brightness'], meta: { isGroup: true } })
  })
  it('state patch: drops invalid mirek, rounds brightness, works on fragments', () => {
    expect(toLightPatch(lights[0]!)).toEqual({ on: true, brightness: 64, colorTempMirek: 366, color: { x: 0.4573, y: 0.41 } })
    expect(toLightPatch(lights[1]!)).toEqual({ on: false, brightness: 100 })
    expect(toLightPatch({ dimming: { brightness: 20 } })).toEqual({ brightness: 20 })
    expect(toLightPatch({})).toEqual({})
  })
  it('put body: brightness 0 → off, clamps, color wins over color temperature', () => {
    const d = toDescriptor(lights[0]!, idx.devices.get('d-color'))
    expect(toPutBody({ type: 'light.set', brightness: 0 }, d).body).toEqual({ on: { on: false } })
    expect(toPutBody({ type: 'light.set', brightness: 40 }, d, 0.2).body).toEqual({ on: { on: true }, dimming: { brightness: 40 } })
    expect(toPutBody({ type: 'light.set', on: false, brightness: 40 }, d).body).toEqual({ on: { on: false }, dimming: { brightness: 40 } })
    expect(toPutBody({ type: 'light.set', colorTempMirek: 9999 }, d).body).toEqual({ color_temperature: { mirek: 500 } })
    const both = toPutBody({ type: 'light.set', color: { x: 0.1, y: 0.2 }, colorTempMirek: 300, transitionMs: 400 }, d)
    expect(both.body).toEqual({ color: { xy: { x: 0.1, y: 0.2 } }, dynamics: { duration: 400 } })
    expect(both.warnings).toHaveLength(1)
    const plain = toDescriptor(lights[2]!)
    const ignored = toPutBody({ type: 'light.set', color: { x: 0.1, y: 0.2 } }, plain)
    expect(ignored.body).toEqual({})
    expect(ignored.warnings).toHaveLength(1)
  })
  it('zigbee connectivity → availability per light', () => {
    const z = ZIGBEE.map((x) => hueZigbeeConnectivitySchema.parse(x))
    expect(connectivityToAvailability(z, idx)).toEqual([['l-color', true], ['l-white', false], ['l-plain', true]])
  })
})
