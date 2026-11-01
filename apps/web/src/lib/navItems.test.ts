import { describe, expect, it } from 'vitest'
import { RIGHTS, type Right } from '@kasbah/shared'
import { NAV_ITEMS, navItemOf, orderNavItems, visibleNavItems } from './navItems'

describe('visibleNavItems', () => {
  it('hides a local plugin page until it is enabled on this device', () => {
    expect(visibleNavItems(() => false).map((i) => i.name)).not.toContain('tens')
    expect(visibleNavItems((id) => id === 'tens').map((i) => i.name)).toContain('tens')
  })

  it('keeps every house page whatever the local plugins', () => {
    const house = NAV_ITEMS.filter((i) => !i.local).map((i) => i.name)
    expect(visibleNavItems(() => false).map((i) => i.name)).toEqual(house)
  })

  it('hides a feature turned off in the house settings', () => {
    expect(visibleNavItems(() => false, (id) => id !== 'shopping').map((i) => i.name)).not.toContain('shopping')
    expect(visibleNavItems(() => false).map((i) => i.name)).toContain('shopping')
  })

  it("keeps only the views the account's rights open, House and Settings always", () => {
    const names = (rights?: Right[]) => visibleNavItems(() => false, () => true, rights).map((i) => i.name)
    expect(names(['lights', 'weather'])).toEqual(['home', 'lights', 'weather', 'settings'])
    // the gate and the garage door live in the covers view
    expect(names(['access'])).toEqual(['home', 'covers', 'settings'])
    expect(names([])).toEqual(['home', 'settings'])
    expect(names()).toEqual(names([...RIGHTS]))
  })
})

describe('navItemOf', () => {
  it('finds the view of a sub-page through meta.nav', () => {
    expect(navItemOf({ name: 'automation-edit', meta: { nav: 'automations' } })?.rights).toEqual(['automations'])
    expect(navItemOf({ name: 'ask', meta: {} })).toBeUndefined()
  })
})

describe('orderNavItems', () => {
  const names = (order: string[]) => orderNavItems(NAV_ITEMS, order).map((i) => i.name)

  it('keeps the default order when nothing was chosen', () => {
    expect(names([])).toEqual(NAV_ITEMS.map((i) => i.name))
  })

  it('follows the chosen order, House first and Settings last whatever it says', () => {
    const order = names([]).filter((n) => n !== 'home' && n !== 'settings').reverse()
    expect(names(['settings', ...order, 'home'])).toEqual(['home', ...order, 'settings'])
  })

  it('puts a view the order does not name after the named ones, in the default order', () => {
    const got = names(['music', 'lights'])
    expect(got.slice(0, 3)).toEqual(['home', 'music', 'lights'])
    expect(got.slice(3, 5)).toEqual(['covers', 'weather'])
    expect(got.at(-1)).toBe('settings')
  })
})
