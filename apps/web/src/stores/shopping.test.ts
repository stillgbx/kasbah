import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { addShoppingItems, EMPTY_SHOPPING_LIST, setShoppingFavorite } from '@kasbah/shared'
import { ApiRequestError, createMockTransport, setTransport, type Transport } from '../api'
import { useNotificationsStore } from './notifications'
import { useShoppingStore } from './shopping'

function withTransport(over: Partial<Transport> = {}) {
  setTransport({ ...createMockTransport({ seed: 1 }), ...over })
}

describe('shopping store', () => {
  beforeEach(() => { setActivePinia(createPinia()); setTransport(null); localStorage.clear() })

  it('follows snapshot and shopping messages, and keeps its list on a snapshot without one', () => {
    const store = useShoppingStore()
    const list = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }], 0)
    store.apply({ type: 'snapshot', serverTime: 0, devices: [], scenes: [], automations: [], shopping: list })
    expect(store.items.map((i) => i.id)).toEqual(['lait'])
    store.apply({ type: 'snapshot', serverTime: 0, devices: [], scenes: [], automations: [] })
    expect(store.items.map((i) => i.id)).toEqual(['lait'])
    store.apply({ type: 'shopping', shopping: EMPTY_SHOPPING_LIST })
    expect(store.items).toEqual([])
  })

  it('checks optimistically, before the server answers', async () => {
    let answer!: () => void
    withTransport({ updateShoppingItem: () => new Promise((resolve) => { answer = () => resolve(EMPTY_SHOPPING_LIST) }) })
    const store = useShoppingStore()
    store.apply({ type: 'shopping', shopping: addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }], 0) })
    const done = store.update('lait', { checked: true })
    expect(store.items[0]!.checked).toBe(true)
    answer()
    expect(await done).toBe(true)
  })

  it('puts the list back and says so when the server refuses', async () => {
    withTransport({ removeShoppingItem: async () => { throw new ApiRequestError(500, 'INTERNAL', 'disk full') } })
    const store = useShoppingStore()
    store.apply({ type: 'shopping', shopping: addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }], 0) })
    expect(await store.remove('lait')).toBe(false)
    expect(store.items.map((i) => i.id)).toEqual(['lait'])
    expect(useNotificationsStore().queue.at(-1)?.text).toContain('disk full')
  })

  it('suggests known products, name start and usuals first', () => {
    const store = useShoppingStore()
    let l = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait de coco' }, { name: 'Pain au lait' }, { name: 'Lait' }, { name: 'Pain au lait' }], 0)
    l = setShoppingFavorite(l, 'Lait', true, 0)
    store.apply({ type: 'shopping', shopping: l })
    expect(store.suggest('LAI').map((p) => p.name)).toEqual(['Lait', 'Lait de coco', 'Pain au lait'])
    expect(store.suggest('  ')).toEqual([])
    expect(store.isToBuy('lait')).toBe(true)
    expect(store.isFavorite('LAIT')).toBe(true)
  })

  it('works end to end on the mock transport', async () => {
    withTransport()
    const store = useShoppingStore()
    await store.load()
    await store.add('Riz')
    expect(store.items.at(-1)).toMatchObject({ name: 'Riz', quantity: 1, checked: false })
  })
})
