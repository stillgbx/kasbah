// File d'attente d'un lecteur : la liste des titres, celui qui joue, et la répétition. Logique pure
// (aucun appel réseau) — `index.ts` la pilote : il lance les titres, surveille la fin de piste et
// décide quand avancer. L'enceinte, elle, ne connaît jamais qu'un « fichier » à la fois.

/** Ce que `/play` accepte d'une piste : de quoi la résoudre (sa source et son id) et l'afficher. */
export interface QueueTrack {
  source: string
  id: string
  title?: string
  artist?: string
  artUrl?: string
  durationS?: number
  explicit?: boolean
  /** Partir de là (s) : la reprise d'un mix long. Vaut pour le premier lancement, pas pour une répétition. */
  startS?: number
}

/**
 * Répétition du TITRE en cours : `once` le rejoue une fois puis la file reprend (le mode retombe à
 * `off`), `loop` le rejoue sans fin. La file elle-même ne boucle pas.
 */
export const REPEAT_MODES = ['off', 'once', 'loop'] as const
export type RepeatMode = (typeof REPEAT_MODES)[number]

export interface PlayQueue {
  items: QueueTrack[]
  index: number
  repeat: RepeatMode
}

/** Fin naturelle du titre : ce qui joue ensuite (même index = on le rejoue), ou null en bout de file. */
export function afterEnd(q: PlayQueue): { index: number; repeat: RepeatMode } | null {
  if (q.repeat === 'loop') return { index: q.index, repeat: 'loop' }
  if (q.repeat === 'once') return { index: q.index, repeat: 'off' }
  return q.index + 1 < q.items.length ? { index: q.index + 1, repeat: 'off' } : null
}

/**
 * Le titre à préparer d'avance (résolution yt-dlp) pendant que le courant joue : celui qu'`afterEnd`
 * lancera, sauf s'il s'agit du même — son flux est déjà là.
 */
export function upcoming(q: PlayQueue): QueueTrack | null {
  const next = afterEnd(q)
  return next && next.index !== q.index ? q.items[next.index] ?? null : null
}

/** Sauter à un autre titre (suivant, précédent, choix dans la liste) : un `once` en attente tombe avec le titre qu'il visait. */
export function jumpTo(q: PlayQueue, index: number): { index: number; repeat: RepeatMode } | null {
  if (!Number.isInteger(index) || index < 0 || index >= q.items.length) return null
  return { index, repeat: q.repeat === 'once' ? 'off' : q.repeat }
}

/** Insérer des titres juste après le courant (`next`) ou en fin de file (`end`). */
export function insert(q: PlayQueue, tracks: QueueTrack[], where: 'next' | 'end'): PlayQueue {
  const items = [...q.items]
  if (where === 'next') items.splice(q.index + 1, 0, ...tracks)
  else items.push(...tracks)
  return { ...q, items }
}

/** Retirer un titre qui ne joue pas ; l'index suit le titre courant. null si c'est le courant ou hors file. */
export function removeAt(q: PlayQueue, index: number): PlayQueue | null {
  if (!Number.isInteger(index) || index < 0 || index >= q.items.length || index === q.index) return null
  const items = q.items.filter((_, i) => i !== index)
  return { ...q, items, index: index < q.index ? q.index - 1 : q.index }
}
