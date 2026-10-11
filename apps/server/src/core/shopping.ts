import { readFile, writeFile } from 'node:fs/promises'
import { EMPTY_SHOPPING_LIST, shoppingFileSchema, type ShoppingList } from '@kasbah/shared'
import { ReadOnlyHouseError } from '../config/house'
import { writeFileAtomic } from './atomic-file'

// La liste de courses d'une maison vit À CÔTÉ d'elle : `maison.json` → `maison.shopping.json`. Comme
// les automatisations : données de l'utilisateur (pas un cache), fichier illisible = démarrage
// refusé (démarrer à vide ferait écraser la liste par le premier ajout), copie `.bak` de la version
// précédente.
//
// Les opérations passent À LA FILE : chacune lit la liste laissée par la précédente, l'écrit, puis
// seulement la publie. Deux écrans qui cochent en même temps ne s'écrasent pas.

export function shoppingPathFor(housePath: string): string {
  return `${housePath.replace(/\.json$/i, '')}.shopping.json`
}

export class ShoppingService {
  private list: ShoppingList = EMPTY_SHOPPING_LIST
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<(list: ShoppingList) => void>()

  /** `readOnly` : une démonstration — sa liste se lit, rien ne s'écrit (`ReadOnlyHouseError`). */
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

  /** Applique une opération pure ; `null` (ligne inconnue) ne touche à rien et se rend tel quel. */
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
