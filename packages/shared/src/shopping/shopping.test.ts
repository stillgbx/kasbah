import { describe, expect, it } from 'vitest'
import {
  addShoppingItems, clearCheckedShoppingItems, EMPTY_SHOPPING_LIST, findShoppingItem, removeShoppingItem,
  setShoppingFavorite, shoppingFileSchema, shoppingItemPatchSchema, shoppingKey, updateShoppingItem,
} from './shopping'
import { pluginSettingsOf } from '../house/schema'

describe('shoppingKey', () => {
  it('ignores case, accents and repeated spaces', () => {
    expect(shoppingKey('  Crème   Fraîche ')).toBe('creme fraiche')
  })
})

describe('addShoppingItems', () => {
  it('adds new products in order and remembers them', () => {
    const l = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }, { name: 'Œufs', quantity: 2 }], 10)
    expect(l.items.map((i) => [i.id, i.name, i.quantity, i.checked])).toEqual([['lait', 'Lait', 1, false], ['œufs', 'Œufs', 2, false]])
    expect(l.products.map((p) => [p.id, p.uses, p.favorite])).toEqual([['lait', 1, false], ['œufs', 1, false]])
  })

  it('increments a product still to buy, keeping its name and place', () => {
    let l = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }, { name: 'Pain' }], 10)
    l = addShoppingItems(l, [{ name: 'lait', quantity: 2 }], 20)
    expect(l.items.map((i) => [i.name, i.quantity, i.addedAt])).toEqual([['Lait', 3, 10], ['Pain', 1, 10]])
    expect(l.products[0]).toMatchObject({ name: 'Lait', uses: 2, lastUsedAt: 20 })
  })

  it('puts a checked product back to buy at its place, with the asked quantity', () => {
    let l = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait', quantity: 4 }, { name: 'Pain' }], 10)
    l = updateShoppingItem(l, 'lait', { checked: true })!
    l = addShoppingItems(l, [{ name: 'Lait' }], 20)
    expect(l.items[0]).toMatchObject({ id: 'lait', checked: false, quantity: 1 })
  })

  it('caps the quantity', () => {
    const l = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Eau', quantity: 98 }, { name: 'eau', quantity: 5 }], 10)
    expect(l.items[0]!.quantity).toBe(99)
  })

  it('does not mutate the input list', () => {
    const before = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }], 10)
    const copy = JSON.parse(JSON.stringify(before)) as typeof before
    addShoppingItems(before, [{ name: 'Lait' }, { name: 'Pain' }], 20)
    expect(before).toEqual(copy)
  })
})

describe('update, remove, clear', () => {
  const base = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }, { name: 'Pain' }, { name: 'Café' }], 10)

  it('checks a line without moving it', () => {
    const l = updateShoppingItem(base, 'pain', { checked: true })!
    expect(l.items.map((i) => [i.id, i.checked])).toEqual([['lait', false], ['pain', true], ['cafe', false]])
  })

  it('returns null for an unknown line', () => {
    expect(updateShoppingItem(base, 'riz', { checked: true })).toBeNull()
    expect(removeShoppingItem(base, 'riz')).toBeNull()
  })

  it('removes a line but keeps the product in memory', () => {
    const l = removeShoppingItem(base, 'pain')!
    expect(l.items.map((i) => i.id)).toEqual(['lait', 'cafe'])
    expect(l.products.map((p) => p.id)).toContain('pain')
  })

  it('finishing the shopping drops only the checked lines', () => {
    const l = clearCheckedShoppingItems(updateShoppingItem(base, 'lait', { checked: true })!)
    expect(l.items.map((i) => i.id)).toEqual(['pain', 'cafe'])
  })

  it('finds a line by id or by spoken name', () => {
    expect(findShoppingItem(base, 'cafe')?.name).toBe('Café')
    expect(findShoppingItem(base, 'CAFÉ')?.name).toBe('Café')
    expect(findShoppingItem(base, 'thé')).toBeUndefined()
  })

  it('refuses an empty patch', () => {
    expect(shoppingItemPatchSchema.safeParse({}).success).toBe(false)
  })
})

describe('setShoppingFavorite', () => {
  it('stars a known product and creates an unknown one without usage', () => {
    let l = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }], 10)
    l = setShoppingFavorite(l, 'LAIT', true, 20)
    l = setShoppingFavorite(l, 'Beurre', true, 20)
    expect(l.products.map((p) => [p.name, p.favorite, p.uses])).toEqual([['Lait', true, 1], ['Beurre', true, 0]])
    expect(l.items.map((i) => i.id)).toEqual(['lait'])
  })
})

describe('shoppingFileSchema', () => {
  it('round-trips a list', () => {
    const l = addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait' }], 10)
    expect(shoppingFileSchema.parse({ schemaVersion: 1, ...l })).toEqual({ schemaVersion: 1, ...l })
  })
})

describe('pluginSettingsOf', () => {
  it('turns the shopping list on until the house says otherwise, vendors off', () => {
    expect(pluginSettingsOf({}, 'shopping').enabled).toBe(true)
    expect(pluginSettingsOf({}, 'hue').enabled).toBe(false)
    expect(pluginSettingsOf({ shopping: { enabled: false, parts: {}, autoDynamicForNewScenes: false } }, 'shopping').enabled).toBe(false)
  })
})
