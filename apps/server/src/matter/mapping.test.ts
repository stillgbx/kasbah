import { describe, expect, it } from 'vitest'
import { defaultState, type DeviceDescriptor, type DeviceState } from '@kasbah/shared'
import { brightnessFromLevel, coverCommandForLift, levelFromBrightness, liftFromPosition, matterKindOf, matterStateOf, positionFromLift } from './mapping'

const device = (kind: DeviceDescriptor['kind'], capabilities: string[]): DeviceDescriptor =>
  ({ id: `mock:${kind}1`, pluginId: 'mock', externalId: `${kind}1`, kind, name: 'Device', capabilities }) as unknown as DeviceDescriptor

const state = (kind: DeviceState['kind'], patch: Record<string, unknown>): DeviceState =>
  ({ ...defaultState(kind, 0), available: true, ...patch }) as DeviceState

describe('matterKindOf', () => {
  it('publishes a light as dimmable only when it has brightness', () => {
    expect(matterKindOf(device('light', ['on_off', 'brightness', 'color']))).toBe('dimmable_light')
    expect(matterKindOf(device('light', ['on_off']))).toBe('on_off_light')
  })

  it('publishes a cover that opens and closes, even without position', () => {
    expect(matterKindOf(device('cover', ['open_close', 'stop', 'position']))).toBe('window_covering')
    expect(matterKindOf(device('cover', ['open_close']))).toBe('window_covering')
  })

  it('publishes a vehicle as a lock only when it has the lock', () => {
    expect(matterKindOf(device('vehicle', ['soc', 'lock']))).toBe('door_lock')
    expect(matterKindOf(device('vehicle', ['soc']))).toBeNull()
  })

  it('does not publish the kinds it cannot translate', () => {
    expect(matterKindOf(device('sensor', []))).toBeNull()
  })
})

describe('units', () => {
  it('maps brightness 0-100 to a Matter level 1-254 and back', () => {
    expect(levelFromBrightness(100)).toBe(254)
    expect(levelFromBrightness(0)).toBe(1)
    expect(brightnessFromLevel(254)).toBe(100)
    expect(brightnessFromLevel(levelFromBrightness(40))).toBe(40)
  })

  it('inverts the cover scale: Matter counts what is closed', () => {
    expect(liftFromPosition(100)).toBe(0)
    expect(liftFromPosition(0)).toBe(10000)
    expect(positionFromLift(2500)).toBe(75)
  })
})

describe('coverCommandForLift', () => {
  it('sets the position of a cover that has one', () => {
    expect(coverCommandForLift(device('cover', ['open_close', 'position']), 2500)).toEqual({ type: 'cover.set_position', position: 75 })
  })

  it('sends a cover without position to its nearest end', () => {
    const rts = device('cover', ['open_close'])
    expect(coverCommandForLift(rts, 2000)).toEqual({ type: 'cover.open' })
    expect(coverCommandForLift(rts, 8000)).toEqual({ type: 'cover.close' })
  })
})

describe('matterStateOf', () => {
  it('writes the level only for a dimmable light that reports a brightness', () => {
    expect(matterStateOf('dimmable_light', state('light', { on: true, brightness: 50 }))).toEqual({ onOff: { onOff: true }, levelControl: { currentLevel: 127 } })
    expect(matterStateOf('on_off_light', state('light', { on: false, brightness: 50 }))).toEqual({ onOff: { onOff: false } })
  })

  it('says null for a cover whose position is unknown', () => {
    expect(matterStateOf('window_covering', state('cover', { position: 100 })).windowCovering?.currentPositionLiftPercent100ths).toBe(0)
    expect(matterStateOf('window_covering', state('cover', {})).windowCovering?.currentPositionLiftPercent100ths).toBeNull()
  })

  it('maps the vehicle lock, null when the maker does not report it', () => {
    expect(matterStateOf('door_lock', state('vehicle', { locked: true }))).toEqual({ doorLock: { lockState: 1 } })
    expect(matterStateOf('door_lock', state('vehicle', { locked: false }))).toEqual({ doorLock: { lockState: 2 } })
    expect(matterStateOf('door_lock', state('vehicle', {}))).toEqual({ doorLock: { lockState: null } })
  })
})
