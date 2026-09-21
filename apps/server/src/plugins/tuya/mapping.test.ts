import { describe, expect, it } from 'vitest'
import { deviceDescriptorSchema } from '@kasbah/shared'
import { PluginError } from '../../core/plugin'
import {
  CONNECT_FULL,
  DELTA_FAN_OFF_CLEARS_TIMER,
  DELTA_FAN_REVERSE,
  DELTA_FAN_SPEED_4,
  DELTA_LIGHT_OFF,
  DELTA_MUTE_OFF,
  DELTA_TEMP_2700,
  DELTA_TEMP_4000,
  DELTA_TIMER_4H,
} from './__fixtures__/tuya'
import {
  COLOR_TEMP_MIREKS,
  deriveNames,
  fanCommandToDps,
  lightCommandToDps,
  toDescriptors,
  toFanPatch,
  toLightPatch,
} from './mapping'

describe('tuya mapping', () => {
  it('dérive les noms du physique sans répéter la pièce', () => {
    expect(deriveNames('Ventilateur plafonnier chambre 2')).toEqual({
      fan: 'Ventilateur chambre 2',
      light: 'Plafonnier chambre 2',
    })
  })

  it('émet deux descripteurs valides liés fan → light', () => {
    const [light, fan] = toDescriptors({
      id: 'bf0000000000000000abcd',
      key: 'xxxxxxxxxxxxxxxx',
      ip: '192.168.1.56',
      name: 'Ventilateur plafonnier chambre 2',
      version: '3.5',
    })
    expect(deviceDescriptorSchema.parse(light).kind).toBe('light')
    expect(deviceDescriptorSchema.parse(fan).kind).toBe('fan')
    expect(fan!.meta.linkedTo).toBe(light!.id)
    expect(light!.meta.colorTempMirekSteps).toEqual([...COLOR_TEMP_MIREKS])
    expect(fan!.meta.fan?.speeds).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('mappe la trame complète de connexion', () => {
    expect(toLightPatch(CONNECT_FULL)).toEqual({ on: true, colorTempMirek: 303 })
    expect(toFanPatch(CONNECT_FULL)).toEqual({
      on: false, speed: 3, direction: 'forward', timerMin: 0, muted: true,
    })
  })

  it('mappe les deltas capturés (dont timer 239)', () => {
    expect(toLightPatch(DELTA_LIGHT_OFF)).toEqual({ on: false })
    expect(toLightPatch(DELTA_TEMP_2700)).toEqual({ colorTempMirek: 370 })
    expect(toLightPatch(DELTA_TEMP_4000)).toEqual({ colorTempMirek: 250 })
    expect(toFanPatch(DELTA_FAN_SPEED_4)).toEqual({ on: true, speed: 4 })
    expect(toFanPatch(DELTA_FAN_REVERSE)).toEqual({ direction: 'reverse' })
    expect(toFanPatch(DELTA_TIMER_4H)).toEqual({ timerMin: 239 })
    expect(toFanPatch(DELTA_MUTE_OFF)).toEqual({ muted: false })
    expect(toFanPatch(DELTA_FAN_OFF_CLEARS_TIMER)).toEqual({ on: false, timerMin: 0 })
  })

  it('refuse une température hors des trois crans', () => {
    expect(() => lightCommandToDps({ type: 'light.set', colorTempMirek: 280 }))
      .toThrow(PluginError)
    expect(lightCommandToDps({ type: 'light.set', colorTempMirek: 370 }))
      .toEqual([{ dps: 23, set: 1000 }])
    expect(lightCommandToDps({ type: 'light.set', colorTempMirek: 250 }))
      .toEqual([{ dps: 23, set: 0 }])
    expect(lightCommandToDps({ type: 'light.set', colorTempMirek: 303 }))
      .toEqual([{ dps: 23, set: 500 }])
  })

  it('écrit la vitesse sans poser on côté DP (l\'appareil allume seul)', () => {
    expect(fanCommandToDps({ type: 'fan.set', speed: 4 })).toEqual([{ dps: 62, set: 4 }])
  })

  it('refuse une vitesse hors liste', () => {
    expect(() => fanCommandToDps({ type: 'fan.set', speed: 7 })).toThrow(PluginError)
  })
})
