import { describe, expect, it } from 'vitest'
import { DEVICE_KINDS } from '../devices/kinds'
import { stateKeys } from '../devices/state'
import { serverMessageSchema } from '../protocol/ws'
import { automationBodySchema, automationSchema, automationsFileSchema, type Automation } from './automation'
import { TRIGGER_FIELDS } from './fields'
import { inverseCommand } from './inverse'
import { predicateSchema } from './predicate'

// Shutters at dusk, the example that started the project: shifted and bounded sun, days,
// blockers (music or light on the terrace), selection of all the shutters.
const shuttersAtDusk: Automation = {
  id: 'volets-crepuscule',
  name: 'Volets au crépuscule',
  enabled: true,
  trigger: { type: 'time', at: { kind: 'sun', event: 'dusk', offsetMin: -15, notAfter: '22:00' }, days: [1, 2, 3, 4, 5, 6, 0] },
  unless: [
    { type: 'anyInRoom', roomId: 'terrasse', kind: 'media_player' },
    { type: 'anyInRoom', roomId: 'terrasse', kind: 'light' },
  ],
  actions: [{ type: 'command', target: { type: 'selector', kind: 'cover', deviceClass: 'shutter' }, command: { type: 'cover.close' } }],
}

describe('automation schema', () => {
  it('round-trips the dusk shutters rule unchanged', () => {
    expect(automationSchema.parse(shuttersAtDusk)).toEqual(shuttersAtDusk)
  })

  it('accepts a state trigger with hold time and a TV exception on a selector', () => {
    const a = automationSchema.parse({
      id: 'garage-tesla', name: 'Garage à l’arrivée', enabled: true,
      trigger: { type: 'state', when: { type: 'vehicleOnSite', deviceId: 'tesla:5YJ' }, forMin: 1 },
      unless: [{ type: 'any', of: [{ type: 'timeWindow', from: '23:00', to: '06:00' }, { type: 'days', days: [0] }] }],
      actions: [
        { type: 'command', target: { type: 'devices', deviceIds: ['mock:garage'] }, command: { type: 'cover.open' } },
        { type: 'command', target: { type: 'selector', kind: 'light', exceptRoomsWith: { kind: 'media_player', deviceClass: 'tv' } }, command: { type: 'light.set', on: false } },
        { type: 'recallScene', sceneId: 'hue:abc', recall: { mode: 'static' } },
      ],
    })
    expect(a.actions).toHaveLength(3)
  })

  it('refuses an any group nested in an any group (one level of OR)', () => {
    const nested = { type: 'any', of: [{ type: 'any', of: [{ type: 'days', days: [1] }] }] }
    expect(predicateSchema.safeParse(nested).success).toBe(false)
  })

  it('refuses malformed times, empty actions and unknown trigger types', () => {
    const base = { name: 'x', enabled: true, unless: [], actions: shuttersAtDusk.actions }
    expect(automationBodySchema.safeParse({ ...base, trigger: { type: 'time', at: { kind: 'clock', time: '24:00' } } }).success).toBe(false)
    expect(automationBodySchema.safeParse({ ...base, trigger: shuttersAtDusk.trigger, actions: [] }).success).toBe(false)
    expect(automationBodySchema.safeParse({ ...base, trigger: { type: 'forecast' } }).success).toBe(false)
  })

  it('refuses a command that is not in the contract', () => {
    const bad = { ...shuttersAtDusk, actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:x'] }, command: { type: 'cover.explode' } }] }
    expect(automationSchema.safeParse(bad).success).toBe(false)
  })

  it('keeps the file shape versioned', () => {
    expect(automationsFileSchema.safeParse({ schemaVersion: 1, automations: [shuttersAtDusk] }).success).toBe(true)
    expect(automationsFileSchema.safeParse({ schemaVersion: 2, automations: [] }).success).toBe(false)
  })

  it('lets an older server snapshot without automations through', () => {
    const msg = serverMessageSchema.parse({ type: 'snapshot', serverTime: 0, devices: [] })
    expect(msg.type === 'snapshot' && msg.automations).toEqual([])
  })
})

describe('TRIGGER_FIELDS', () => {
  it('only offers fields that exist in the state of their kind', () => {
    for (const kind of DEVICE_KINDS) {
      const keys = stateKeys(kind)
      for (const f of TRIGGER_FIELDS[kind] ?? []) expect(keys.has(f.field), `${kind}.${f.field}`).toBe(true)
    }
  })
})

describe('inverseCommand', () => {
  it('inverts the obvious commands only', () => {
    expect(inverseCommand({ type: 'cover.open' })).toEqual({ type: 'cover.close' })
    expect(inverseCommand({ type: 'light.set', on: true })).toEqual({ type: 'light.set', on: false })
    expect(inverseCommand({ type: 'light.set', on: true, brightness: 40 })).toBeUndefined()
    expect(inverseCommand({ type: 'mower.start' })).toEqual({ type: 'mower.park', untilNextSchedule: true })
    expect(inverseCommand({ type: 'cover.set_position', position: 30 })).toBeUndefined()
  })

  it('undoes a fade with the same fade', () => {
    expect(inverseCommand({ type: 'light.set', on: true, transitionMs: 600_000 })).toEqual({ type: 'light.set', on: false, transitionMs: 600_000 })
    expect(inverseCommand({ type: 'light.set', on: true, brightness: 40, transitionMs: 5000 })).toBeUndefined()
  })
})
