import { computed, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import {
  addShoppingItems, clearCheckedShoppingItems, EMPTY_SHOPPING_LIST, removeShoppingItem, setShoppingFavorite, shoppingKey,
  updateShoppingItem, type ServerMessage, type ShoppingItemPatch, type ShoppingList, type ShoppingProduct,
} from '@kasbah/shared'
import { getTransport } from '../api'
import { t } from '../i18n'
import { useNotificationsStore } from './notifications'

// Liste de courses de la maison, miroir du serveur : REMPLACÉE à chaque message (`snapshot`,
// `shopping`). Chaque geste est OPTIMISTE — on coche au magasin, la ligne doit se barrer sous le
// doigt, pas après l'aller-retour — par les mêmes opérations pures que le serveur ; un refus remet
// la liste d'avant, si rien d'autre ne l'a changée entre-temps.

/** Propositions de la recherche, au plus. */
export const SHOPPING_SUGGESTIONS = 8

export const useShoppingStore = defineStore('shopping', () => {
  const list = shallowRef<ShoppingList>(EMPTY_SHOPPING_LIST)

  function apply(msg: ServerMessage) {
    if ((msg.type === 'snapshot' || msg.type === 'shopping') && msg.shopping) list.value = msg.shopping
  }

  const items = computed(() => list.value.items)
  const checkedCount = computed(() => list.value.items.filter((i) => i.checked).length)
  /** Les habituels, par nom : un ordre FIXE, une tuile ne change pas de place quand on la touche. */
  const favorites = computed(() => list.value.products.filter((p) => p.favorite).sort((a, b) => a.name.localeCompare(b.name)))
  const favoriteIds = computed(() => new Set(favorites.value.map((p) => p.id)))
  /** Produits à acheter (non cochés) : une tuile habituelle s'y grise. */
  const toBuyIds = computed(() => new Set(list.value.items.filter((i) => !i.checked).map((i) => i.id)))

  const isFavorite = (name: string) => favoriteIds.value.has(shoppingKey(name))
  const isToBuy = (name: string) => toBuyIds.value.has(shoppingKey(name))

  /**
   * Produits connus qui contiennent la saisie (sans casse ni accents) : début de nom d'abord, puis
   * habituels, puis les plus souvent achetés.
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

  /** Relit la liste (première ouverture de la vue, avant tout message). */
  async function load(): Promise<void> {
    try { list.value = await getTransport().getShopping() }
    catch (err) { useNotificationsStore().error(t('shopping.toast.error', { message: (err as Error).message })) }
  }

  return { list, items, checkedCount, favorites, isFavorite, isToBuy, suggest, apply, load, add, update, remove, finish, setFavorite }
})
