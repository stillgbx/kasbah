import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import { knownFileSchema, type SonosPlayer } from './types'

// Mémoire des enceintes déjà vues. Une Sonos éteinte ne répond plus au SSDP : sans ça elle
// quitte l'inventaire, et son entrée dans house.json perd son nom. Fichier absent ou illisible
// = mémoire vide, jamais une erreur fatale.

export interface KnownPlayers {
  load(): Promise<SonosPlayer[]>
  save(players: SonosPlayer[]): Promise<void>
}

export function createKnownPlayersFile(path: string, logger: Logger): KnownPlayers {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return [] }
      const parsed = knownFileSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger.warn({ path }, 'unreadable Sonos device memory, starting empty'); return [] }
      return parsed.data.devices
    },
    async save(players) {
      const text = `${JSON.stringify({ devices: players }, null, 2)}\n`
      const tmp = `${path}.${process.pid}.tmp`
      try {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(tmp, text, 'utf8')
        await rename(tmp, path)
      } catch (err) {
        logger.warn({ err, path }, 'could not write Sonos device memory')
      }
    },
  }
}
