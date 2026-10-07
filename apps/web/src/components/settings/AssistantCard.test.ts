import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../../api'
import type { AssistantLogEntry, Transport } from '../../api/transport'
import AssistantCard from './AssistantCard.vue'

// Le journal des instructions ne se montre que sur le réseau local (pas de session) :
// connecté par l'adresse publique, on ne le demande même pas.

const entry: AssistantLogEntry = {
  at: Date.UTC(2026, 9, 7, 9, 0), user: 'lou', text: 'Allume le salon', ms: 6800,
  tools: [{ id: 't1', name: 'send_command', input: { deviceId: 'mock:light-living' }, ok: true }],
  answer: 'Le plafonnier du salon est allumé.', error: null,
}

function fake(user: string | null) {
  const assistantLog = vi.fn(async () => ({ entries: [entry, { ...entry, user: null, text: 'Éteins tout', tools: [], answer: '', error: { code: 'TIMEOUT', message: 'x' } }] }))
  setTransport({ session: async () => ({ user }), assistantLog } as unknown as Transport)
  return assistantLog
}

describe('AssistantCard — journal', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('montre les instructions de tous les comptes sur le réseau local', async () => {
    fake(null)
    const w = mount(AssistantCard)
    await flushPromises()
    const entries = w.findAll('.ac__entry')
    expect(entries).toHaveLength(2)
    expect(entries[0]!.find('.ac__meta').text()).toContain('lou')
    expect(entries[0]!.find('.reply__answer').text()).toBe('Le plafonnier du salon est allumé.')
    expect(entries[1]!.find('.ac__meta').text()).toContain('la maison')
    expect(entries[1]!.find('.reply__error').text()).toBe('Pas de réponse en 60 secondes.')
  })

  it('ne le demande pas à un compte connecté par l’adresse publique', async () => {
    const assistantLog = fake('lou')
    const w = mount(AssistantCard)
    await flushPromises()
    expect(assistantLog).not.toHaveBeenCalled()
    expect(w.find('.ac').exists()).toBe(false)
  })
})
