import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../../api'
import type { AssistantLogEntry, Transport } from '../../api/transport'
import AssistantCard from './AssistantCard.vue'

// The instruction log is only shown on the local network (no session):
// connected through the public address, it is not even requested.

const entry: AssistantLogEntry = {
  at: Date.UTC(2026, 9, 7, 9, 0), user: 'lou', text: 'Allume le salon', ms: 6800,
  tools: [{ id: 't1', name: 'send_command', input: { deviceId: 'mock:light-living' }, ok: true }],
  answer: 'Le plafonnier du salon est allumé.', error: null,
  usage: { costUsd: 0.0031, inputTokens: 12, outputTokens: 40, cacheReadTokens: 9000, cacheWriteTokens: 1500 },
}

function fake(user: string | null) {
  const assistantLog = vi.fn(async () => ({ entries: [entry, { ...entry, at: entry.at - 1, usage: { ...entry.usage!, costUsd: 0.0124 } }, { ...entry, at: entry.at - 2, user: null, text: 'Éteins tout', tools: [], answer: '', error: { code: 'TIMEOUT', message: 'x' }, usage: undefined }] }))
  setTransport({ session: async () => ({ user }), assistantLog } as unknown as Transport)
  return assistantLog
}

describe('AssistantCard — journal', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('shows the instructions of all accounts on the local network, once the log is unfolded', async () => {
    fake(null)
    const w = mount(AssistantCard)
    await flushPromises()
    expect(w.find('.ac__entries').exists()).toBe(false)
    await w.find('.ac__toggle').trigger('click')
    const entries = w.findAll('.ac__entry')
    expect(entries).toHaveLength(3)
    expect(entries[0]!.find('.ac__meta').text()).toContain('lou')
    expect(entries[0]!.find('.reply__answer').text()).toBe('Le plafonnier du salon est allumé.')
    expect(entries[2]!.find('.ac__meta').text()).toContain('la maison')
    expect(entries[2]!.find('.reply__error').text()).toBe('Pas de réponse en 60 secondes.')
  })

  it('states the cost of each instruction (tokens on hover) and the total of the priced instructions', async () => {
    fake(null)
    const w = mount(AssistantCard)
    await flushPromises()
    // the total is read with the log folded
    expect(w.find('.ac__total').text()).toBe('Total ≈ 0,016 $ pour 2 instructions, au prix de l’API : le forfait ne facture rien à l’instruction.')
    await w.find('.ac__toggle').trigger('click')
    const entries = w.findAll('.ac__entry')
    const cost = entries[0]!.find('.ac__cost')
    expect(cost.text()).toBe('· ≈ 0,0031 $')
    expect(cost.attributes('title')).toContain('9')
    expect(cost.attributes('title')).toContain('écrits en cache')
    // an entry without a cost (silent engine, earlier log) shows none and does not count
    expect(entries[2]!.find('.ac__cost').exists()).toBe(false)
  })

  it('with no priced instruction, no total', async () => {
    setTransport({ session: async () => ({ user: null }), assistantLog: async () => ({ entries: [{ ...entry, usage: undefined }] }) } as unknown as Transport)
    const w = mount(AssistantCard)
    await flushPromises()
    expect(w.find('.ac__total').exists()).toBe(false)
  })

  it('does not request it for an account connected through the public address', async () => {
    const assistantLog = fake('lou')
    const w = mount(AssistantCard)
    await flushPromises()
    expect(assistantLog).not.toHaveBeenCalled()
    expect(w.find('.ac').exists()).toBe(false)
  })
})
