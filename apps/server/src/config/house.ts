import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { lintHouse, parseHouse, type House, type HouseWarning } from '@kasbah/shared'

export interface LoadedHouse { house: House; warnings: HouseWarning[]; path: string; raw: string }

/** Lit et valide le JSON de la maison. Une maison invalide empêche le démarrage (échec rapide). */
export async function loadHouse(path: string): Promise<LoadedHouse> {
  const raw = await readFile(path, 'utf8')
  const house = parseHouse(JSON.parse(raw))
  return { house, warnings: lintHouse(house), path, raw }
}

// Écriture : la SEULE modification que le serveur fait au fichier (placement d'un appareil depuis
// l'UI). Lire-modifier-écrire sur le fichier lui-même — pas depuis la mémoire — pour ne pas écraser
// une édition manuelle faite depuis le démarrage ; validation complète avant d'écrire ; écriture
// atomique (fichier temporaire + rename) avec copie `.bak` de la version précédente. Les écritures
// sont sérialisées par fichier.

const queues = new Map<string, Promise<unknown>>()

/** Versions gardées dans `history/` : le `.bak` n'en garde qu'une, écrasée à l'écriture suivante. */
export const HOUSE_HISTORY_KEEP = 50

/**
 * Copie horodatée de la version qu'on s'apprête à remplacer, dans `history/` à côté du fichier : une
 * erreur d'édition se rattrape même plusieurs écritures plus tard. Les plus anciennes au-delà de
 * `HOUSE_HISTORY_KEEP` sont retirées (l'horodatage ISO se trie comme une chaîne).
 */
async function keepHistory(path: string, raw: string): Promise<void> {
  const dir = join(dirname(path), 'history')
  const name = basename(path).replace(/.json$/, '')
  await mkdir(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await writeFile(join(dir, `${name}.${stamp}.json`), raw, 'utf8')
  const mine = (await readdir(dir)).filter((f) => f.startsWith(`${name}.`) && f.endsWith('.json')).sort()
  for (const old of mine.slice(0, Math.max(0, mine.length - HOUSE_HISTORY_KEEP))) await rm(join(dir, old), { force: true })
}

export async function updateHouseFile(loaded: LoadedHouse, mutate: (doc: unknown) => unknown): Promise<House> {
  const run = async () => {
    const raw = await readFile(loaded.path, 'utf8')
    const doc = mutate(JSON.parse(raw))
    const house = parseHouse(doc)             // HouseValidationError → 400 via le gestionnaire d'erreurs
    const text = `${JSON.stringify(doc, null, 2)}\n`
    await writeFile(`${loaded.path}.bak`, raw, 'utf8')
    await keepHistory(loaded.path, raw)
    await writeFile(`${loaded.path}.tmp`, text, 'utf8')
    await rename(`${loaded.path}.tmp`, loaded.path)
    loaded.house = house
    loaded.warnings = lintHouse(house)
    loaded.raw = text
    return house
  }
  const prev = queues.get(loaded.path) ?? Promise.resolve()
  const next = prev.then(run, run)
  queues.set(loaded.path, next)
  try { return await next }
  finally { if (queues.get(loaded.path) === next) queues.delete(loaded.path) }
}
