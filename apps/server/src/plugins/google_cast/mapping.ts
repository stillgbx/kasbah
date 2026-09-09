import type { Capability, DeviceDescriptor, StatePatch } from '@kasbah/shared'
import { receiverApplicationSchema, type CastService, type MediaStatus, type ReceiverApplication, type ReceiverStatus } from './types'

// Mappage PUR : service mDNS et messages du récepteur ↔ descripteur / patch d'état `media_player`.

export const PLUGIN_ID = 'google_cast'

/** Bit 0 du masque `ca` : l'appareil a un écran (Nest Hub, Chromecast) ; sinon audio seul. */
export function hasScreen(txt: { ca?: string }): boolean {
  const ca = Number(txt.ca)
  return Number.isFinite(ca) && (ca & 1) === 1
}

/** Google ne signe que ses propres modèles ; « Chromecast built-in » chez les autres garde leur marque. */
export function manufacturerOf(model: string | undefined): string | undefined {
  if (!model) return undefined
  if (/^(Google|Chromecast|Nest)\b/i.test(model)) return 'Google'
  return model.split(/\s+/)[0]
}

/**
 * Descripteur d'un appareil. Le volume est réglable sauf `controlType: fixed` (Chromecast branché sur
 * une TV : le niveau se règle sur la TV, le récepteur répond 1.00 quoi qu'on lui demande) : lui
 * proposer un curseur promettrait une commande sans effet. Avant la première connexion on ne
 * connaît pas ce type : on suppose réglable, le descripteur est republié si l'appareil dit non.
 */
export function toDescriptor(service: CastService, volume?: { controlType?: string }): DeviceDescriptor {
  const fixed = volume?.controlType === 'fixed'
  const capabilities: Capability[] = ['playback', 'now_playing', 'track_skip', ...(fixed ? [] : ['volume', 'mute'] as Capability[])]
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
    },
  }
}

/** Volume et muet, tirés d'un RECEIVER_STATUS. */
export function toReceiverPatch(status: ReceiverStatus): StatePatch<'media_player'> {
  const patch: StatePatch<'media_player'> = {}
  if (typeof status.volume?.level === 'number') patch.volume = Math.round(Math.min(1, Math.max(0, status.volume.level)) * 100)
  if (typeof status.volume?.muted === 'boolean') patch.muted = status.volume.muted
  return patch
}

/**
 * L'appli qui tourne, hors écran de veille (Backdrop sur un Nest Hub : c'est le fond d'écran, rien
 * ne joue). Validée à part : une appli à la forme inattendue ne doit pas cacher le volume.
 */
export function activeApplication(status: ReceiverStatus): ReceiverApplication | undefined {
  for (const raw of status.applications ?? []) {
    const app = receiverApplicationSchema.safeParse(raw)
    if (app.success && !app.data.isIdleScreen) return app.data
  }
  return undefined
}

export function toPlayback(playerState: string | undefined): 'playing' | 'paused' | 'idle' {
  switch (playerState) {
    case 'PLAYING': case 'BUFFERING': return 'playing'
    case 'PAUSED': return 'paused'
    default: return 'idle'
  }
}

/**
 * Lecture et morceau en cours. Sans appli ou sans session média : `idle`, et `nowPlaying: null`
 * pour EFFACER le morceau précédent (un patch sans la clé le laisserait affiché).
 */
export function toMediaPatch(media: MediaStatus | undefined, app: ReceiverApplication | undefined): StatePatch<'media_player'> {
  if (!media || !app) return { playback: 'idle', nowPlaying: null }
  const playback = toPlayback(media.playerState)
  const m = media.media?.metadata
  if (playback === 'idle' || !media.media) return { playback, nowPlaying: null }
  const artist = m?.artist ?? m?.albumArtist ?? m?.subtitle
  const art = m?.images?.[0]?.url
  return {
    playback,
    nowPlaying: {
      title: m?.title ?? media.media.contentId ?? app.displayName ?? '',
      ...(artist ? { artist } : {}),
      ...(m?.albumName ? { album: m.albumName } : {}),
      ...(art ? { artUrl: art } : {}),
      ...(typeof media.media.duration === 'number' ? { durationS: media.media.duration } : {}),
      ...(typeof media.currentTime === 'number' ? { positionS: media.currentTime } : {}),
      ...(app.displayName ? { source: app.displayName } : {}),
    },
  }
}
