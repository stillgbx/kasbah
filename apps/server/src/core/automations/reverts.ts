import { readFile } from 'node:fs/promises'
import { commandSchema } from '@kasbah/shared'
import { z } from 'zod'
import { writeFileAtomic } from '../atomic-file'
import type { PendingRevert } from './runner'

// Pending "for N minutes" reverts, on disk: a server restart during the wait must not leave the
// gate open. At startup, the engine picks them up again; a revert whose time has passed goes out as
// soon as its device answers. Server state (`.state/`), not user data: an unreadable file is
// ignored, it does not block startup.

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
