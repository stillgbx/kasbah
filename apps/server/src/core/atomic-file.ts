import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// Écriture atomique d'un fichier d'état : un intermédiaire `.tmp` puis `rename`, pour qu'une coupure
// ne laisse jamais un fichier tronqué.
//
// Les écritures d'un même chemin passent À LA FILE. Les plugins enregistrent sans attendre
// (`void store.save(…)`), et deux appels rapprochés partageaient le même `.tmp` : le premier `rename`
// l'emportait, le second échouait en ENOENT (vu au démarrage le 2026-10-01, cache d'état Tesla).
// Chaque écriture attend la précédente : la dernière demandée est la dernière écrite. Même mécanique
// que `updateHouseFile` (config/house.ts).
//
// `.tmp` nommé d'après le processus : deux serveurs sur la même machine (développement et preview)
// écrivent parfois le même fichier, et un intermédiaire commun se marcherait dessus.

const queues = new Map<string, Promise<void>>()

export interface AtomicWriteOptions {
  /** Droits du fichier (`0o600` pour une session ou un jeton). */
  mode?: number
}

/**
 * Écrit `text` dans `path`, après les écritures déjà en file sur ce chemin. Rejette si le disque
 * refuse : à l'appelant de choisir entre l'avertissement et l'erreur. Un échec ne bloque pas la file.
 */
export function writeFileAtomic(path: string, text: string, options: AtomicWriteOptions = {}): Promise<void> {
  const key = resolve(path)
  const run = async () => {
    const tmp = `${path}.${process.pid}.tmp`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(tmp, text, { encoding: 'utf8', ...options })
    await rename(tmp, path)
  }
  const next = (queues.get(key) ?? Promise.resolve()).then(run)
  const tail = next.catch(() => undefined)
  queues.set(key, tail)
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key) })
  return next
}
