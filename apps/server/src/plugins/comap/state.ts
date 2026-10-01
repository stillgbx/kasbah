import { readFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import { z } from 'zod'
import { consumptionPointSchema } from '@kasbah/shared'
import { writeFileAtomic } from '../../core/atomic-file'

// Ce que le plugin garde entre deux démarrages : l'historique de consommation DÉJÀ CALCULÉ (jamais
// les relevés bruts de la station, ni le curseur qui sert à dater le prochain delta — voir
// `history.ts` sur pourquoi ce curseur-là ne survit PAS à un redémarrage). Bornée par construction
// (48 points horaires, 62 journaliers — voir `HOURLY_POINTS_MAX`/`DAILY_POINTS_MAX` dans
// `history.ts`) : une centaine de nombres, quelques kilo-octets. Écriture atomique par `rename`,
// sur le modèle de `automower/state.ts`.

export const comapHistorySchema = z.object({
  hourly: z.array(consumptionPointSchema),
  daily: z.array(consumptionPointSchema),
})
export type ComapHistoryState = z.infer<typeof comapHistorySchema>

export const EMPTY_HISTORY: ComapHistoryState = { hourly: [], daily: [] }

export interface HistoryStore {
  load(): Promise<ComapHistoryState | null>
  save(h: ComapHistoryState): Promise<void>
}

/** Écriture atomique (fichier temporaire puis renommage) ; une lecture illisible vaut « rien ». */
export function createHistoryFile(path: string, logger?: Logger): HistoryStore {
  return {
    async load() {
      try {
        const parsed = comapHistorySchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (!parsed.success) { logger?.warn({ path }, 'COMAP history file is unreadable (or from an older version), starting over'); return null }
        return parsed.data
      } catch { return null }
    },
    async save(h) {
      try { await writeFileAtomic(path, JSON.stringify(h, null, 2)) }
      catch (err) { logger?.warn({ err, path }, 'could not write the COMAP history file') }
    },
  }
}
