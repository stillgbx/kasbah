import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setTransport } from '../../api'
import { ApiRequestError, type McpUser, type Transport } from '../../api/transport'
import { useNotificationsStore } from '../../stores/notifications'
import McpUsersCard from './McpUsersCard.vue'

// The accounts are an admin's: the list, the roles, the rights and the form. Any other account only
// sees its session, and a way to close it.

function fake(session: { user: string | null; admin?: boolean }, users: McpUser[] = [{ name: 'root', admin: true }, { name: 'tablette' }]) {
  const mcpUsers = vi.fn(async () => ({ users }))
  const mcpSetRole = vi.fn(async (name: string, role: { admin?: boolean; house?: boolean }) => {
    if (role.admin === false && name === 'root') throw new ApiRequestError(409, 'LAST_ADMIN', 'last admin')
    return { users: users.map((u) => (u.name === name ? { ...u, ...(role.house ? { house: true as const } : {}) } : u)) }
  })
  setTransport({ session: async () => session, mcpUsers, mcpSetRole } as unknown as Transport)
  return { mcpUsers, mcpSetRole }
}

describe('McpUsersCard', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('shows an account that is not admin its session only, without asking for the list', async () => {
    const { mcpUsers } = fake({ user: 'lou' })
    const w = mount(McpUsersCard)
    await flushPromises()
    expect(mcpUsers).not.toHaveBeenCalled()
    expect(w.text()).toContain('Connecté en tant que lou')
    expect(w.find('.mu__user').exists()).toBe(false)
    expect(w.find('.mu__form').exists()).toBe(false)
  })

  it('gives an admin the accounts with their roles, and marks the house account', async () => {
    const { mcpSetRole } = fake({ user: 'root', admin: true })
    const w = mount(McpUsersCard)
    await flushPromises()
    expect(w.findAll('.mu__user')).toHaveLength(2)
    expect(w.findAll('.mu__summary')[0]!.text()).toBe('Super-utilisateur')
    await w.findAll('.mu__toggle')[1]!.trigger('click')
    const house = w.findAll('.mu__right').find((b) => b.text() === 'Compte de la maison')!
    await house.trigger('click')
    await flushPromises()
    expect(mcpSetRole).toHaveBeenCalledWith('tablette', { house: true })
    expect(w.findAll('.mu__summary')[1]!.text()).toBe('Compte de la maison · Tous les droits')
  })

  it("keeps an admin's rights lit and still, and says why the last admin stays", async () => {
    fake({ user: 'root', admin: true })
    const w = mount(McpUsersCard)
    await flushPromises()
    await w.findAll('.mu__toggle')[0]!.trigger('click')
    const pills = w.findAll('.mu__right')
    const rights = pills.filter((b) => !['Super-utilisateur', 'Compte de la maison'].includes(b.text()))
    expect(rights.every((b) => b.attributes('data-on') === '1' && b.attributes('disabled') !== undefined)).toBe(true)
    await pills.find((b) => b.text() === 'Super-utilisateur')!.trigger('click')
    await flushPromises()
    expect(useNotificationsStore().queue.map((n) => n.text)).toEqual(['Il faut garder au moins un super-utilisateur.'])
    expect(w.findAll('.mu__summary')[0]!.text()).toBe('Super-utilisateur')
  })
})
