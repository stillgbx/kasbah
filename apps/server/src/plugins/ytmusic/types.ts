import { z } from 'zod'

// Loose schemas for what the UI consumes. InnerTube responses vary; we first map into stable
// shapes, then validate here — never the vendor's raw JSON.

export const trackSchema = z.object({
  videoId: z.string().min(1),
  title: z.string(),
  artists: z.array(z.string()),
  artUrl: z.string().nullable(),
  durationS: z.number().int().nonnegative().nullable(),
  album: z.string().nullable().optional(),
  year: z.string().nullable().optional(),
  /** InnerTube badge `MUSIC_EXPLICIT_BADGE`. */
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
   * Deduced from the InnerTube subtitle ("Album · …", "Single · …") — not a dedicated API field.
   * Absent / null = not recognized → treated as an album.
   */
  releaseType: albumReleaseTypeSchema.nullable().optional(),
  /** InnerTube badge `MUSIC_EXPLICIT_BADGE`. */
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

/** A genre or a mood from "Moods & genres": what is needed to display it, and the `params` that opens its page. */
export const exploreCategorySchema = z.object({
  title: z.string().min(1),
  params: z.string().min(1),
  /** The chip's color at YouTube Music (`#rrggbb`), if given. */
  color: z.string().regex(/^#[0-9a-f]{6}$/).nullable(),
})
export type YtmusicExploreCategory = z.infer<typeof exploreCategorySchema>

const exploreGroupSchema = z.object({ title: z.string(), categories: z.array(exploreCategorySchema) })

/** "For you" (personalized, sometimes absent), "Moods & moments", "Genres" — titles as YouTube localizes them. */
export const exploreSchema = z.object({
  forYou: exploreGroupSchema,
  moods: exploreGroupSchema,
  genres: exploreGroupSchema,
})
export type YtmusicExplore = z.infer<typeof exploreSchema>

/** A row of a category's page: tracks, OFFICIAL playlists, albums (neither videos nor user playlists). */
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
  /** Account linked (cookie file present and containing `__Secure-3PAPISID`). */
  linked: z.boolean(),
  /** Cookie present but refused by InnerTube (401 / login) — signing in again is needed. */
  cookieExpired: z.boolean(),
  /** PO Token generator reachable (`GET …/ping`). */
  poTokenOk: z.boolean(),
  /** Unofficial warning — always true in phase 1. */
  unofficial: z.literal(true),
  cookieFile: z.string().nullable(),
  poTokenUrl: z.string(),
  lastError: z.string().nullable(),
  /** Browsers accepted for `POST /cookie/from-browser` (none for a signed-in user). */
  browsers: z.array(z.string()),
  /** The account at stake: the signed-in user, or `null` for the house's. */
  user: z.string().nullable(),
  /** Signed-in user without a cookie: public catalog only, nothing personal. */
  anonymous: z.boolean(),
})
export type YtmusicStatus = z.infer<typeof statusSchema>
