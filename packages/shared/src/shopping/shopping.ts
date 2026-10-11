import { z } from 'zod'

// Liste de courses PARTAGÉE de la maison : tout le monde la remplit, coche ce qui est pris. Elle vit
// dans un fichier par maison, à côté du `house.json` (voir le serveur), comme les automatisations.
//
// Deux listes dans le même fichier :
// - `items`, le panier en cours, dans l'ORDRE D'AJOUT. Cocher ne déplace rien : la ligne se barre
//   sur place, sous le doigt, et « Terminer les courses » retire ensuite les cochées d'un coup.
// - `products`, la mémoire : tout produit ajouté une fois y reste, pour la recherche ; l'étoile en
//   fait un « habituel », remis dans le panier d'un toucher.
//
// Un produit et sa ligne du panier partagent la même clé, tirée du nom (casse, accents et espaces
// ignorés) : « Lait » et « lait » sont un seul produit, et le panier n'en porte qu'une ligne.
//
// Les opérations sont des fonctions PURES, communes au serveur et au mock du navigateur.

export const SHOPPING_NAME_MAX = 60
export const SHOPPING_QUANTITY_MAX = 99
/** Produits ajoutés d'un coup (un agent qui dicte une liste). */
export const SHOPPING_ADD_MAX = 50

export const shoppingNameSchema = z.string().trim().min(1).max(SHOPPING_NAME_MAX)
export const shoppingQuantitySchema = z.number().int().min(1).max(SHOPPING_QUANTITY_MAX)

export const shoppingItemSchema = z.object({
  /** La clé du produit (`shoppingKey`). */
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
  /** Nombre d'ajouts au panier : classe les propositions de la recherche. */
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

/** `PATCH /api/shopping/items/:id` : cocher, décocher, changer la quantité. */
export const shoppingItemPatchSchema = z.object({
  checked: z.boolean().optional(),
  quantity: shoppingQuantitySchema.optional(),
}).refine((p) => p.checked !== undefined || p.quantity !== undefined, { message: 'checked or quantity required' })
export type ShoppingItemPatch = z.infer<typeof shoppingItemPatchSchema>

/** `PUT /api/shopping/favorites` : étoile posée ou retirée, sur un produit connu ou non. */
export const shoppingFavoriteBodySchema = z.object({ name: shoppingNameSchema, favorite: z.boolean() })
export type ShoppingFavoriteBody = z.infer<typeof shoppingFavoriteBodySchema>

/** Clé d'un produit : sans casse, sans accents, espaces resserrés. */
export function shoppingKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const clampQuantity = (q: number) => Math.min(SHOPPING_QUANTITY_MAX, Math.max(1, q))

/**
 * Ajoute au panier. Un produit déjà là et pas encore pris voit sa quantité augmenter ; déjà coché,
 * il redevient « à acheter » avec la quantité demandée, À SA PLACE. Chaque ajout nourrit la mémoire.
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

/** Coche, décoche ou change la quantité ; `null` si la ligne n'existe pas. */
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

/** Retire une ligne sans l'acheter (le produit reste en mémoire) ; `null` si elle n'existe pas. */
export function removeShoppingItem(list: ShoppingList, id: string): ShoppingList | null {
  if (!list.items.some((x) => x.id === id)) return null
  return { ...list, items: list.items.filter((x) => x.id !== id) }
}

/** « Terminer les courses » : les lignes cochées quittent le panier. */
export function clearCheckedShoppingItems(list: ShoppingList): ShoppingList {
  return { ...list, items: list.items.filter((x) => !x.checked) }
}

/** Pose ou retire l'étoile ; un produit jamais ajouté entre en mémoire sans compter d'usage. */
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

/** La ligne du panier désignée par son id OU par son nom (ce que dit un agent). */
export function findShoppingItem(list: ShoppingList, idOrName: string): ShoppingItem | undefined {
  const key = shoppingKey(idOrName)
  return list.items.find((x) => x.id === idOrName || x.id === key)
}
