import { describe, expect, it } from 'vitest'
import { DEVICE_KINDS, KIND_CAPABILITIES } from './kinds'
import { deviceDescriptorSchema, type DeviceDescriptor } from './descriptor'
import { deviceStateSchema, type StateFor } from './state'
import { commandSchema, commandKind } from './command'
import type { CommandNotAllowedError} from './rules';
import { assertCommandAllowed, defaultState, makeDeviceId, mergeState, parseDeviceId } from './rules'

const light: DeviceDescriptor = {
  id: 'mock:light-1', pluginId: 'mock', externalId: 'light-1', kind: 'light', name: 'Lampe',
  capabilities: ['on_off', 'brightness'], meta: {},
}

describe('device ids', () => {
  it('round-trips', () => {
    expect(parseDeviceId(makeDeviceId('hue', 'abc-def'))).toEqual({ pluginId: 'hue', externalId: 'abc-def' })
  })
  it('rejects malformed ids', () => {
    expect(() => parseDeviceId('nocolon')).toThrow()
    expect(() => parseDeviceId('Hue:x')).toThrow()
    expect(() => parseDeviceId('hue:a:b')).toThrow()
  })
})

describe('descriptor schema', () => {
  it('accepts a consistent descriptor', () => {
    expect(deviceDescriptorSchema.parse(light)).toMatchObject({ id: 'mock:light-1' })
  })
  it('rejects id mismatch', () => {
    expect(deviceDescriptorSchema.safeParse({ ...light, id: 'mock:other' }).success).toBe(false)
  })
  it('rejects capability not allowed for kind', () => {
    expect(deviceDescriptorSchema.safeParse({ ...light, capabilities: ['position'] }).success).toBe(false)
  })
})

describe('assertCommandAllowed', () => {
  it('accepts a supported command', () => {
    expect(() => assertCommandAllowed(light, { type: 'light.set', on: true })).not.toThrow()
  })
  it('rejects a command of another kind', () => {
    try { assertCommandAllowed(light, { type: 'cover.open' }); expect.fail('should throw') }
    catch (e) { expect((e as CommandNotAllowedError).code).toBe('KIND_MISMATCH') }
  })
  it('rejects a command whose capability is missing', () => {
    const cover: DeviceDescriptor = { ...light, id: 'mock:c', externalId: 'c', kind: 'cover', capabilities: ['position'] }
    try { assertCommandAllowed(cover, { type: 'cover.stop' }); expect.fail('should throw') }
    catch (e) { expect((e as CommandNotAllowedError).code).toBe('UNSUPPORTED_COMMAND') }
  })
  it('derives kind from the command name', () => {
    expect(commandKind({ type: 'media_player.set_volume', volume: 10 })).toBe('media_player')
  })
  it('every command type parses with its prefix as a known kind', () => {
    for (const opt of commandSchema.options) {
      const type = opt.shape.type.value
      expect(DEVICE_KINDS).toContain(commandKind(type))
    }
  })
})

describe('mergeState', () => {
  const prev: StateFor<'light'> = { kind: 'light', updatedAt: 1, available: true, on: false, brightness: 40 }
  it('returns the same reference when nothing changes', () => {
    expect(mergeState(prev, { on: false, brightness: 40 }, 99)).toBe(prev)
    expect(mergeState(prev, {}, 99)).toBe(prev)
  })
  it('applies changes and stamps updatedAt', () => {
    const next = mergeState(prev, { on: true }, 99)
    expect(next).not.toBe(prev)
    expect(next).toEqual({ ...prev, on: true, updatedAt: 99 })
  })
  it('compares nested objects structurally', () => {
    const withColor = { ...prev, color: { x: 0.3, y: 0.3 } }
    expect(mergeState(withColor, { color: { x: 0.3, y: 0.3 } }, 5)).toBe(withColor)
    expect(mergeState(withColor, { color: { x: 0.4, y: 0.3 } }, 5).color).toEqual({ x: 0.4, y: 0.3 })
  })
  it('ignores undefined patch values', () => {
    expect(mergeState(prev, { brightness: undefined }, 5)).toBe(prev)
  })
})

describe('defaultState', () => {
  it('produces a valid, unavailable state for every kind', () => {
    for (const kind of DEVICE_KINDS) {
      const s = defaultState(kind, 7)
      expect(deviceStateSchema.parse(s)).toEqual(s)
      expect(s.available).toBe(false)
      expect(s.updatedAt).toBe(7)
      expect(KIND_CAPABILITIES[kind].length).toBeGreaterThan(0)
    }
  })

  it('ne pose AUCUNE position pour un ouvrant', () => {
    // Un `position: 0` par défaut se lit comme un fait : une radio unidirectionnelle n'en publie
    // jamais, et l'interface annonçait « fermé » (compteurs du résumé compris) sans rien savoir.
    const s = defaultState('cover')
    expect(s.kind === 'cover' && s.position).toBeUndefined()
    expect(deviceStateSchema.parse(s)).toEqual(s)
  })
})
