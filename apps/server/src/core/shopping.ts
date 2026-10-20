import { readFile, writeFile } from 'node:fs/promises'
import { EMPTY_SHOPPING_LIST, shoppingFileSchema, type ShoppingList } from '@kasbah/shared'
import { ReadOnlyHouseError } from '../config/house'
import { writeFileAtomic } from './atomic-file'

// A house's shopping list lives NEXT TO it: `maison.json` → `maison.shopping.json`. Like the
// automations: user data (not a cache), unreadable file = startup refused (starting empty would let
// the first addition overwrite the list), `.bak` copy of the previous version.
//
// Operations are QUEUED: each one reads the list left by the previous one, writes it, and only then
// publishes it. Two screens ticking at the same time do not overwrite each other.

export function shoppingPathFor(housePath: string): string {
  return `${housePath.replace(/\.json$/i, '')}.shopping.json`
}

export class ShoppingService {
  private list: ShoppingList = EMPTY_SHOPPING_LIST
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<(list: ShoppingList) => void>()

  /** `readOnly`: a demo — its list can be read, nothing is written (`ReadOnlyHouseError`). */
  constructor(private readonly path: string, private readonly opts: { readOnly?: boolean } = {}) {}

  async load(): Promise<void> {
    let raw: string
    try { raw = await readFile(this.path, 'utf8') }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    const parsed = shoppingFileSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'}: ${i.message}`).join('; ')
      throw new Error(`liste de courses invalide (${this.path}) : ${issues}`)
    }
    this.list = { items: parsed.data.items, products: parsed.data.products }
  }

  get(): ShoppingList { return this.list }

  onChange(cb: (list: ShoppingList) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Applies a pure operation; `null` (unknown line) touches nothing and is returned as is. */
  update(op: (list: ShoppingList) => ShoppingList | null): Promise<ShoppingList | null> {
    if (this.opts.readOnly) return Promise.reject(new ReadOnlyHouseError())
    const run = async () => {
      const next = op(this.list)
      if (!next) return null
      try { await writeFile(`${this.path}.bak`, await readFile(this.path, 'utf8'), 'utf8') }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
      await writeFileAtomic(this.path, `${JSON.stringify({ schemaVersion: 1, ...next }, null, 2)}\n`)
      this.list = next
      for (const cb of this.listeners) cb(next)
      return next
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => undefined)
    return result
  }
}
