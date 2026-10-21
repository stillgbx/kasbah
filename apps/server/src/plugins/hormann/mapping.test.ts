import { describe, expect, it } from 'vitest'
import { STATUS_BUS_SILENT, STATUS_CLOSED, STATUS_OPEN_LIT, STATUS_OPENING } from './__fixtures__/status'
import { ACTIONS } from './client'
import { doorIdOf, effectReached, isBusAlive, motionOf, needsStopFirst, toDescriptors, toDoorPatch, toLightPatch, toRequest } from './mapping'
import { hormannStatusSchema, parseHormannDoors } from './types'

const status = (raw: unknown) => hormannStatusSchema.parse(raw)

describe('hormann mapping', () => {
  it('one door yields a garage cover and its linked light', () => {
    const [door, light] = toDescriptors({ id: 'garage1', host: '192.168.1.51', password: '', name: 'Porte garage 1' })
    expect(door).toMatchObject({
      id: 'hormann:garage1_door', kind: 'cover', capabilities: ['open_close', 'stop', 'position'],
      meta: { cover: { deviceClass: 'garage' } },
    })
    expect(light).toMatchObject({
      id: 'hormann:garage1_light', kind: 'light', name: 'Éclairage Porte garage 1', capabilities: ['on_off'],
      meta: { linkedTo: 'hormann:garage1_door' },
    })
  })

  it('reads the door id back from either externalId', () => {
    expect(doorIdOf('garage1_door')).toBe('garage1')
    expect(doorIdOf('garage1_light')).toBe('garage1')
    expect(doorIdOf('garage1')).toBeNull()
  })

  it('maps every firmware door state to a motion', () => {
    for (const [doorstate, motion] of [
      ['opening', 'opening'], ['opening h', 'opening'], ['opening v', 'opening'], ['closing', 'closing'],
      ['open', 'stopped'], ['closed', 'stopped'], ['open h', 'stopped'], ['venting', 'stopped'], ['stopped', 'stopped'],
    ] as const) {
      expect(motionOf({ doorstate })).toBe(motion)
    }
  })

  it('publishes position and light from /status', () => {
    expect(toDoorPatch(status(STATUS_OPENING))).toEqual({ motion: 'opening', position: 12 })
    expect(toLightPatch(status(STATUS_OPEN_LIT))).toEqual({ on: true })
  })

  it('a bridge whose motor never polled it is not alive', () => {
    expect(isBusAlive(status(STATUS_CLOSED))).toBe(true)
    expect(isBusAlive(status(STATUS_BUS_SILENT))).toBe(false)
    expect(isBusAlive({ busResponseAge: 31 })).toBe(false)
  })

  it('the light toggles only when its state differs', () => {
    const lit = status(STATUS_OPEN_LIT)
    expect(toRequest('garage1_light', { type: 'light.set', on: true }, lit)).toBeNull()
    expect(toRequest('garage1_light', { type: 'light.set', on: false }, lit)).toEqual({ action: ACTIONS.toggleLight })
  })

  it('door commands map to the firmware actions', () => {
    expect(toRequest('garage1_door', { type: 'cover.open' }, undefined)).toEqual({ action: ACTIONS.open })
    expect(toRequest('garage1_door', { type: 'cover.set_position', position: 42.4 }, undefined))
      .toEqual({ action: ACTIONS.setPosition, params: { position: 42 } })
    expect(() => toRequest('garage1_door', { type: 'cover.set_tilt', tilt: 10 }, undefined))
      .toThrow(expect.objectContaining({ code: 'UNSUPPORTED_COMMAND' }))
  })

  it('an open counts as done once the door moves, a stop once it rests', () => {
    expect(effectReached('garage1_door', { type: 'cover.open' }, status(STATUS_CLOSED))).toBe(false)
    expect(effectReached('garage1_door', { type: 'cover.open' }, status(STATUS_OPENING))).toBe(true)
    expect(effectReached('garage1_door', { type: 'cover.stop' }, status(STATUS_OPENING))).toBe(false)
    expect(effectReached('garage1_door', { type: 'cover.set_position', position: 3 }, status(STATUS_CLOSED))).toBe(true)
  })

  it('a reversal needs a stop first, a command in the same direction does not', () => {
    const opening = status(STATUS_OPENING) // at 12 %
    expect(needsStopFirst('garage1_door', { type: 'cover.close' }, opening)).toBe(true)
    expect(needsStopFirst('garage1_door', { type: 'cover.open' }, opening)).toBe(false)
    expect(needsStopFirst('garage1_door', { type: 'cover.set_position', position: 8 }, opening)).toBe(true)
    expect(needsStopFirst('garage1_door', { type: 'cover.set_position', position: 50 }, opening)).toBe(false)
    expect(needsStopFirst('garage1_door', { type: 'cover.stop' }, opening)).toBe(false)
    expect(needsStopFirst('garage1_door', { type: 'cover.close' }, status(STATUS_CLOSED))).toBe(false)
    expect(needsStopFirst('garage1_light', { type: 'light.set', on: true }, opening)).toBe(false)
  })

  it('refuses a door list with a duplicate id', () => {
    const d = { id: 'garage1', host: 'h', name: 'n' }
    expect(() => parseHormannDoors(JSON.stringify([d, d]))).toThrow(/duplicate/)
    expect(parseHormannDoors('')).toEqual([])
  })
})
