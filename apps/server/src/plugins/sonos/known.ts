import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { knownFileSchema, type SonosPlayer } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// Memory of the speakers already seen. A switched-off Sonos no longer answers SSDP: without this
// it leaves the inventory, and its entry in house.json loses its name. Missing or unreadable file
// = empty memory, never a fatal error.

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
      try { await writeFileAtomic(path, `${JSON.stringify({ devices: players }, null, 2)}\n`) }
      catch (err) { logger.warn({ err, path }, 'could not write Sonos device memory') }
    },
  }
}
