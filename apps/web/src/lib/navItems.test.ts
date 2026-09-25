import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, visibleNavItems } from './navItems'

describe('visibleNavItems', () => {
  it('hides a local plugin page until it is enabled on this device', () => {
    expect(visibleNavItems(() => false).map((i) => i.name)).not.toContain('tens')
    expect(visibleNavItems((id) => id === 'tens').map((i) => i.name)).toContain('tens')
  })

  it('keeps every house page whatever the local plugins', () => {
    const house = NAV_ITEMS.filter((i) => !i.local).map((i) => i.name)
    expect(visibleNavItems(() => false).map((i) => i.name)).toEqual(house)
  })
})
