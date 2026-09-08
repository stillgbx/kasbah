import { describe, expect, it } from 'vitest'
import { DEVICES, GROUPED_LIGHTS, LIGHTS, ROOMS, SCENES, ZIGBEE, ZONES } from './__fixtures__/bridge'
import {
  connectivityToAvailability, indexResources, sceneStatusToActive, toDescriptor, toGroupDescriptor, toLightPatch,
  sceneTargetLights, toPutBody, toSceneDescriptor, toSceneRecallBody,
} from './mapping'
import { hueDeviceSchema, hueGroupedLightSchema, hueLightSchema, hueRoomSchema, hueSceneSchema, hueZigbeeConnectivitySchema } from './types'

const lights = LIGHTS.map((l) => hueLightSchema.parse(l))
const devices = DEVICES.map((d) => hueDeviceSchema.parse(d))
const rooms = ROOMS.map((r) => hueRoomSchema.parse(r))
const idx = indexResources(lights, devices, rooms)
const scenes = SCENES.map((s) => hueSceneSchema.parse(s))
const zones = ZONES.map((z) => hueRoomSchema.parse(z))

describe('hue mapping', () => {
  it('infers capabilities from resource features', () => {
    const color = toDescriptor(lights[0]!, idx.devices.get('d-color'), idx.roomOfDevice.get('d-color'))
    expect(color).toMatchObject({ id: 'hue:l-color', kind: 'light', name: 'Salon plafonnier', capabilities: ['on_off', 'brightness', 'color_temp', 'color'] })
    expect(color.meta).toMatchObject({ manufacturer: 'Signify Netherlands B.V.', model: 'Hue color lamp', room: 'Salon', colorTempMirek: [153, 500] })
    const white = toDescriptor(lights[1]!, idx.devices.get('d-white'), idx.roomOfDevice.get('d-white'))
    expect(white.capabilities).toEqual(['on_off', 'brightness', 'color_temp'])
    const plain = toDescriptor(lights[2]!, idx.devices.get('d-plain'), idx.roomOfDevice.get('d-plain'))
    expect(plain.capabilities).toEqual(['on_off', 'effect'])
    expect(plain.meta.effects).toEqual(['no_effect', 'candle', 'fire'])
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
  it('put body: an effect takes over the colour, an unsupported one is ignored', () => {
    const plain = toDescriptor(lights[2]!, idx.devices.get('d-plain'))
    expect(toPutBody({ type: 'light.set', effect: 'candle' }, plain).body).toEqual({ effects: { effect: 'candle' } })
    const both = toPutBody({ type: 'light.set', effect: 'candle', colorTempMirek: 300 }, plain)
    expect(both.body).toEqual({ effects: { effect: 'candle' } })
    expect(both.warnings).toEqual(['effect and color both given: effect wins'])
    // `no_effect` arrête l'effet : la couleur du même appel reste légitime
    const color = toDescriptor(lights[0]!, idx.devices.get('d-color'))
    expect(toPutBody({ type: 'light.set', effect: 'no_effect', color: { x: 0.3, y: 0.3 } }, color).warnings)
      .toEqual(['effect ignored: capability not supported by this light'])
    expect(toPutBody({ type: 'light.set', effect: 'candle' }, color).body).toEqual({})
  })
  it('scene: swatches from the animated palette, else from the fixed actions', () => {
    const roomScene = toSceneDescriptor(scenes[0]!, { name: 'Salon', kind: 'room' })
    expect(roomScene).toMatchObject({ id: 'hue:s-relax', externalId: 's-relax', name: 'Détente', dynamic: false, autoDynamic: false, group: { name: 'Salon', kind: 'room' } })
    // deux lampes au même blanc → UNE pastille
    expect(roomScene.swatches).toHaveLength(1)
    expect(roomScene.swatches[0]).toMatch(/^#[0-9a-f]{6}$/)
    const zoneScene = toSceneDescriptor(scenes[1]!, { name: zones[0]!.metadata!.name!, kind: 'zone' })
    // `auto_dynamic` du pont = préférence de l'utilisateur, remontée telle quelle
    expect(zoneScene).toMatchObject({ id: 'hue:s-tropical', dynamic: true, autoDynamic: true, group: { name: 'Soirée', kind: 'zone' } })
    expect(toSceneDescriptor({ ...scenes[1]!, auto_dynamic: undefined }).autoDynamic).toBe(false)
    expect(zoneScene.swatches).toHaveLength(2)
    expect(toSceneDescriptor(scenes[0]!).group).toBeUndefined()
  })
  it('scene: status → activation, recall body', () => {
    expect(sceneStatusToActive(scenes[0]!)).toBe('inactive')
    expect(sceneStatusToActive(scenes[1]!)).toBe('dynamic')
    expect(sceneStatusToActive({ status: undefined })).toBe('inactive')
    // `static` et NON `active` : `active` démarrerait l'animation des scènes `auto_dynamic`
    expect(toSceneRecallBody({ mode: 'static' })).toEqual({ recall: { action: 'static' } })
    expect(toSceneRecallBody({ mode: 'dynamic', brightness: 60, transitionMs: 800 }))
      .toEqual({ recall: { action: 'dynamic_palette', dimming: { brightness: 60 }, duration: 800 } })
    expect(sceneTargetLights(scenes[0]!)).toEqual(['l-color', 'l-white'])
    expect(sceneTargetLights({ ...scenes[0]!, actions: [] })).toEqual([])
  })
  it('zigbee connectivity → availability per light', () => {
    const z = ZIGBEE.map((x) => hueZigbeeConnectivitySchema.parse(x))
    expect(connectivityToAvailability(z, idx)).toEqual([['l-color', true], ['l-white', false], ['l-plain', true]])
  })
})
