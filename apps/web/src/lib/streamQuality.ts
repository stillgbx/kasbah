import type { StateFor } from '@kasbah/shared'
import type { MusicStreamQuality, RadioStation } from '../api/transport'

// A player's stream quality, in one line ("MP3 192 kb/s") and as a tooltip. Two origins:
// - a stream served by Kasbah (YouTube Music, Mixcloud): what the proxy serves, and in the tooltip what
//   the source gave it to produce it;
// - a radio: the stream goes from the station to the speaker, which says nothing — codec and bitrate are those
//   that the directory announces, for the station the radio plugin started on this player.
// Shared by the Music page bar and the device panel.

type Translate = (key: string, named?: Record<string, unknown>) => string

const NBSP = String.fromCharCode(0xa0)
const MIME_LABELS: Record<string, string> = { 'audio/mpeg': 'MP3', 'audio/mp4': 'AAC', 'audio/webm': 'Opus', 'audio/ogg': 'Opus' }

const withBitrate = (label: string, kbps: number | null | undefined) =>
  (kbps ? [label, `${kbps}${NBSP}kb/s`].filter(Boolean).join(' ') : label)

export function qualityLabel(q: MusicStreamQuality): string {
  return withBitrate(MIME_LABELS[q.mime] ?? q.mime, q.bitrateKbps)
}

export function qualityDetails(q: MusicStreamQuality, t: Translate): string {
  const parts = [
    ...(q.sampleRateHz ? [`${q.sampleRateHz / 1000}${NBSP}kHz`] : []),
    ...(q.channels ? [q.channels === 2 ? t('music.stereo') : `${q.channels} ch`] : []),
  ]
  if (q.lengthBytes) parts.push(t('music.megabytes', { size: (q.lengthBytes / 1_000_000).toFixed(1) }))
  if (q.source) {
    const src = [q.source.ext?.toUpperCase(), q.source.abrKbps ? `${q.source.abrKbps}${NBSP}kb/s` : null].filter(Boolean).join(' ')
    if (src) parts.push(t('music.streamSource', { format: src }))
  }
  return parts.join(' · ')
}

/**
 * A player's quality line, or null. `ours`: the quality of OUR stream if it is playing one;
 * `station`: the last station started on this player — kept only if it still publishes a
 * live stream under its name (it may have moved on to something else since).
 */
export function streamQuality(
  t: Translate,
  ours: MusicStreamQuality | null | undefined,
  state: StateFor<'media_player'> | undefined,
  station: RadioStation | null | undefined,
): { label: string; hint?: string } | null {
  if (ours) return { label: qualityLabel(ours), hint: qualityDetails(ours, t) || undefined }
  const n = state?.nowPlaying
  if (!station || n?.live !== true || n.title !== station.name) return null
  const label = withBitrate(station.codec ?? '', station.bitrateKbps)
  return label ? { label, hint: t('radio.qualityHint') } : null
}
