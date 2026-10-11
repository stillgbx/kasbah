import { readFile } from 'node:fs/promises'
import { commandSchema } from '@kasbah/shared'
import { z } from 'zod'
import { writeFileAtomic } from '../atomic-file'
import type { PendingRevert } from './runner'

// Les retours « pendant N minutes » en attente, sur disque : un redémarrage du serveur pendant
// l'attente ne doit pas laisser le portail ouvert. Au démarrage, le moteur les reprend ; un retour
// dont l'heure est passée part dès que son appareil répond. État du serveur (`.state/`), pas une
// donnée de l'utilisateur : un fichier illisible est ignoré, il ne bloque pas le démarrage.

const fileSchema = z.object({
  reverts: z.array(z.object({
    automationId: z.string(), action: z.number().int().min(0), deviceId: z.string(),
    command: commandSchema, dueAt: z.number().int(),
  })),
})

export interface RevertsStore {
  load(): Promise<PendingRevert[]>
  save(reverts: readonly PendingRevert[]): Promise<void>
}

export function createRevertsFile(path: string): RevertsStore {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
      }
      return fileSchema.parse(JSON.parse(raw)).reverts
    },
    save: (reverts) => writeFileAtomic(path, `${JSON.stringify({ reverts }, null, 2)}\n`),
  }
}
