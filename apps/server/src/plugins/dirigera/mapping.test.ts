import { deviceDescriptorSchema } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import { AIR_SENSOR, BLINDS, COLOR_LIGHT, OUTLET, REMOTE, SPEAKER, WHITE_LIGHT } from './__fixtures__/hub'
import { mergeEvent, toDescriptors, toPatches, toWrites } from './mapping'
import { dirigeraDeviceSchema } from './types'

const dev = (raw: unknown) => dirigeraDeviceSchema.parse(raw)

describe('DIRIGERA mapping', () => {
  it('every descriptor passes the shared contract', () => {
    for (const raw of [COLOR_LIGHT, WHITE_LIGHT, OUTLET, BLINDS, AIR_SENSOR]) {
      for (const d of toDescriptors(dev(raw))) expect(deviceDescriptorSchema.safeParse(d).success).toBe(true)
    }
  })

  it('a color light: its capabilities, its mirek range sorted, its room', () => {
    const [d] = toDescriptors(dev(COLOR_LIGHT))
    expect(d).toMatchObject({
      id: `dirigera:${COLOR_LIGHT.id}`, kind: 'light', name: 'Lampe 1',
      capabilities: ['on_off', 'brightness', 'color_temp', 'color'],
      meta: { manufacturer: 'IKEA of Sweden', room: 'Salon', colorTempMirek: [250, 454] },
    })
  })

  it('the color mode decides between color and white temperature', () => {
    const [[, color]] = toPatches(dev(COLOR_LIGHT)) as [[string, Record<string, unknown>]]
    expect(color).toMatchObject({ on: true, brightness: 80 })
    expect(color.color).toBeDefined()
    expect(color.colorTempMirek).toBeUndefined()
    const [[, white]] = toPatches(dev(WHITE_LIGHT)) as [[string, Record<string, unknown>]]
    expect(white).toEqual({ on: false, brightness: 30, colorTempMirek: 370 })
  })

  it('an outlet is an on/off light, with its metering as sensors linked to it', () => {
    const list = toDescriptors(dev(OUTLET))
    expect(list.map((d) => [d.externalId, d.kind])).toEqual([
      [OUTLET.id, 'light'], [`${OUTLET.id}.power`, 'sensor'], [`${OUTLET.id}.energy`, 'sensor'],
    ])
    expect(list[0]!.capabilities).toEqual(['on_off'])
    expect(list[1]!.meta).toMatchObject({ sensor: { unit: 'W', deviceClass: 'power' }, linkedTo: `dirigera:${OUTLET.id}` })
    expect(toPatches(dev(OUTLET))).toEqual([
      [OUTLET.id, { on: true }], [`${OUTLET.id}.power`, { value: 12.5 }], [`${OUTLET.id}.energy`, { value: 3.25 }],
    ])
  })

  it('a blind: the hub level is the share CLOSED, Kasbah the share open', () => {
    const [d] = toDescriptors(dev(BLINDS))
    expect(d).toMatchObject({ kind: 'cover', capabilities: ['open_close', 'position', 'stop', 'battery'], meta: { cover: { deviceClass: 'blind' }, room: 'Chambre 2' } })
    expect(toPatches(dev(BLINDS))).toEqual([[BLINDS.id, { motion: 'stopped', position: 25, batteryPct: 88 }]])
    const moving = dev({ ...BLINDS, attributes: { ...BLINDS.attributes, blindsState: 'up' } })
    expect(toPatches(moving)[0]![1]).toMatchObject({ motion: 'opening' })
  })

  it('an air sensor gives one sensor per measurement, not linked to anything', () => {
    const list = toDescriptors(dev(AIR_SENSOR))
    expect(list.map((d) => d.externalId)).toEqual([`${AIR_SENSOR.id}.temperature`, `${AIR_SENSOR.id}.humidity`, `${AIR_SENSOR.id}.pm25`])
    expect(list[0]!.meta.linkedTo).toBeUndefined()
    expect(toPatches(dev(AIR_SENSOR)).map(([, p]) => p)).toEqual([{ value: 21.3 }, { value: 48 }, { value: 6 }])
  })

  it('remotes and SYMFONISK speakers give nothing (the Sonos plugin has the speakers)', () => {
    expect(toDescriptors(dev(REMOTE))).toEqual([])
    expect(toDescriptors(dev(SPEAKER))).toEqual([])
    expect(toDescriptors(dev({ ...COLOR_LIGHT, isHidden: true }))).toEqual([])
  })

  it('an event is merged into the full state, the other attributes kept', () => {
    const merged = mergeEvent(dev(COLOR_LIGHT), { attributes: { lightLevel: 40 }, isReachable: false, room: { id: 'room-0003', name: 'Bureau' } })
    expect(merged.attributes).toMatchObject({ lightLevel: 40, isOn: true, colorHue: 120 })
    expect(merged.isReachable).toBe(false)
    expect(toDescriptors(merged)[0]!.meta.room).toBe('Bureau')
  })

  describe('commands', () => {
    it('off is a single write, whatever else comes with it', () => {
      expect(toWrites(dev(COLOR_LIGHT), { type: 'light.set', on: false, brightness: 50 })).toEqual([{ attributes: { isOn: false } }])
    })

    it('on, then level, then white temperature (clamped to the bulb), one family per write', () => {
      expect(toWrites(dev(WHITE_LIGHT), { type: 'light.set', on: true, brightness: 0, colorTempMirek: 600, transitionMs: 400 })).toEqual([
        { attributes: { isOn: true } },
        { attributes: { lightLevel: 1 }, transitionTime: 400 },
        { attributes: { colorTemperature: 2203 }, transitionTime: 400 },
      ])
    })

    it('a color becomes hue and saturation in the same write', () => {
      const [w] = toWrites(dev(COLOR_LIGHT), { type: 'light.set', color: { x: 0.17, y: 0.7 } })
      expect(Object.keys(w!.attributes)).toEqual(['colorHue', 'colorSaturation'])
    })

    it('an outlet only switches', () => {
      expect(toWrites(dev(OUTLET), { type: 'light.set', on: true, brightness: 50 })).toEqual([{ attributes: { isOn: true } }])
    })

    it('a blind: open, close, position (inverted), stop', () => {
      const b = dev(BLINDS)
      expect(toWrites(b, { type: 'cover.open' })).toEqual([{ attributes: { blindsTargetLevel: 0 } }])
      expect(toWrites(b, { type: 'cover.close' })).toEqual([{ attributes: { blindsTargetLevel: 100 } }])
      expect(toWrites(b, { type: 'cover.set_position', position: 30 })).toEqual([{ attributes: { blindsTargetLevel: 70 } }])
      expect(toWrites(b, { type: 'cover.stop' })).toEqual([{ attributes: { blindsState: 'stopped' } }])
    })

    it('a command of another kind is refused', () => {
      expect(() => toWrites(dev(BLINDS), { type: 'light.set', on: true })).toThrow(/UNSUPPORTED|light.set/)
      expect(() => toWrites(dev(COLOR_LIGHT), { type: 'cover.open' })).toThrow(/cover.open/)
    })
  })
})
