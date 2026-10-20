import { z } from 'zod'

// SHARED shopping list of the house: everyone fills it, checks off what is taken. It lives
// in one file per house, next to the `house.json` (see the server), like the automations.
//
// Two lists in the same file:
// - `items`, the current cart, in ADDITION ORDER. Checking moves nothing: the line is struck through
//   in place, under the finger, and "Finish shopping" then removes the checked ones all at once.
// - `products`, the memory: any product added once stays there, for the search; the star
//   makes it a "usual", put back in the cart with a touch.
//
// A product and its cart line share the same key, drawn from the name (case, accents and spaces
// ignored): "Lait" and "lait" are a single product, and the cart carries only one line of it.
//
// The operations are PURE functions, common to the server and the browser mock.

export const SHOPPING_NAME_MAX = 60
export const SHOPPING_QUANTITY_MAX = 99
/** Products added at once (an agent dictating a list). */
export const SHOPPING_ADD_MAX = 50

export const shoppingNameSchema = z.string().trim().min(1).max(SHOPPING_NAME_MAX)
export const shoppingQuantitySchema = z.number().int().min(1).max(SHOPPING_QUANTITY_MAX)

export const shoppingItemSchema = z.object({
  /** The key of the product (`shoppingKey`). */
  id: z.string().min(1),
  name: shoppingNameSchema,
  quantity: shoppingQuantitySchema,
  checked: z.boolean(),
  addedAt: z.number().int(),
})
export type ShoppingItem = z.infer<typeof shoppingItemSchema>

export const shoppingProductSchema = z.object({
  id: z.string().min(1),
  name: shoppingNameSchema,
  favorite: z.boolean(),
  /** Number of additions to the cart: ranks the search suggestions. */
  uses: z.number().int().min(0),
  lastUsedAt: z.number().int(),
})
export type ShoppingProduct = z.infer<typeof shoppingProductSchema>

export const shoppingListSchema = z.object({
  items: z.array(shoppingItemSchema),
  products: z.array(shoppingProductSchema),
})
export type ShoppingList = z.infer<typeof shoppingListSchema>

export const shoppingFileSchema = shoppingListSchema.extend({ schemaVersion: z.literal(1) })

export const EMPTY_SHOPPING_LIST: ShoppingList = { items: [], products: [] }

/** `POST /api/shopping/items`. */
export const shoppingAddBodySchema = z.object({
  items: z.array(z.object({ name: shoppingNameSchema, quantity: shoppingQuantitySchema.optional() })).min(1).max(SHOPPING_ADD_MAX),
})
export type ShoppingAddBody = z.infer<typeof shoppingAddBodySchema>

/** `PATCH /api/shopping/items/:id`: check, uncheck, change the quantity. */
export const shoppingItemPatchSchema = z.object({
  checked: z.boolean().optional(),
  quantity: shoppingQuantitySchema.optional(),
}).refine((p) => p.checked !== undefined || p.quantity !== undefined, { message: 'checked or quantity required' })
export type ShoppingItemPatch = z.infer<typeof shoppingItemPatchSchema>

/** `PUT /api/shopping/favorites`: star set or removed, on a known product or not. */
export const shoppingFavoriteBodySchema = z.object({ name: shoppingNameSchema, favorite: z.boolean() })
export type ShoppingFavoriteBody = z.infer<typeof shoppingFavoriteBodySchema>

/** Key of a product: without case, without accents, spaces tightened. */
export function shoppingKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const clampQuantity = (q: number) => Math.min(SHOPPING_QUANTITY_MAX, Math.max(1, q))

/**
 * Adds to the cart. A product already there and not yet taken sees its quantity increase; already checked,
 * it becomes "to buy" again with the requested quantity, IN ITS PLACE. Each addition feeds the memory.
 */
export function addShoppingItems(list: ShoppingList, inputs: readonly { name: string; quantity?: number | undefined }[], now: number): ShoppingList {
  const items = [...list.items]
  const products = [...list.products]
  for (const input of inputs) {
    const name = input.name.trim().replace(/\s+/g, ' ')
    const id = shoppingKey(name)
    if (!id) continue
    const add = clampQuantity(input.quantity ?? 1)
    const p = products.findIndex((x) => x.id === id)
    const product = p >= 0
      ? { ...products[p]!, uses: products[p]!.uses + 1, lastUsedAt: now }
      : { id, name, favorite: false, uses: 1, lastUsedAt: now }
    if (p >= 0) products[p] = product
    else products.push(product)
    const i = items.findIndex((x) => x.id === id)
    const item = items[i]
    if (!item) items.push({ id, name: product.name, quantity: add, checked: false, addedAt: now })
    else if (item.checked) items[i] = { ...item, checked: false, quantity: add }
    else items[i] = { ...item, quantity: clampQuantity(item.quantity + add) }
  }
  return { items, products }
}

/** Checks, unchecks or changes the quantity; `null` if the line does not exist. */
export function updateShoppingItem(list: ShoppingList, id: string, patch: ShoppingItemPatch): ShoppingList | null {
  const i = list.items.findIndex((x) => x.id === id)
  if (i < 0) return null
  const items = [...list.items]
  items[i] = {
    ...items[i]!,
    ...(patch.checked !== undefined ? { checked: patch.checked } : {}),
    ...(patch.quantity !== undefined ? { quantity: clampQuantity(patch.quantity) } : {}),
  }
  return { ...list, items }
}

/** Removes a line without buying it (the product stays in memory); `null` if it does not exist. */
export function removeShoppingItem(list: ShoppingList, id: string): ShoppingList | null {
  if (!list.items.some((x) => x.id === id)) return null
  return { ...list, items: list.items.filter((x) => x.id !== id) }
}

/** "Finish shopping": the checked lines leave the cart. */
export function clearCheckedShoppingItems(list: ShoppingList): ShoppingList {
  return { ...list, items: list.items.filter((x) => !x.checked) }
}

/** Sets or removes the star; a product never added enters the memory without counting a use. */
export function setShoppingFavorite(list: ShoppingList, name: string, favorite: boolean, now: number): ShoppingList {
  const clean = name.trim().replace(/\s+/g, ' ')
  const id = shoppingKey(clean)
  if (!id) return list
  const products = [...list.products]
  const p = products.findIndex((x) => x.id === id)
  if (p >= 0) products[p] = { ...products[p]!, favorite }
  else products.push({ id, name: clean, favorite, uses: 0, lastUsedAt: now })
  return { ...list, products }
}

/** The cart line designated by its id OR by its name (what an agent says). */
export function findShoppingItem(list: ShoppingList, idOrName: string): ShoppingItem | undefined {
  const key = shoppingKey(idOrName)
  return list.items.find((x) => x.id === idOrName || x.id === key)
}
