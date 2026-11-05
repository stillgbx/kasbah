import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { lightSyncSettingsSchema, type LightSyncSettings } from '@kasbah/shared'
import { writeFileAtomic } from '../../core/atomic-file'

// Light sync settings per room (house room id): the room's lights are what is being dressed, two
// speakers of the same room share them. Written as `.tmp` + rename; an unreadable room entry is
// dropped on its own, the others are kept.

export type LightSyncSettingsByRoom = Record<string, LightSyncSettings>

export interface LightSyncSettingsStore {
  load(): Promise<LightSyncSettingsByRoom>
  save(all: LightSyncSettingsByRoom): Promise<void>
}

export function createLightSyncSettingsFile(path: string, logger?: Logger): LightSyncSettingsStore {
  return {
    async load() {
      let raw: unknown
      try { raw = JSON.parse(await readFile(path, 'utf8')) } catch { return {} }   // no file yet
      const out: LightSyncSettingsByRoom = {}
      if (raw && typeof raw === 'object') {
        for (const [room, value] of Object.entries(raw)) {
          const parsed = lightSyncSettingsSchema.safeParse(value)
          if (parsed.success) out[room] = parsed.data
          else logger?.warn({ path, room }, 'light sync settings unreadable for a room, back to defaults')
        }
      }
      return out
    },
    async save(all) {
      await writeFileAtomic(path, JSON.stringify(all, null, 2))
    },
  }
}

export function memoryLightSyncSettings(initial: LightSyncSettingsByRoom = {}): LightSyncSettingsStore {
  let all = structuredClone(initial)
  return {
    async load() { return structuredClone(all) },
    async save(next) { all = structuredClone(next) },
  }
}
