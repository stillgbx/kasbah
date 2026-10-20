import type { Capability, DeviceDescriptor, MediaPlayerClass, StatePatch } from '@kasbah/shared'
import type { Enrichment } from './enrich/crunchyroll'
import { receiverApplicationSchema, type CastService, type MediaStatus, type ReceiverApplication, type ReceiverStatus } from './types'

// PURE mapping: mDNS service and receiver messages ↔ `media_player` descriptor / state patch.

export const PLUGIN_ID = 'google_cast'

/** Route (mounted under /api/plugins/google_cast) serving a cover downloaded and cached by the server. */
export const ART_ROUTE = '/api/plugins/google_cast/art'
/**
 * The cover goes through the server rather than being loaded by each screen directly from Google:
 * its image servers answer `429 Too Many Requests` after a few displays (observed), and an image
 * that failed left the background empty. The server downloads ONCE, caches, and retries with a
 * delay.
 */
export function artProxyUrl(url: string): string {
  return `${ART_ROUTE}?url=${encodeURIComponent(url)}`
}

/** Bit 0 of the `ca` mask: the device has a screen (Nest Hub, Chromecast); otherwise audio only. */
export function hasScreen(txt: { ca?: string }): boolean {
  const ca = Number(txt.ca)
  return Number.isFinite(ca) && (ca & 1) === 1
}

/**
 * Kind of player, from what the device announces: a video output whose screen is the device's own
 * (Nest Hub, Smart Display) is a `display`; any other video output is a TV or a box plugged into
 * one (Chromecast, Android TV: `tv`); without video, a speaker. A Chromecast's `fixed` volume
 * confirms the HDMI connection but is only known after connecting; the mDNS mask is enough and is
 * available from discovery onwards.
 */
export function mediaPlayerClass(txt: { md?: string; ca?: string }): MediaPlayerClass {
  if (!hasScreen(txt)) return 'speaker'
  return /\b(Nest Hub|Home Hub|Smart Display)\b/i.test(txt.md ?? '') ? 'display' : 'tv'
}

/** Google only brands its own models; "Chromecast built-in" on others keeps their brand. */
export function manufacturerOf(model: string | undefined): string | undefined {
  if (!model) return undefined
  if (/^(Google|Chromecast|Nest)\b/i.test(model)) return 'Google'
  return model.split(/\s+/)[0]
}

/**
 * A device's descriptor. The volume is adjustable except with `controlType: fixed` (Chromecast
 * plugged into a TV: the level is set on the TV, the receiver answers 1.00 whatever it is asked):
 * offering it a slider would promise a command with no effect. Before the first connection we do not
 * know that type: we assume adjustable, and the descriptor is republished if the device says no.
 */
export function toDescriptor(service: CastService, volume?: { controlType?: string }): DeviceDescriptor {
  const fixed = volume?.controlType === 'fixed'
  const capabilities: Capability[] = ['playback', 'now_playing', 'track_skip', 'seek', 'play_url', ...(fixed ? [] : ['volume', 'mute'] as Capability[])]
  const model = service.txt.md
  return {
    id: `${PLUGIN_ID}:${service.txt.id}`,
    pluginId: PLUGIN_ID,
    externalId: service.txt.id,
    kind: 'media_player',
    name: service.txt.fn,
    capabilities,
    meta: {
      ...(manufacturerOf(model) ? { manufacturer: manufacturerOf(model) } : {}),
      ...(model ? { model } : {}),
      mediaPlayer: { deviceClass: mediaPlayerClass(service.txt) },
      // the plugin remembers devices already seen (`known.ts`): one that has gone for good is
      // forgotten from the UI, otherwise it would stay listed forever
      forgettable: true,
    },
  }
}

/**
 * Completes a track with what the service's API has learned (title, series, season, number, poster): the series
 * takes the artist's place, "S1 · E10" the album's, the series poster the cover's (relayed).
 * What the device said takes priority when it said it.
 */
export function applyEnrichment(patch: StatePatch<'media_player'>, e: Enrichment): StatePatch<'media_player'> {
  const n = patch.nowPlaying
  if (!n) return patch
  const se = [typeof e.seasonNumber === 'number' ? `S${e.seasonNumber}` : '', typeof e.episodeNumber === 'number' ? `E${e.episodeNumber}` : ''].filter(Boolean).join(' · ')
  return {
    ...patch,
    nowPlaying: {
      ...n,
      // title missing on the device side (seen for real: metadata reduced to an empty artist) → the API's
      ...(!n.title && e.title ? { title: e.title } : {}),
      ...(!n.artist && e.series ? { artist: e.series } : {}),
      ...(!n.album && se ? { album: se } : {}),
      ...(!n.artUrl && e.artwork ? { artUrl: artProxyUrl(e.artwork) } : {}),
    },
  }
}

/** Fallback cover (app logo, relayed) on a track that has none; without a track, nothing to decorate. */
export function withFallbackArt(patch: StatePatch<'media_player'>, url: string): StatePatch<'media_player'> {
  if (!patch.nowPlaying || patch.nowPlaying.artUrl) return patch
  return { ...patch, nowPlaying: { ...patch.nowPlaying, artUrl: artProxyUrl(url) } }
}

/** Volume and mute, taken from a RECEIVER_STATUS. */
export function toReceiverPatch(status: ReceiverStatus): StatePatch<'media_player'> {
  const patch: StatePatch<'media_player'> = {}
  if (typeof status.volume?.level === 'number') patch.volume = Math.round(Math.min(1, Math.max(0, status.volume.level)) * 100)
  if (typeof status.volume?.muted === 'boolean') patch.muted = status.volume.muted
  return patch
}

/**
 * The running app, excluding the idle screen (Backdrop on a Nest Hub: it is the wallpaper, nothing is
 * playing). Validated separately: an app with an unexpected shape must not hide the volume.
 */
export function activeApplication(status: ReceiverStatus): ReceiverApplication | undefined {
  for (const raw of status.applications ?? []) {
    const app = receiverApplicationSchema.safeParse(raw)
    if (app.success && !app.data.isIdleScreen) return app.data
  }
  return undefined
}

/**
 * A duration only makes sense when positive. Observed on an Android TV: Prime Video sends `-0.001`, a
 * live radio `null` — two ways of saying "unknown", which we handle the same (no slider, no total
 * time, the position stays displayed).
 */
export const isDuration = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/**
 * LIVE stream, as the device declares it (`streamType: LIVE` — observed on the franceinfo radio).
 * It is the only reliable sign, and above all NOT `supportedMediaCommands`, which is wrong both ways:
 * the Radio France app announces SEEK, previous and next track (12495) on a live stream where none
 * of the three makes sense, while Crunchyroll (143) omits "next track" even though it works for real.
 * Using it to gray out a button would therefore break commands that work.
 * A missing duration says nothing more than "unknown" (Prime Video says as much of a movie).
 */
export const isLive = (media: MediaStatus | undefined): boolean => media?.media?.streamType === 'LIVE'

export function toPlayback(playerState: string | undefined): 'playing' | 'paused' | 'idle' {
  switch (playerState) {
    case 'PLAYING': case 'BUFFERING': return 'playing'
    case 'PAUSED': return 'paused'
    default: return 'idle'
  }
}

/**
 * Playback and current track. Without an app or without a media session: `idle`, and
 * `nowPlaying: null` to CLEAR the previous track (a patch without the key would leave it displayed).
 * An app without a media channel (native Netflix): `on`, with the app as the only information — no
 * title, no position, and neither playing nor paused that we could assert.
 */
export function toMediaPatch(media: MediaStatus | undefined, app: ReceiverApplication | undefined): StatePatch<'media_player'> {
  if (!app) return { playback: 'idle', nowPlaying: null }
  if (!app.transportId) return { playback: 'on', nowPlaying: { title: '', ...(app.displayName ? { source: app.displayName } : {}) } }
  if (!media) return { playback: 'idle', nowPlaying: null }
  const playback = toPlayback(media.playerState)
  const m = media.media?.metadata
  if (playback === 'idle' || !media.media) return { playback, nowPlaying: null }
  // `||` and not `??`, and `clean`: empty fields, `null` or made of spaces (Crunchyroll sends
  // `artist: " "`) count as "absent" — otherwise a blank line took the source's place.
  // The title is the metadata title, or NOTHING (`''`): neither `contentId` (an identifier — YouTube
  // video id, Spotify URI — that arrives BEFORE the metadata on every track change, we saw
  // "NxHNlQsUooM" for a second), nor the app name (it is already in `source`, the UI repeated it
  // three times). Empty title = "pending": the UI shows a discreet marker until it arrives.
  const clean = (v: string | null | undefined) => v?.trim() || undefined
  const artist = clean(m?.artist) || clean(m?.albumArtist) || clean(m?.subtitle)
  const album = clean(m?.albumName)
  const art = clean(m?.images?.[0]?.url)
  return {
    playback,
    nowPlaying: {
      // Empty title = unknown, and for a NATIVE Android TV app (Prime Video: `AndroidNativeApp`,
      // `title: ""` and an Amazon id for every content) it will never come. The UI decides what to show
      // in its place (the app name), without inventing a title here.
      title: clean(m?.title) ?? '',
      ...(artist ? { artist } : {}),
      ...(album ? { album } : {}),
      ...(art ? { artUrl: artProxyUrl(art) } : {}),
      // Duration kept only if POSITIVE: Prime Video announces `duration: -0.001` to say "unknown"
      // (where a live radio says `null`), and a negative duration showed "-1:-1" on each side of the
      // slider, overwriting the position. Same for a negative position.
      ...(isDuration(media.media.duration) ? { durationS: media.media.duration } : {}),
      ...(typeof media.currentTime === 'number' && media.currentTime >= 0 ? { positionS: media.currentTime } : {}),
      ...(app.displayName ? { source: app.displayName } : {}),
      // a live stream says so: the UI grays out previous / next / seek, which cut the stream
      ...(isLive(media) ? { live: true } : {}),
    },
  }
}

/** Cast default media receiver (`LOAD` of an HTTP URL) — not the YouTube / Spotify app. */
export const DEFAULT_MEDIA_RECEIVER = 'CC1AD845'

export type CastLoadMedia = {
  contentId: string
  contentType: string
  streamType: 'BUFFERED' | 'LIVE'
  metadata: {
    metadataType: 0
    title: string
    subtitle?: string
    images?: { url: string }[]
  }
}

/** Optional metadata for `play_url` (title / artist / cover). */
export type PlayUrlMeta = { title?: string; artist?: string; artUrl?: string; explicit?: boolean; live?: boolean }

/**
 * What the default media receiver wants in `LOAD.media`: MIME type and `LIVE` vs `BUFFERED` from the
 * path (HLS = live). A URL without an extension is an MP3: that is the case of Icecast web radios
 * (franceinfo-midfi.mp3) as well as of a bare file. Without `meta.title`, the URL's hostname.
 */
export function mediaFromUrl(url: string, meta?: PlayUrlMeta): CastLoadMedia {
  let path = url
  try { path = new URL(url).pathname } catch { /* keep the string */ }
  const lower = path.toLowerCase()
  const hls = lower.endsWith('.m3u8') || lower.endsWith('.m3u')
  const live = hls || meta?.live === true
  let contentType = 'audio/mpeg'
  if (hls) contentType = 'application/x-mpegurl'
  else if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) contentType = 'video/mp4'
  else if (lower.endsWith('.m4a') || lower.endsWith('.aac')) contentType = 'audio/mp4'
  else if (lower.endsWith('.flac')) contentType = 'audio/flac'
  else if (lower.endsWith('.ogg') || lower.endsWith('.opus')) contentType = 'audio/ogg'
  else if (lower.endsWith('.wav')) contentType = 'audio/wav'
  let title = 'Stream'
  try { title = new URL(url).hostname || title } catch { /* */ }
  if (meta?.title?.trim()) title = meta.title.trim()
  const metadata: CastLoadMedia['metadata'] = { metadataType: 0, title }
  if (meta?.artist?.trim()) metadata.subtitle = meta.artist.trim()
  if (meta?.artUrl?.trim()) metadata.images = [{ url: meta.artUrl.trim() }]
  return { contentId: url, contentType, streamType: live ? 'LIVE' : 'BUFFERED', metadata }
}
