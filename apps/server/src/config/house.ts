import { readFile, rename, writeFile } from 'node:fs/promises'
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

export async function updateHouseFile(loaded: LoadedHouse, mutate: (doc: unknown) => unknown): Promise<House> {
  const run = async () => {
    const raw = await readFile(loaded.path, 'utf8')
    const doc = mutate(JSON.parse(raw))
    const house = parseHouse(doc)             // HouseValidationError → 400 via le gestionnaire d'erreurs
    const text = `${JSON.stringify(doc, null, 2)}\n`
    await writeFile(`${loaded.path}.bak`, raw, 'utf8')
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
