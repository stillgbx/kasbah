import { describe, expect, it } from 'vitest'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { optimisticPatch } from './optimistic'
import { formatPower, formatSensor, summarize } from './format'
import { deviceColor, deviceIcon } from './deviceIcons'
import fr from '../i18n/locales/fr.json'
import en from '../i18n/locales/en.json'

const light: StateFor<'light'> = { kind: 'light', updatedAt: 0, available: true, on: false, brightness: 50 }
const cover: StateFor<'cover'> = { kind: 'cover', updatedAt: 0, available: true, position: 100, motion: 'stopped' }
const sensor: DeviceDescriptor = { id: 'mock:s', pluginId: 'mock', externalId: 's', kind: 'sensor', name: 'T', capabilities: ['measure'], meta: { sensor: { unit: '°C', deviceClass: 'temperature', precision: 1 } } }

describe('optimisticPatch', () => {
  it('light.set', () => {
    expect(optimisticPatch(light, { type: 'light.set', on: true })).toEqual({ on: true })
    expect(optimisticPatch(light, { type: 'light.set', brightness: 0 })).toEqual({ on: false })
    expect(optimisticPatch(light, { type: 'light.set', brightness: 30 })).toEqual({ on: true, brightness: 30 })
    expect(optimisticPatch(light, { type: 'cover.open' })).toBeNull()
  })
  it('cover', () => {
    expect(optimisticPatch(cover, { type: 'cover.close' })).toEqual({ motion: 'closing' })
    expect(optimisticPatch(cover, { type: 'cover.open' })).toEqual({ motion: 'stopped' })
    expect(optimisticPatch(cover, { type: 'cover.set_position', position: 20 })).toEqual({ motion: 'closing' })
  })
})

describe('format & icons', () => {
  it('formats power and sensors', () => {
    expect(formatPower(850, 'en')).toBe('850 W')
    expect(formatPower(2400, 'en')).toBe('2.4 kW')
    expect(formatSensor(sensor, 21.44, 'en')).toBe('21.4 °C')
    expect(summarize(sensor, { kind: 'sensor', updatedAt: 0, available: true, value: 3 }, 'en')).toBe('3.0 °C')
  })
  it('picks icons and colors from state', () => {
    const d: DeviceDescriptor = { ...sensor, kind: 'light', capabilities: ['on_off'], meta: {} }
    expect(deviceIcon(d, { ...light, on: true })).not.toBe(deviceIcon(d, light))
    expect(deviceColor({ ...light, on: true })).toBe('warning')
    expect(deviceColor({ ...light, available: false })).toBe('on-surface-variant')
  })
})

describe('i18n locales', () => {
  const keys = (o: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]))
  it('fr and en expose the same keys', () => {
    const a = keys(fr).sort(), b = keys(en).sort()
    expect(a).toEqual(b)
  })
})
