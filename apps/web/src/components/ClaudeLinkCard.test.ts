import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../api'
import type { ClaudeAccount, Transport } from '../api/transport'
import ClaudeLinkCard from './ClaudeLinkCard.vue'

// La carte du plugin Claude : dire quel forfait sert (le sien, celui de la maison, la connexion du
// serveur) et ranger le jeton de `claude setup-token`, qui ne s'affiche jamais une fois envoyé.

function fake(account: ClaudeAccount) {
  const claudeSetToken = vi.fn(async () => ({ ...account, savedAt: Date.UTC(2026, 9, 7) }))
  setTransport({ claudeAccount: async () => account, claudeSetToken } as unknown as Transport)
  return claudeSetToken
}

describe('ClaudeLinkCard', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('dit le repli d’un compte sans jeton : la maison si elle en a un', async () => {
    fake({ user: 'lou', savedAt: null, house: true })
    const w = mount(ClaudeLinkCard)
    await flushPromises()
    expect(w.find('.cl__status').text()).toBe('Aucun jeton pour lou. Le forfait de la maison sert en attendant.')
  })

  it('envoie un jeton bien formé, puis vide le champ', async () => {
    const claudeSetToken = fake({ user: null, savedAt: null, house: false })
    const w = mount(ClaudeLinkCard)
    await flushPromises()
    const input = w.find('input')
    await input.setValue('pas un jeton')
    expect(w.find('button[type=submit]').attributes('disabled')).toBeDefined()
    await input.setValue('sk-ant-oat01-abcdefghijklmnopqrstuvwxyz')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(claudeSetToken).toHaveBeenCalledWith('sk-ant-oat01-abcdefghijklmnopqrstuvwxyz')
    expect((input.element as HTMLInputElement).value).toBe('')
    expect(w.find('.cl__status').text()).toContain('Jeton de la maison enregistré le')
  })
})
