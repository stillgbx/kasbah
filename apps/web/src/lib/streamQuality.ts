import type { StateFor } from '@kasbah/shared'
import type { MusicStreamQuality, RadioStation } from '../api/transport'

// Qualité du flux d'un lecteur, en une ligne (« MP3 192 kb/s ») et en info-bulle. Deux origines :
// - un flux servi par Kasbah (YouTube Music, Mixcloud) : ce que le proxy sert, et en info-bulle ce
//   que la source lui a donné pour le produire ;
// - une radio : le flux va de la station à l'enceinte, qui ne dit rien — codec et débit sont ceux
//   que l'annuaire annonce, pour la station que le plugin radio a lancée sur ce lecteur.
// Partagé par la barre de la page Musique et le panneau appareil.

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
 * La ligne de qualité d'un lecteur, ou null. `ours` : la qualité de NOTRE flux s'il en joue un ;
 * `station` : la dernière station lancée sur ce lecteur — retenue seulement s'il publie encore un
 * direct à son nom (il a pu passer à autre chose depuis).
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
