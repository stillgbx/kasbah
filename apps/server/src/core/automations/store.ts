import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { automationsFileSchema, type Automation } from '@kasbah/shared'
import { ReadOnlyHouseError } from '../../config/house'

// Les automatisations d'une maison vivent dans un fichier À CÔTÉ d'elle : `maison.json` →
// `maison.automations.json`. Deux maisons, deux fichiers ; et ce sont des données de l'utilisateur,
// pas un cache du serveur — rien à voir avec `.state/`, qu'on peut effacer sans rien perdre.
//
// Un fichier illisible EMPÊCHE le démarrage, comme une maison invalide : démarrer à vide ferait
// écraser les règles de l'utilisateur par la première sauvegarde. Écriture atomique (temporaire +
// rename) avec copie `.bak` de la version précédente, écritures sérialisées.

export function automationsPathFor(housePath: string): string {
  return `${housePath.replace(/\.json$/i, '')}.automations.json`
}

export interface AutomationsStore {
  load(): Promise<Automation[]>
  save(automations: readonly Automation[]): Promise<void>
}

/** `readOnly` : une démonstration — ses automatisations se lisent, aucune ne s'écrit (`ReadOnlyHouseError`). */
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
