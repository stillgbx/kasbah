import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Logger } from 'pino'
import { writeFileAtomic } from '../../core/atomic-file'

// Ce que le plugin Mixcloud garde : le compte (un NOM d'utilisateur — l'API publique n'en demande pas
// plus, aucun mot de passe) et la position atteinte dans chaque mix écouté depuis Kasbah, pour le
// reprendre. Un seul fichier d'état, écrit en `.tmp` + rename.

const resumeSchema = z.object({ positionS: z.number().min(0), durationS: z.number().positive().nullable(), at: z.number() })
const fileSchema = z.object({
  username: z.string().nullable().default(null),
  resume: z.record(z.string(), resumeSchema).default({}),
})
export type MixcloudState = z.infer<typeof fileSchema>
export type ResumePoint = z.infer<typeof resumeSchema>

export interface MixcloudStore {
  load(): Promise<MixcloudState>
  save(state: MixcloudState): Promise<void>
}

export function createMixcloudFile(path: string, logger?: Logger): MixcloudStore {
  return {
    async load() {
      try {
        const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (parsed.success) return parsed.data
        logger?.warn({ path }, 'Mixcloud state file is unreadable, starting empty')
      } catch { /* pas encore de fichier */ }
      return { username: null, resume: {} }
    },
    async save(state) {
      await writeFileAtomic(path, JSON.stringify(state, null, 2))
    },
  }
}

export function memoryMixcloud(initial: Partial<MixcloudState> = {}): MixcloudStore {
  let state: MixcloudState = { username: null, resume: {}, ...initial }
  return {
    async load() { return structuredClone(state) },
    async save(next) { state = structuredClone(next) },
  }
}

/** En deçà, rien à reprendre ; au-delà de la fin moins ça, le mix est fini. */
export const RESUME_MIN_S = 60
export const RESUME_END_S = 90
/** Mix gardés au plus (les plus récemment écoutés). */
export const RESUME_MAX = 200

/** La position retenue pour un mix, ou rien (trop tôt, fini, oublié). */
export function resumePoint(p: ResumePoint | undefined): number | null {
  if (!p || p.positionS < RESUME_MIN_S) return null
  if (p.durationS && p.positionS > p.durationS - RESUME_END_S) return null
  return Math.floor(p.positionS)
}

/** Retenir une progression ; un mix fini (ou presque) est oublié ; les plus anciens partent au-delà de `RESUME_MAX`. */
export function noteProgress(resume: MixcloudState['resume'], key: string, positionS: number, durationS: number | null, ended: boolean, at: number): MixcloudState['resume'] {
  const next = { ...resume }
  if (ended || (durationS && positionS > durationS - RESUME_END_S)) delete next[key]
  else next[key] = { positionS, durationS, at }
  const keys = Object.keys(next)
  if (keys.length > RESUME_MAX) {
    for (const k of keys.sort((a, b) => next[a]!.at - next[b]!.at).slice(0, keys.length - RESUME_MAX)) delete next[k]
  }
  return next
}
