import { describe, expect, it } from 'vitest'
import { deviceDescriptorSchema, deviceStateSchema, pluginSceneSchema, type DeviceEventKind, type SceneActivation } from '@kasbah/shared'
import { ManualClock } from './clock'
import { Simulation } from './simulation'
import { SimError } from './types'
import tilleuls from '../../../house/demos/tilleuls.json'
import embruns from '../../../house/demos/embruns.json'
import belvedere from '../../../house/demos/belvedere.json'

interface DemoJson { meta: { demo: { scenario: string } }; devices: { deviceId?: string }[]; arrays?: { panels: (string | null)[] }[] }
const HOUSES: Record<string, DemoJson> = { tilleuls, embruns, belvedere }

// Lundi 7 septembre 2026, 00:00 UTC, fuseau 0 → heures locales = UTC.
const MONDAY = Date.UTC(2026, 8, 7)
const make = (scenario: 'tilleuls' | 'embruns' | 'belvedere' | 'tilleuls-winter') =>
  new Simulation({ scenario, seed: 7, startTime: MONDAY, tzOffsetMin: 0, clock: new ManualClock(MONDAY) })

describe('demo properties', () => {
  it.each(['tilleuls', 'embruns', 'belvedere', 'tilleuls-winter'] as const)('%s builds valid, unique descriptors and states', (name) => {
    const sim = make(name)
    const ids = sim.devices().map((d) => d.externalId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const d of sim.devices()) expect(deviceDescriptorSchema.parse(d)).toEqual(d)
    for (const [, s] of sim.states()) expect(deviceStateSchema.parse(s)).toEqual(s)
    for (const s of sim.scenes()) {
      expect(pluginSceneSchema.parse({ ...s, id: `mock:${s.externalId}`, pluginId: 'mock' })).toBeTruthy()
    }
  })

  // la maison et son parc vont ensemble : un appareil posé que la simulation ne publie pas resterait
  // grisé, un appareil publié sans place irait « hors plan » (seule la météo n'a pas de place)
  it.each([['tilleuls', 'tl'], ['embruns', 'em'], ['belvedere', 'ap']] as const)('%s: the house binds exactly the simulated devices', (name, prefix) => {
    const house = HOUSES[name]!
    expect(house.meta.demo.scenario).toBe(name)
    const bound = new Set([...house.devices.map((d) => d.deviceId), ...(house.arrays ?? []).flatMap((a) => a.panels)].filter(Boolean))
    const published = make(name).devices().map((d) => d.id)
    expect([...bound].filter((id) => !published.includes(id!))).toEqual([])
    expect(published.filter((id) => !bound.has(id))).toEqual([`mock:${prefix}-weather`])
  })

  it('every scene light exists in its property', () => {
    for (const name of ['tilleuls', 'embruns', 'belvedere'] as const) {
      const sim = make(name)
      for (const scene of sim.scenario.scenes ?? []) {
        for (const id of Object.keys(scene.lights)) expect(sim.getState(id)?.kind, `${name} ${scene.externalId} → ${id}`).toBe('light')
      }
    }
  })
})

describe('simulated doorbell', () => {
  it('rings once at each declared hour, and a plain camera never does', () => {
    const sim = make('tilleuls')
    const events: [string, DeviceEventKind][] = []
    sim.start(() => {}, undefined, (id, e) => events.push([id, e]))
    sim.tick(24 * 3600)
    expect(events).toEqual([['tl-cam-sonnette', 'chime'], ['tl-cam-sonnette', 'chime']])
    sim.stop()
  })
})

describe('simulated scenes', () => {
  it('recall sets the lights, clears the other scenes of the group, and a manual change leaves it', async () => {
    const sim = make('tilleuls')
    const changes: [string, SceneActivation][] = []
    sim.start(() => {}, undefined, undefined, (id, a) => changes.push([id, a]))
    await sim.recallScene('tl-scene-lecture', { mode: 'static' })
    expect(sim.getState('tl-light-salon')).toMatchObject({ on: true, brightness: 100, colorTempMirek: 250 })
    await sim.recallScene('tl-scene-detente', { mode: 'static', brightness: 50 })
    expect(sim.getState('tl-light-salon')).toMatchObject({ on: true, brightness: 18 })
    expect(sim.sceneState('tl-scene-lecture')).toBe('inactive')
    expect(sim.sceneState('tl-scene-detente')).toBe('static')
    await sim.execute('tl-light-lampadaire', { type: 'light.set', brightness: 10 })
    expect(sim.sceneState('tl-scene-detente')).toBe('inactive')
    expect(changes).toEqual([['tl-scene-lecture', 'static'], ['tl-scene-lecture', 'inactive'], ['tl-scene-detente', 'static'], ['tl-scene-detente', 'inactive']])
    sim.stop()
  })

  it('off turns the lights off; dynamic is refused on a fixed scene', async () => {
    const sim = make('tilleuls')
    await sim.recallScene('tl-scene-soiree', { mode: 'dynamic' })
    expect(sim.sceneState('tl-scene-soiree')).toBe('dynamic')
    await sim.recallScene('tl-scene-soiree', { mode: 'off' })
    expect(sim.getState('tl-light-salon')).toMatchObject({ on: false })
    expect(sim.sceneState('tl-scene-soiree')).toBe('inactive')
    await expect(sim.recallScene('tl-scene-lecture', { mode: 'dynamic' })).rejects.toThrow(SimError)
  })

  it('a light with effects accepts one of them and refuses an unknown one', async () => {
    const sim = make('tilleuls')
    await sim.execute('tl-light-salon', { type: 'light.set', effect: 'candle' })
    expect(sim.getState('tl-light-salon')).toMatchObject({ on: true, effect: 'candle' })
    await expect(sim.execute('tl-light-salon', { type: 'light.set', effect: 'disco' })).rejects.toThrow(SimError)
  })
})
