// A player's queue: the list of tracks, the one playing, and the repeat. Pure logic (no network
// call) — `index.ts` drives it: it starts the tracks, watches for the end of a track and decides
// when to move on. The speaker itself only ever knows one "file" at a time.

/** What `/play` accepts from a track: enough to resolve it (its source and id) and display it. */
export interface QueueTrack {
  source: string
  id: string
  title?: string
  artist?: string
  artUrl?: string
  durationS?: number
  explicit?: boolean
  /** Start from there (s): resuming a long mix. Applies to the first start, not to a repeat. */
  startS?: number
}

/**
 * Repeat of the current TRACK: `once` replays it once then the queue resumes (the mode falls back
 * to `off`), `loop` replays it endlessly. The queue itself does not loop.
 */
export const REPEAT_MODES = ['off', 'once', 'loop'] as const
export type RepeatMode = (typeof REPEAT_MODES)[number]

export interface PlayQueue {
  items: QueueTrack[]
  index: number
  repeat: RepeatMode
}

/** Natural end of the track: what plays next (same index = replay it), or null at the end of the queue. */
export function afterEnd(q: PlayQueue): { index: number; repeat: RepeatMode } | null {
  if (q.repeat === 'loop') return { index: q.index, repeat: 'loop' }
  if (q.repeat === 'once') return { index: q.index, repeat: 'off' }
  return q.index + 1 < q.items.length ? { index: q.index + 1, repeat: 'off' } : null
}

/**
 * The track to prepare ahead (yt-dlp resolution) while the current one plays: the one `afterEnd`
 * will start, unless it is the same one — its stream is already there.
 */
export function upcoming(q: PlayQueue): QueueTrack | null {
  const next = afterEnd(q)
  return next && next.index !== q.index ? q.items[next.index] ?? null : null
}

/** Jump to another track (next, previous, pick in the list): a pending `once` drops with the track it targeted. */
export function jumpTo(q: PlayQueue, index: number): { index: number; repeat: RepeatMode } | null {
  if (!Number.isInteger(index) || index < 0 || index >= q.items.length) return null
  return { index, repeat: q.repeat === 'once' ? 'off' : q.repeat }
}

/** Insert tracks right after the current one (`next`) or at the end of the queue (`end`). */
export function insert(q: PlayQueue, tracks: QueueTrack[], where: 'next' | 'end'): PlayQueue {
  const items = [...q.items]
  if (where === 'next') items.splice(q.index + 1, 0, ...tracks)
  else items.push(...tracks)
  return { ...q, items }
}

/** Remove a track that is not playing; the index follows the current track. null if it is the current one or out of the queue. */
export function removeAt(q: PlayQueue, index: number): PlayQueue | null {
  if (!Number.isInteger(index) || index < 0 || index >= q.items.length || index === q.index) return null
  const items = q.items.filter((_, i) => i !== index)
  return { ...q, items, index: index < q.index ? q.index - 1 : q.index }
}
