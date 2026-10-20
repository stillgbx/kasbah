import { computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import {
  addShoppingItems, clearCheckedShoppingItems, EMPTY_SHOPPING_LIST, pluginSettingsOf, removeShoppingItem, setShoppingFavorite, shoppingKey,
  updateShoppingItem, type ServerMessage, type ShoppingItemPatch, type ShoppingList, type ShoppingProduct,
} from '@kasbah/shared'
import { getTransport } from '../api'
import { t } from '../i18n'
import { useHouseStore } from './house'
import { useNotificationsStore } from './notifications'

// The house's shopping list, a mirror of the server: REPLACED on each message (`snapshot`,
// `shopping`). Each gesture is OPTIMISTIC — one ticks off at the shop, the row must be struck
// through under the finger, not after the round trip — through the same pure operations as the server; a refusal puts
// the previous list back, if nothing else changed it in the meantime.

/** Suggestions of the search, at most. */
export const SHOPPING_SUGGESTIONS = 8

export const useShoppingStore = defineStore('shopping', () => {
  const list = shallowRef<ShoppingList>(EMPTY_SHOPPING_LIST)
  /** Turned off in Settings → Plugins (the house's `plugins.shopping`); on as long as it says nothing. */
  const house = useHouseStore()
  const enabled = computed(() => pluginSettingsOf(house.house?.plugins ?? {}, 'shopping').enabled)

  function apply(msg: ServerMessage) {
    if ((msg.type === 'snapshot' || msg.type === 'shopping') && msg.shopping) list.value = msg.shopping
  }

  const items = computed(() => list.value.items)
  const checkedCount = computed(() => list.value.items.filter((i) => i.checked).length)
  /** The usual ones, by name: a FIXED order, a tile does not change place when touched. */
  const favorites = computed(() => list.value.products.filter((p) => p.favorite).sort((a, b) => a.name.localeCompare(b.name)))
  const favoriteIds = computed(() => new Set(favorites.value.map((p) => p.id)))
  /** Products to buy (not ticked): a usual tile grays out there. */
  const toBuyIds = computed(() => new Set(list.value.items.filter((i) => !i.checked).map((i) => i.id)))

  const isFavorite = (name: string) => favoriteIds.value.has(shoppingKey(name))
  const isToBuy = (name: string) => toBuyIds.value.has(shoppingKey(name))

  /**
   * Known products that contain the input (case- and accent-insensitive): start of name first, then
   * usual ones, then the most often bought.
   */
  function suggest(query: string): ShoppingProduct[] {
    const q = shoppingKey(query)
    if (!q) return []
    const rank = (p: ShoppingProduct) => (p.id.startsWith(q) ? 0 : 2) + (p.favorite ? 0 : 1)
    return list.value.products
      .filter((p) => p.id.includes(q))
      .sort((a, b) => rank(a) - rank(b) || b.uses - a.uses || a.name.localeCompare(b.name))
      .slice(0, SHOPPING_SUGGESTIONS)
  }

  async function run(optimistic: ShoppingList | null, call: () => Promise<ShoppingList>): Promise<boolean> {
    const before = list.value
    if (optimistic) list.value = optimistic
    try {
      list.value = await call()
      return true
    } catch (err) {
      if (optimistic && list.value === optimistic) list.value = before
      useNotificationsStore().error(t('shopping.toast.error', { message: (err as Error).message }))
      return false
    }
  }

  const now = () => Date.now()
  const add = (name: string, quantity?: number) => {
    const input = { name, ...(quantity ? { quantity } : {}) }
    return run(addShoppingItems(list.value, [input], now()), () => getTransport().addShoppingItems([input]))
  }
  const update = (id: string, patch: ShoppingItemPatch) =>
    run(updateShoppingItem(list.value, id, patch), () => getTransport().updateShoppingItem(id, patch))
  const remove = (id: string) => run(removeShoppingItem(list.value, id), () => getTransport().removeShoppingItem(id))
  const finish = () => run(clearCheckedShoppingItems(list.value), () => getTransport().finishShopping())
  const setFavorite = (name: string, favorite: boolean) =>
    run(setShoppingFavorite(list.value, name, favorite, now()), () => getTransport().setShoppingFavorite(name, favorite))

  /** Rereads the list (first opening of the view, before any message). */
  async function load(): Promise<void> {
    try { list.value = await getTransport().getShopping() }
    catch (err) { useNotificationsStore().error(t('shopping.toast.error', { message: (err as Error).message })) }
  }

  return { list, enabled, items, checkedCount, favorites, isFavorite, isToBuy, suggest, apply, load, add, update, remove, finish, setFavorite }
})
