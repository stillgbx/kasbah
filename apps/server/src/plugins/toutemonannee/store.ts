import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Logger } from 'pino'
import { writeFileAtomic } from '../../core/atomic-file'

// L'état du plugin TouteMonAnnée, dans `.state/` (hors dépôt, droits 0600) : les cookies de session
// — ils valent accès au compte —, les filtres choisis dans la vue École, les cases « fait » que le site
// ne porte pas, et la dernière publication vue. Jamais le mot de passe.

export const tmaStateSchema = z.object({
  account: z.object({ username: z.string() }).nullable().default(null),
  cookies: z.record(z.string(), z.string()).default({}),
  filters: z.object({
    hiddenJournals: z.array(z.string()).default([]),
    hiddenLevels: z.array(z.string()).default([]),
  }).default({ hiddenJournals: [], hiddenLevels: [] }),
  /** Devoirs cochés « fait » dans Kasbah, quand l'enseignante n'a pas ouvert la case du site. */
  done: z.array(z.number()).default([]),
  /** Identifiant de la plus récente publication vue : au-delà, elles sont « nouvelles ». */
  postsSeen: z.number().default(0),
})
export type TmaState = z.infer<typeof tmaStateSchema>

export interface TmaStore {
  load(): Promise<TmaState>
  save(state: TmaState): Promise<void>
}

export const emptyTmaState = (): TmaState => tmaStateSchema.parse({})

export function createTmaFile(path: string, logger?: Logger): TmaStore {
  return {
    async load() {
      try {
        const parsed = tmaStateSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'toutemonannee state file is unreadable, starting empty'); return emptyTmaState() }
        return parsed.data
      } catch { return emptyTmaState() }
    },
    async save(state) {
      await writeFileAtomic(path, JSON.stringify(state, null, 2), { mode: 0o600 })
    },
  }
}

export function memoryTmaStore(initial: Partial<TmaState> = {}): TmaStore {
  let state = tmaStateSchema.parse(initial)
  return {
    async load() { return structuredClone(state) },
    async save(next) { state = structuredClone(next) },
  }
}
