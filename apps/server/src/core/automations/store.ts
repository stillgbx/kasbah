import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { automationsFileSchema, type Automation } from '@kasbah/shared'
import { ReadOnlyHouseError } from '../../config/house'

// A house's automations live in a file NEXT TO it: `maison.json` → `maison.automations.json`.
// Two houses, two files; and this is user data, not a server cache — nothing to do with
// `.state/`, which can be wiped without losing anything.
//
// An unreadable file PREVENTS startup, like an invalid house: starting empty would let the first
// save overwrite the user's rules. Atomic write (temporary + rename) with a `.bak` copy of the
// previous version, serialized writes.

export function automationsPathFor(housePath: string): string {
  return `${housePath.replace(/\.json$/i, '')}.automations.json`
}

export interface AutomationsStore {
  load(): Promise<Automation[]>
  save(automations: readonly Automation[]): Promise<void>
}

/** `readOnly`: a demo — its automations can be read, none can be written (`ReadOnlyHouseError`). */
export function createAutomationsFile(path: string, opts: { readOnly?: boolean } = {}): AutomationsStore {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
      }
      const parsed = automationsFileSchema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(racine)'}: ${i.message}`).join('; ')
        throw new Error(`fichier d'automatisations invalide (${path}) : ${issues}`)
      }
      return parsed.data.automations
    },
    save(automations) {
      if (opts.readOnly) return Promise.reject(new ReadOnlyHouseError())
      const run = async () => {
        const text = `${JSON.stringify({ schemaVersion: 1, automations }, null, 2)}\n`
        await mkdir(dirname(path), { recursive: true })
        try { await writeFile(`${path}.bak`, await readFile(path, 'utf8'), 'utf8') }
        catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err }
        await writeFile(`${path}.tmp`, text, 'utf8')
        await rename(`${path}.tmp`, path)
      }
      const next = queue.then(run, run)
      queue = next.catch(() => undefined)
      return next
    },
  }
}
