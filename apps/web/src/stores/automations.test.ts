import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AutomationEntry } from '@kasbah/shared'
import { ApiRequestError, createMockTransport, setTransport, type Transport } from '../api'
import { useAutomationsStore } from './automations'
import { useNotificationsStore } from './notifications'

const entry = (id: string, name: string, enabled = true): AutomationEntry => ({
  automation: {
    id, name, enabled, unless: [],
    trigger: { type: 'time', at: { kind: 'clock', time: '07:30' } },
    actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:light-living'] }, command: { type: 'light.set', on: true } }],
  },
  status: { health: 'ok', missing: [], unavailableDeviceIds: [] },
})

function withTransport(over: Partial<Transport>) {
  setTransport({ ...createMockTransport({ seed: 1 }), ...over })
}

describe('automations store', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null); localStorage.clear() })

  it('replaces the map on snapshot and automations messages, in the server order', () => {
    const store = useAutomationsStore()
    store.apply({ type: 'snapshot', serverTime: 0, devices: [], scenes: [], automations: [entry('b', 'Volets'), entry('12', 'Arrosage')] })
    expect(store.list.map((e) => e.automation.name)).toEqual(['Volets', 'Arrosage'])   // « 12 » ne passe pas devant
    store.apply({ type: 'automations', automations: [entry('c', 'Portail')] })
    expect(store.list.map((e) => e.automation.id)).toEqual(['c'])
  })

  it('keeps the order when a rule is disabled (nothing jumps under the finger)', async () => {
    withTransport({ setAutomationEnabled: vi.fn(async (id: string, enabled: boolean) => ({ ...entry(id, id === 'a' ? 'Arrosage' : 'Volets'), automation: { ...entry(id, id === 'a' ? 'Arrosage' : 'Volets').automation, enabled } })) })
    const store = useAutomationsStore()
    store.apply({ type: 'automations', automations: [entry('a', 'Arrosage'), entry('b', 'Volets')] })
    await store.setEnabled('a', false)
    expect(store.list.map((e) => [e.automation.id, e.automation.enabled])).toEqual([['a', false], ['b', true]])
  })

  it('reorders at once, and puts the order back when the server refuses', async () => {
    withTransport({ setAutomationOrder: vi.fn(async () => { throw new ApiRequestError(500, 'INTERNAL', 'disk full') }) })
    const store = useAutomationsStore()
    store.apply({ type: 'automations', automations: [entry('a', 'Arrosage'), entry('b', 'Volets')] })
    const pending = store.reorder(['b', 'a'])
    expect(store.list.map((e) => e.automation.id)).toEqual(['b', 'a'])
    expect(await pending).toBe(false)
    expect(store.list.map((e) => e.automation.id)).toEqual(['a', 'b'])
  })

  it('rolls back an optimistic toggle the server refuses, and says so', async () => {
    withTransport({ setAutomationEnabled: vi.fn(async () => { throw new ApiRequestError(503, 'INTERNAL', 'boom') }) })
    const store = useAutomationsStore()
    store.apply({ type: 'automations', automations: [entry('a', 'Arrosage')] })
    const pending = store.setEnabled('a', false)
    expect(store.entries.a!.automation.enabled).toBe(false)            // tout de suite
    expect(await pending).toBe(false)
    expect(store.entries.a!.automation.enabled).toBe(true)              // rendu
    expect(useNotificationsStore().queue.length).toBeGreaterThan(0)
  })

  it('does not show a new rule before the server has accepted it', async () => {
    let release: (e: AutomationEntry) => void = () => {}
    withTransport({ putAutomation: vi.fn(() => new Promise<AutomationEntry>((r) => { release = r })) })
    const store = useAutomationsStore()
    const pending = store.save('n', { name: 'Nuit', enabled: true, unless: [], trigger: entry('n', 'Nuit').automation.trigger, actions: entry('n', 'Nuit').automation.actions })
    expect(store.saving).toBe(true)
    expect(store.entries.n).toBeUndefined()
    release(entry('n', 'Nuit'))
    expect((await pending)?.automation.id).toBe('n')
    expect(store.entries.n?.automation.name).toBe('Nuit')
    expect(store.saving).toBe(false)
  })

  it('puts a deleted rule back if the server refuses', async () => {
    withTransport({ deleteAutomation: vi.fn(async () => { throw new ApiRequestError(500, 'INTERNAL', 'disk full') }) })
    const store = useAutomationsStore()
    store.apply({ type: 'automations', automations: [entry('a', 'Arrosage')] })
    expect(await store.remove('a')).toBe(false)
    expect(store.entries.a).toBeDefined()
  })
})

describe('mock transport automations', () => {
  it('seeds demo rules, one of them incomplete, and pushes every write', async () => {
    const mock = createMockTransport({ seed: 1 })
    const pushed: string[][] = []
    mock.connect({ onMessage: (m) => { if (m.type === 'automations') pushed.push(m.automations.map((e) => e.automation.id)) }, onStatus: () => {} })
    const list = await mock.getAutomations()
    expect(list.find((e) => e.automation.id === 'veilleuse')?.status.health).toBe('incomplete')
    await mock.setAutomationEnabled('portail-midi', true)
    expect(pushed.at(-1)).toContain('portail-midi')
    const run = await mock.runAutomation('volets-crepuscule')
    expect(run.outcome).toBe('ok')
    expect((await mock.getAutomations()).find((e) => e.automation.id === 'volets-crepuscule')?.status.lastRun?.by).toBe('manual')
  })
})
