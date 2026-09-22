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
  year: z.string().nullable().optional(),
  /** Badge InnerTube `MUSIC_EXPLICIT_BADGE`. */
  explicit: z.boolean().optional(),
})
export type YtmusicTrack = z.infer<typeof trackSchema>

export const playlistSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  artUrl: z.string().nullable(),
  trackCount: z.number().int().nonnegative().nullable(),
})
export type YtmusicPlaylist = z.infer<typeof playlistSchema>

export const artistSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  artUrl: z.string().nullable(),
  subscribers: z.string().nullable().optional(),
})
export type YtmusicArtist = z.infer<typeof artistSchema>

export const albumReleaseTypeSchema = z.enum(['album', 'single', 'ep', 'compilation'])
export type YtmusicAlbumReleaseType = z.infer<typeof albumReleaseTypeSchema>

export const albumSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  artUrl: z.string().nullable(),
  artists: z.array(z.string()),
  year: z.string().nullable().optional(),
  /**
   * Déduit du sous-titre InnerTube (« Album · … », « Single · … ») — pas un champ API dédié.
   * Absent / null = non reconnu → traité comme album.
   */
  releaseType: albumReleaseTypeSchema.nullable().optional(),
  /** Badge InnerTube `MUSIC_EXPLICIT_BADGE`. */
  explicit: z.boolean().optional(),
})
export type YtmusicAlbum = z.infer<typeof albumSchema>

export const searchResultSchema = z.object({
  artists: z.array(artistSchema),
  albums: z.array(albumSchema),
  singles: z.array(albumSchema),
  compilations: z.array(albumSchema),
  tracks: z.array(trackSchema),
})
export type YtmusicSearchResult = z.infer<typeof searchResultSchema>

/** Un genre ou une ambiance de « Humeurs et genres » : de quoi l'afficher, et le `params` qui ouvre sa page. */
export const exploreCategorySchema = z.object({
  title: z.string().min(1),
  params: z.string().min(1),
  /** Couleur de la pastille chez YouTube Music (`#rrggbb`), si elle est donnée. */
  color: z.string().regex(/^#[0-9a-f]{6}$/).nullable(),
})
export type YtmusicExploreCategory = z.infer<typeof exploreCategorySchema>

const exploreGroupSchema = z.object({ title: z.string(), categories: z.array(exploreCategorySchema) })

/** « Pour vous » (personnalisé, parfois absent), « Humeurs et moments », « Genres » — titres tels que YouTube les localise. */
export const exploreSchema = z.object({
  forYou: exploreGroupSchema,
  moods: exploreGroupSchema,
  genres: exploreGroupSchema,
})
export type YtmusicExplore = z.infer<typeof exploreSchema>

/** Une rangée de la page d'une catégorie : titres, playlists OFFICIELLES, albums (ni clips ni playlists d'utilisateurs). */
export const exploreShelfSchema = z.object({
  title: z.string(),
  tracks: z.array(trackSchema),
  playlists: z.array(playlistSchema),
  albums: z.array(albumSchema),
})
export const exploreCategoryPageSchema = z.object({
  shelves: z.array(exploreShelfSchema),
})
export type YtmusicExploreCategoryPage = z.infer<typeof exploreCategoryPageSchema>

export const statusSchema = z.object({
  /** Compte relié (fichier cookie présent et contient `__Secure-3PAPISID`). */
  linked: z.boolean(),
  /** Cookie présent mais refusé par InnerTube (401 / login) — il faut se reconnecter. */
  cookieExpired: z.boolean(),
  /** Générateur PO Token joignable (`GET …/ping`). */
  poTokenOk: z.boolean(),
  /** Avertissement non officiel — toujours vrai en phase 1. */
  unofficial: z.literal(true),
  cookieFile: z.string().nullable(),
  poTokenUrl: z.string(),
  lastError: z.string().nullable(),
  /** Navigateurs acceptés pour `POST /cookie/from-browser`. */
  browsers: z.array(z.string()),
})
export type YtmusicStatus = z.infer<typeof statusSchema>
