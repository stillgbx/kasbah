import { describe, expect, it } from 'vitest'
import { defaultState, type DeviceDescriptor, type DeviceState } from '@kasbah/shared'
import { brightnessFromLevel, closureCommandOf, coverCommandForLift, fanCommandOf, fanSpeedMax, levelFromBrightness, liftFromPosition, matterKindOf, matterStateOf, positionFromLift } from './mapping'

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

  it('publishes garage doors and gates as closures only when the house asks for it', () => {
    const garage = { ...device('cover', ['open_close', 'stop', 'position']), meta: { cover: { deviceClass: 'garage' } } } as DeviceDescriptor
    const gate = { ...device('cover', ['open_close']), meta: { cover: { deviceClass: 'gate' } } } as DeviceDescriptor
    const shutter = { ...device('cover', ['open_close', 'position']), meta: { cover: { deviceClass: 'shutter' } } } as DeviceDescriptor
    expect(matterKindOf(garage)).toBe('window_covering')
    expect(matterKindOf(garage, { closures: true })).toBe('closure')
    expect(matterKindOf(gate, { closures: true })).toBe('closure')
    expect(matterKindOf(shutter, { closures: true })).toBe('window_covering')
  })

  it('publishes a vehicle as a lock only when it has the lock', () => {
    expect(matterKindOf(device('vehicle', ['soc', 'lock']))).toBe('door_lock')
    expect(matterKindOf(device('vehicle', ['soc']))).toBeNull()
  })

  it('publishes a fan that turns on and off, with its number of speeds', () => {
    const fan = { ...device('fan', ['on_off', 'fan_speed', 'fan_direction']), meta: { fan: { speeds: [1, 2, 3, 4, 5, 6] } } } as DeviceDescriptor
    expect(matterKindOf(fan)).toBe('fan')
    expect(fanSpeedMax(fan)).toBe(6)
    expect(fanSpeedMax(device('fan', ['on_off']))).toBe(0)
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

describe('fan', () => {
  it('turns each written attribute into one Kasbah command', () => {
    expect(fanCommandOf('fanMode', 0, 6)).toEqual({ type: 'fan.set', on: false })
    expect(fanCommandOf('fanMode', 1, 6)).toEqual({ type: 'fan.set', on: true, speed: 2 })
    expect(fanCommandOf('fanMode', 2, 6)).toEqual({ type: 'fan.set', on: true, speed: 4 })
    expect(fanCommandOf('fanMode', 3, 6)).toEqual({ type: 'fan.set', on: true, speed: 6 })
    expect(fanCommandOf('fanMode', 4, 6)).toEqual({ type: 'fan.set', on: true })
    expect(fanCommandOf('percentSetting', 50, 6)).toEqual({ type: 'fan.set', on: true, speed: 3 })
    expect(fanCommandOf('percentSetting', 1, 6)).toEqual({ type: 'fan.set', on: true, speed: 1 })
    expect(fanCommandOf('percentSetting', 0, 6)).toEqual({ type: 'fan.set', on: false })
    expect(fanCommandOf('speedSetting', 5, 6)).toEqual({ type: 'fan.set', on: true, speed: 5 })
    expect(fanCommandOf('airflowDirection', 1, 6)).toEqual({ type: 'fan.set', direction: 'reverse' })
    expect(fanCommandOf('onOff', true, 6)).toEqual({ type: 'fan.set', on: true })
    expect(fanCommandOf('percentSetting', null, 6)).toBeNull()
  })

  it('a fan without speeds only turns on and off', () => {
    expect(fanCommandOf('percentSetting', 30, 0)).toEqual({ type: 'fan.set', on: true })
    expect(fanCommandOf('fanMode', 1, 0)).toEqual({ type: 'fan.set', on: true })
  })

  it('writes mode, percent and speed together from the Kasbah state', () => {
    expect(matterStateOf('fan', state('fan', { on: true, speed: 3, direction: 'forward' }), 6)).toEqual({
      onOff: { onOff: true },
      fanControl: { fanMode: 2, percentSetting: 50, percentCurrent: 50, speedSetting: 3, speedCurrent: 3, airflowDirection: 0 },
    })
    expect(matterStateOf('fan', state('fan', { on: false, speed: 3 }), 6).fanControl)
      .toEqual({ fanMode: 0, percentSetting: 0, percentCurrent: 0, speedSetting: 0, speedCurrent: 0 })
    expect(matterStateOf('fan', state('fan', { on: true }), 0).fanControl).toEqual({ fanMode: 4, percentSetting: 100, percentCurrent: 100 })
  })
})

describe('closure', () => {
  it('opens and closes, and ignores the target positions it does not offer', () => {
    expect(closureCommandOf(1)).toEqual({ type: 'cover.open' })
    expect(closureCommandOf(0)).toEqual({ type: 'cover.close' })
    expect(closureCommandOf(2)).toBeNull()
    expect(closureCommandOf(undefined)).toBeNull()
  })

  it('says fully closed, fully open or partly open, moving or not, and null when unknown', () => {
    expect(matterStateOf('closure', state('cover', { position: 0, motion: 'stopped' }))).toEqual({
      closureControl: { mainState: 0, overallCurrentState: { position: 0, secureState: true }, overallTargetState: null },
    })
    expect(matterStateOf('closure', state('cover', { position: 40, motion: 'opening' })).closureControl)
      .toEqual({ mainState: 1, overallCurrentState: { position: 2, secureState: false }, overallTargetState: { position: 1 } })
    expect(matterStateOf('closure', state('cover', { position: 100, motion: 'stopped' })).closureControl?.overallCurrentState).toEqual({ position: 1, secureState: false })
    expect(matterStateOf('closure', state('cover', { motion: 'closing' })).closureControl)
      .toEqual({ mainState: 1, overallCurrentState: null, overallTargetState: { position: 0 } })
  })
})
