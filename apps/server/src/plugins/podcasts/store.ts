import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { Logger } from 'pino'
import { writeFileAtomic } from '../../core/atomic-file'
import { noteProgress, resumePoint } from '../mixcloud/store'

// What the podcasts plugin keeps, per account (the house's file, or one per signed-in user): the
// shows subscribed to, the position reached in each episode (same rules as Mixcloud's resume:
// nothing below 60 s, forgotten in the last 90 s), and the episodes listened to the end.

const showSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  artUrl: z.string().nullable(),
  feedUrl: z.string(),
  genre: z.string().nullable(),
})
const resumeSchema = z.object({ positionS: z.number().min(0), durationS: z.number().positive().nullable(), at: z.number() })
const fileSchema = z.object({
  subscriptions: z.array(showSchema).default([]),
  resume: z.record(z.string(), resumeSchema).default({}),
  /** Episode id → when it was finished. */
  played: z.record(z.string(), z.number()).default({}),
})
export type PodcastsState = z.infer<typeof fileSchema>

export interface PodcastsStore {
  load(): Promise<PodcastsState>
  save(state: PodcastsState): Promise<void>
}

const empty = (): PodcastsState => ({ subscriptions: [], resume: {}, played: {} })

export function createPodcastsFile(path: string, logger?: Logger): PodcastsStore {
  return {
    async load() {
      try {
        const parsed = fileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        if (parsed.success) return parsed.data
        logger?.warn({ path }, 'podcasts state file is unreadable, starting empty')
      } catch { /* no file yet */ }
      return empty()
    },
    async save(state) {
      await writeFileAtomic(path, JSON.stringify(state, null, 2))
    },
  }
}

export function memoryPodcasts(initial: Partial<PodcastsState> = {}): PodcastsStore {
  let state: PodcastsState = { ...empty(), ...initial }
  return {
    async load() { return structuredClone(state) },
    async save(next) { state = structuredClone(next) },
  }
}

/** Maximum number of finished episodes remembered (the oldest go). */
export const PLAYED_MAX = 5000

/**
 * A progress on an episode: its position is remembered; at the end (or in its last 90 s, where the
 * credits and ads are) it is forgotten and the episode counts as listened to.
 */
export function noteEpisodeProgress(state: PodcastsState, id: string, positionS: number, durationS: number | null, ended: boolean, at: number): PodcastsState {
  const resume = noteProgress(state.resume, id, positionS, durationS, ended, at)
  const finished = !resume[id] && (ended || (durationS !== null && positionS > durationS / 2))
  if (!finished) return { ...state, resume }
  const played = { ...state.played, [id]: at }
  const ids = Object.keys(played)
  if (ids.length > PLAYED_MAX) {
    for (const k of ids.sort((a, b) => played[a]! - played[b]!).slice(0, ids.length - PLAYED_MAX)) delete played[k]
  }
  return { ...state, resume, played }
}

export { resumePoint }
