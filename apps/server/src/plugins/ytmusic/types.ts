import { z } from 'zod'

// Schémas souples pour ce que l'UI consomme. Les réponses InnerTube varient ; on mappe d'abord en
// formes stables, puis on valide ici — jamais le JSON brut du fabricant.

export const trackSchema = z.object({
  videoId: z.string().min(1),
  title: z.string(),
  artists: z.array(z.string()),
  artUrl: z.string().nullable(),
  durationS: z.number().int().nonnegative().nullable(),
  album: z.string().nullable().optional(),
})
export type YtmusicTrack = z.infer<typeof trackSchema>

export const playlistSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  artUrl: z.string().nullable(),
  trackCount: z.number().int().nonnegative().nullable(),
})
export type YtmusicPlaylist = z.infer<typeof playlistSchema>

export const statusSchema = z.object({
  /** Compte relié (fichier cookie présent et contient `__Secure-3PAPISID`). */
  linked: z.boolean(),
  /** Générateur PO Token joignable (`GET …/ping`). */
  poTokenOk: z.boolean(),
  /** Avertissement non officiel — toujours vrai en phase 1. */
  unofficial: z.literal(true),
  cookieFile: z.string().nullable(),
  poTokenUrl: z.string(),
  lastError: z.string().nullable(),
})
export type YtmusicStatus = z.infer<typeof statusSchema>
