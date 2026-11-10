import { readFile } from 'node:fs/promises'
import { automationRunSchema, type AutomationRun } from '@kasbah/shared'
import { z } from 'zod'
import { writeFileAtomic } from '../atomic-file'

// Last run of each automation, on disk: a restart (update, crash, power cut) must not erase the
// failure the user comes to look at. One entry per automation, as in memory. Server state
// (`.state/`), not user data: an unreadable file is ignored, it does not block startup.

const fileSchema = z.object({ runs: z.record(z.string(), automationRunSchema) })

export interface RunsStore {
  load(): Promise<Record<string, AutomationRun>>
  save(runs: Readonly<Record<string, AutomationRun>>): Promise<void>
}

export function createRunsFile(path: string): RunsStore {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
        throw err
      }
      return fileSchema.parse(JSON.parse(raw)).runs
    },
    save: (runs) => writeFileAtomic(path, `${JSON.stringify({ runs }, null, 2)}\n`),
  }
}
