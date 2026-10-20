import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import type { Automation, AutomationBody, Command, DeviceDescriptor, StatePatch } from '@kasbah/shared'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadHouse, type LoadedHouse } from '../../config/house'
import { Bus } from '../bus'
import { PluginError } from '../plugin'
import { DeviceRegistry } from '../registry'
import { SceneRegistry } from '../scene-registry'
import { HouseView } from './context'
import { AutomationEngine } from './engine'
import { evaluatePredicate, resolveTarget } from './evaluate'
import type { RevertsStore } from './reverts'
import type { PendingRevert } from './runner'
import { automationsPathFor, createAutomationsFile, type AutomationsStore } from './store'

const HOUSE = resolve(import.meta.dirname, '../../../../../house/demo-house.json')
// Origin of the demo house, and the mock scenario's "work" (1.4 km)
const HOME = { lat: 47.309343, lon: 5.045591, at: 0 }
const WORK = { lat: 47.3216, lon: 5.0415, at: 0 }

const d = (externalId: string, kind: DeviceDescriptor['kind'], capabilities: DeviceDescriptor['capabilities'], meta: DeviceDescriptor['meta'] = {}): DeviceDescriptor =>
  ({ id: `mock:${externalId}`, pluginId: 'mock', externalId, kind, name: externalId, capabilities, meta })

// Ids of the demo house: each one's room comes from the file (salon, cuisine…).
const DEVICES = [
  d('light-living', 'light', ['on_off']),
  d('light-kitchen', 'light', ['on_off']),
  d('light-bedroom1', 'light', ['on_off']),
  d('speaker-living', 'media_player', ['playback'], { mediaPlayer: { deviceClass: 'tv' } }),
  d('speaker-kitchen', 'media_player', ['playback']),
  d('cover-living', 'cover', ['open_close'], { cover: { deviceClass: 'shutter' } }),
  d('cover-terrace', 'cover', ['open_close'], { cover: { deviceClass: 'awning' } }),
  d('vehicle-tesla', 'vehicle', ['location', 'soc']),
]

class MemoryStore implements AutomationsStore {
  saved: Automation[] = []
  constructor(private initial: Automation[] = []) {}
  async load() { return this.initial }
  async save(list: readonly Automation[]) { this.saved = [...list] }
}

class MemoryReverts implements RevertsStore {
  saved: PendingRevert[] | null = null
  constructor(private initial: PendingRevert[] = []) {}
  async load() { return this.initial }
  async save(list: readonly PendingRevert[]) { this.saved = [...list] }
}

let house: LoadedHouse
beforeEach(async () => { house = await loadHouse(HOUSE) })

function harness(initial: Automation[] = [], reverts = new MemoryReverts()) {
  const clock = new ManualClock(Date.UTC(2026, 8, 22, 10))
  const bus = new Bus()
  const logger = pino({ level: 'silent' })
  const registry = new DeviceRegistry(bus, clock)
  const scenes = new SceneRegistry(bus, clock)
  const executed: { id: string; cmd: Command }[] = []
  const host = {
    execute: vi.fn(async (id: string, cmd: Command) => { executed.push({ id, cmd }) }),
    recallScene: vi.fn(async () => undefined),
  }
  const store = new MemoryStore(initial)
  const engine = new AutomationEngine({ store, reverts, registry, scenes, host, house, bus, clock, logger })
  registry.register('mock', DEVICES)
  const patch = (externalId: string, p: Record<string, unknown>) => registry.applyPatch(`mock:${externalId}`, { available: true, ...p } as StatePatch)
  const flush = () => new Promise((r) => setTimeout(r, 0))
  return { clock, bus, registry, scenes, host, executed, store, reverts, engine, patch, flush }
}

const body = (over: Partial<AutomationBody> = {}): AutomationBody => ({
  name: 'Test', enabled: true, unless: [],
  trigger: { type: 'time', at: { kind: 'clock', time: '12:00' } },
  actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:light-living'] }, command: { type: 'light.set', on: true } }],
  ...over,
})

describe('evaluate', () => {
  it('is unknown until a device has published, then compares its field', () => {
    const h = harness()
    const view = new HouseView(house, h.registry)
    const fresh = new Set<string>()
    const ctx = () => view.context(h.clock.now(), (id) => fresh.has(id))
    const on = { type: 'device', deviceId: 'mock:light-living', field: 'on', op: 'eq', value: true } as const
    expect(evaluatePredicate(on, ctx())).toBeNull()                 // default state: unknown
    h.patch('light-living', { on: true }); fresh.add('mock:light-living')
    expect(evaluatePredicate(on, ctx())).toBe(true)
    expect(evaluatePredicate({ ...on, not: true }, ctx())).toBe(false)
    expect(evaluatePredicate({ ...on, field: 'nope' }, ctx())).toBeNull()
    expect(evaluatePredicate({ ...on, deviceId: 'mock:ghost' }, ctx())).toBeNull()
  })

  it('knows a vehicle is home within the radius, and which room holds an active device', () => {
    const h = harness()
    const view = new HouseView(house, h.registry)
    const ctx = () => view.context(h.clock.now(), () => true)
    h.patch('vehicle-tesla', { location: HOME })
    expect(evaluatePredicate({ type: 'vehicleOnSite', deviceId: 'mock:vehicle-tesla' }, ctx())).toBe(true)
    h.patch('vehicle-tesla', { location: WORK })
    expect(evaluatePredicate({ type: 'vehicleOnSite', deviceId: 'mock:vehicle-tesla' }, ctx())).toBe(false)

    h.patch('speaker-living', { playback: 'playing', volume: 20, muted: false })
    h.patch('speaker-kitchen', { playback: 'off', volume: 20, muted: false })
    expect(evaluatePredicate({ type: 'anyInRoom', roomId: 'salon', kind: 'media_player', deviceClass: 'tv' }, ctx())).toBe(true)
    expect(evaluatePredicate({ type: 'anyInRoom', roomId: 'cuisine', kind: 'media_player' }, ctx())).toBe(false)
    expect(evaluatePredicate({ type: 'anyInRoom', roomId: 'nulle-part', kind: 'light' }, ctx())).toBeNull()
  })

  it('handles one level of OR and time windows across midnight', () => {
    const h = harness()
    const ctx = new HouseView(house, h.registry).context(new Date(2026, 8, 22, 23, 30).getTime(), () => true)
    expect(evaluatePredicate({ type: 'timeWindow', from: '23:00', to: '06:00' }, ctx)).toBe(true)
    expect(evaluatePredicate({ type: 'timeWindow', from: '08:00', to: '20:00' }, ctx)).toBe(false)
    expect(evaluatePredicate({ type: 'any', of: [{ type: 'timeWindow', from: '08:00', to: '20:00' }, { type: 'days', days: [2] }] }, ctx)).toBe(true)
  })

  it('selects all lights except the rooms where the TV is on', () => {
    const h = harness()
    const ctx = () => new HouseView(house, h.registry).context(h.clock.now(), () => true)
    for (const id of ['light-living', 'light-kitchen', 'light-bedroom1']) h.patch(id, { on: true })
    h.patch('speaker-living', { playback: 'on', volume: 20, muted: false })   // TV on screen in the living room
    const { entries } = resolveTarget({ type: 'selector', kind: 'light', exceptRoomsWith: { kind: 'media_player', deviceClass: 'tv' } }, ctx())
    expect(entries.map((e) => e.descriptor.id).sort()).toEqual(['mock:light-bedroom1', 'mock:light-kitchen'])
    const rdc = resolveTarget({ type: 'selector', kind: 'light', levelIds: ['rdc'] }, ctx())
    expect(rdc.entries.map((e) => e.descriptor.id).sort()).toEqual(['mock:light-kitchen', 'mock:light-living'])
  })
})

describe('AutomationEngine — time', () => {
  it('fires at HH:MM, then arms the next day', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.upsert('noon', body())
    const next = h.engine.get('noon')!.status.nextRunAt!
    expect(new Date(next).getHours()).toBe(12)
    h.clock.advance(next - h.clock.now())
    await h.flush()
    expect(h.executed).toEqual([{ id: 'mock:light-living', cmd: { type: 'light.set', on: true } }])
    expect(h.engine.get('noon')!.status.lastRun).toMatchObject({ by: 'time', outcome: 'ok' })
    expect(h.engine.get('noon')!.status.nextRunAt).toBe(next + 24 * 3600_000)
  })

  it('never fires a disabled rule, and skips when an exception holds', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.upsert('off', body({ enabled: false }))
    expect(h.engine.get('off')!.status.nextRunAt).toBeUndefined()
    h.patch('speaker-kitchen', { playback: 'playing', volume: 10, muted: false })
    await h.engine.upsert('blocked', body({ unless: [{ type: 'anyInRoom', roomId: 'cuisine', kind: 'media_player' }] }))
    h.clock.advance(24 * 3600_000)
    await h.flush()
    expect(h.executed).toEqual([])
    expect(h.engine.get('blocked')!.status.lastRun?.outcome).toBe('skipped')
  })
})

describe('AutomationEngine — state', () => {
  const onArrival = body({
    trigger: { type: 'state', when: { type: 'vehicleOnSite', deviceId: 'mock:vehicle-tesla' } },
    actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:cover-living'] }, command: { type: 'cover.open' } }],
  })

  it('fires on a false → true edge only, never on the first report', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.upsert('arrive', onArrival)
    h.patch('vehicle-tesla', { location: HOME })            // first reading: already at home, not an edge
    await h.flush()
    expect(h.executed).toEqual([])
    h.patch('vehicle-tesla', { location: WORK })
    h.patch('vehicle-tesla', { location: HOME })            // it comes home
    await h.flush()
    expect(h.executed).toEqual([{ id: 'mock:cover-living', cmd: { type: 'cover.open' } }])
    h.patch('vehicle-tesla', { location: { ...HOME, at: 5 } }) // still at home: no new edge
    await h.flush()
    expect(h.executed).toHaveLength(1)
  })

  it('does not fire when a device comes back from unavailable', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.upsert('arrive', onArrival)
    h.patch('vehicle-tesla', { location: WORK })
    h.registry.setAvailable('mock', 'vehicle-tesla', false)
    h.patch('vehicle-tesla', { location: HOME })            // becomes available again, already home
    await h.flush()
    expect(h.executed).toEqual([])
  })

  it('waits forMin and cancels when the predicate drops', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.upsert('hold', { ...onArrival, trigger: { type: 'state', when: { type: 'deviceOn', deviceId: 'mock:light-kitchen' }, forMin: 10 } })
    h.patch('light-kitchen', { on: false })
    h.patch('light-kitchen', { on: true })
    expect(h.engine.get('hold')!.status.pendingSince).toBe(h.clock.now())
    h.clock.advance(5 * 60_000)
    h.patch('light-kitchen', { on: false })                 // drops before the 10 min
    h.clock.advance(10 * 60_000)
    await h.flush()
    expect(h.executed).toEqual([])
    h.patch('light-kitchen', { on: true })
    h.clock.advance(10 * 60_000)
    await h.flush()
    expect(h.executed).toHaveLength(1)
  })
})

describe('AutomationEngine — status and actions', () => {
  it('marks a rule incomplete while a device is missing, and ok when it comes back', async () => {
    const h = harness()
    await h.engine.start()
    await h.engine.upsert('r', body())
    h.patch('light-living', { on: false })
    expect(h.engine.get('r')!.status.health).toBe('ok')
    h.registry.register('mock', DEVICES.filter((x) => x.externalId !== 'light-living'))  // plugin without that light
    expect(h.engine.get('r')!.status).toMatchObject({ health: 'incomplete', missing: [{ kind: 'device', id: 'mock:light-living' }] })
    h.registry.register('mock', DEVICES)
    h.registry.setAvailable('mock', 'light-living', false)
    expect(h.engine.get('r')!.status.health).toBe('unavailable')
  })

  it('reports a partial run: one plugin error, one unknown device, one command the device refuses', async () => {
    const h = harness()
    h.host.execute.mockImplementation(async (id: string) => { if (id === 'mock:light-kitchen') throw new PluginError('TIMEOUT', 'too slow') })
    await h.engine.start()
    await h.engine.upsert('p', body({
      actions: [
        { type: 'command', target: { type: 'devices', deviceIds: ['mock:light-living', 'mock:light-kitchen', 'mock:ghost'] }, command: { type: 'light.set', on: false } },
        { type: 'command', target: { type: 'devices', deviceIds: ['mock:cover-living'] }, command: { type: 'light.set', on: false } },
      ],
    }))
    const run = await h.engine.runNow('p')
    expect(run?.outcome).toBe('partial')
    expect(run?.errors.map((e) => e.code).sort()).toEqual(['DEVICE_UNKNOWN', 'KIND_MISMATCH', 'TIMEOUT'])
  })

  it('persists writes and tells listeners', async () => {
    const h = harness()
    await h.engine.start()
    const cb = vi.fn()
    h.engine.onChange(cb)
    await h.engine.upsert('a', body())
    await h.engine.setEnabled('a', false)
    expect(h.store.saved[0]).toMatchObject({ id: 'a', enabled: false })
    expect(await h.engine.remove('a')).toBe(true)
    expect(h.store.saved).toEqual([])
    expect(cb).toHaveBeenCalled()
  })
})

describe('AutomationEngine — for N minutes', () => {
  const gate = (forMin = 20) => body({
    actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:cover-living', 'mock:ghost'] }, command: { type: 'cover.open' }, forMin }],
  })
  const closes = (h: ReturnType<typeof harness>) => h.executed.filter((x) => x.cmd.type === 'cover.close')

  it('sends the inverse command after forMin, to the devices that acknowledged', async () => {
    const h = harness()
    await h.engine.start()
    h.patch('cover-living', { position: 0 })
    await h.engine.upsert('g', gate())
    await h.engine.runNow('g')
    expect(h.reverts.saved).toMatchObject([{ automationId: 'g', action: 0, deviceId: 'mock:cover-living', command: { type: 'cover.close' } }])
    h.clock.advance(19 * 60_000)
    expect(closes(h)).toEqual([])
    h.clock.advance(60_000)
    await h.flush()
    expect(closes(h)).toEqual([{ id: 'mock:cover-living', cmd: { type: 'cover.close' } }])
    expect(h.reverts.saved).toEqual([])
  })

  it('restarts the wait when the rule runs again', async () => {
    const h = harness()
    await h.engine.start()
    h.patch('cover-living', { position: 0 })
    await h.engine.upsert('g', gate())
    await h.engine.runNow('g')
    h.clock.advance(10 * 60_000)
    await h.engine.runNow('g')
    h.clock.advance(15 * 60_000)
    await h.flush()
    expect(closes(h)).toEqual([])
    h.clock.advance(5 * 60_000)
    await h.flush()
    expect(closes(h)).toHaveLength(1)
  })

  it('catches up a revert left by a restart, once its device has reported', async () => {
    const now = Date.UTC(2026, 8, 22, 10)
    const h = harness([], new MemoryReverts([{ automationId: 'gone', action: 0, deviceId: 'mock:cover-living', command: { type: 'cover.close' }, dueAt: now - 60_000 }]))
    await h.engine.start()
    await h.flush()
    expect(closes(h)).toEqual([])                           // not read yet: default values
    h.patch('cover-living', { position: 100 })
    await h.flush()
    expect(closes(h)).toHaveLength(1)
    expect(h.reverts.saved).toEqual([])
  })

  it('plans nothing for a command without an obvious inverse', async () => {
    const h = harness()
    await h.engine.start()
    h.patch('cover-living', { position: 0 })
    await h.engine.upsert('p', body({ actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:cover-living'] }, command: { type: 'cover.set_position', position: 40 }, forMin: 5 }] }))
    await h.engine.runNow('p')
    expect(h.reverts.saved).toBeNull()
  })
})

describe('AutomationEngine — order', () => {
  it('reorders the list and the file, unknown ids ignored, unlisted ones kept after', async () => {
    const h = harness()
    await h.engine.start()
    for (const id of ['a', 'b', 'c']) await h.engine.upsert(id, body())
    const list = await h.engine.reorder(['c', 'ghost', 'a'])
    expect(list.map((e) => e.automation.id)).toEqual(['c', 'a', 'b'])
    expect(h.store.saved.map((a) => a.id)).toEqual(['c', 'a', 'b'])
    await h.engine.upsert('a', body({ name: 'Renommée' }))  // rewriting does not move it
    expect(h.engine.list().map((e) => e.automation.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('automations file', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kasbah-auto-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('lives next to its house, round-trips, and keeps a backup', async () => {
    const path = automationsPathFor(join(dir, 'maison.json'))
    expect(path).toBe(join(dir, 'maison.automations.json'))
    const store = createAutomationsFile(path)
    expect(await store.load()).toEqual([])
    const a: Automation = { id: 'x', ...body() } as Automation
    await store.save([a])
    await store.save([{ ...a, name: 'Deux' }])
    expect((await store.load())[0]?.name).toBe('Deux')
    expect(JSON.parse(await readFile(`${path}.bak`, 'utf8')).automations[0].name).toBe('Test')
    await expect(stat(`${path}.tmp`)).rejects.toThrow()
  })

  it('refuses to start on an unreadable file rather than overwrite it', async () => {
    const path = join(dir, 'maison.automations.json')
    await writeFile(path, JSON.stringify({ schemaVersion: 1, automations: [{ id: 'x' }] }))
    await expect(createAutomationsFile(path).load()).rejects.toThrow(/invalide/)
  })
})
