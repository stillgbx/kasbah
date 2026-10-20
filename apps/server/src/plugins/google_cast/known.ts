import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { castTxtSchema, type CastService } from './types'
import { writeFileAtomic } from '../../core/atomic-file'

// MEMORY of receivers already seen. A Cast device that is off (TV on standby, Chromecast unplugged)
// no longer announces itself over mDNS: without memory, it leaves the inventory, and its entry in
// house.json loses its name, its icon and its state — the UI only has a raw id and "linked to no
// plugin". So we keep each device's last announcement in a small JSON, replayed at startup: the
// device stays listed, unavailable, until it announces itself again — or the user forgets it.
//
// File missing, unreadable or of another shape: empty memory, never a fatal error (the plugin must
// start even when nothing can be written to disk).

const knownFileSchema = z.object({
  devices: z.array(z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    txt: castTxtSchema,
  })).default([]),
})

export interface KnownDevices {
  load(): Promise<CastService[]>
  save(services: CastService[]): Promise<void>
}

export function createKnownDevicesFile(path: string, logger: Logger): KnownDevices {
  return {
    async load() {
      let raw: string
      try { raw = await readFile(path, 'utf8') }
      catch { return [] }                                       // no file yet: first start
      const parsed = knownFileSchema.safeParse(((): unknown => { try { return JSON.parse(raw) } catch { return null } })())
      if (!parsed.success) { logger.warn({ path }, 'unreadable Cast device memory, starting empty'); return [] }
      return parsed.data.devices
    },
    async save(services) {
      try { await writeFileAtomic(path, `${JSON.stringify({ devices: services }, null, 2)}\n`) }
      catch (err) { logger.warn({ err, path }, 'could not write Cast device memory') }
    },
  }
}
