import type { Capability, DeviceDescriptor, MediaPlayerClass, StatePatch } from '@kasbah/shared'
import type { Enrichment } from './enrich/crunchyroll'
import { receiverApplicationSchema, type CastService, type MediaStatus, type ReceiverApplication, type ReceiverStatus } from './types'

// Mappage PUR : service mDNS et messages du récepteur ↔ descripteur / patch d'état `media_player`.

export const PLUGIN_ID = 'google_cast'

/** Route (montée sous /api/plugins/google_cast) qui sert une pochette téléchargée et mise en cache par le serveur. */
export const ART_ROUTE = '/api/plugins/google_cast/art'
/**
 * La pochette passe par le serveur plutôt que d'être chargée par chaque tablette directement chez
 * Google : ses serveurs d'images répondent `429 Too Many Requests` au bout de quelques affichages
 * (constaté), et une image qui échoue laissait le fond vide. Le serveur télécharge UNE fois, garde
 * en cache et réessaie avec un délai.
 */
export function artProxyUrl(url: string): string {
  return `${ART_ROUTE}?url=${encodeURIComponent(url)}`
}

/** Bit 0 du masque `ca` : l'appareil a un écran (Nest Hub, Chromecast) ; sinon audio seul. */
export function hasScreen(txt: { ca?: string }): boolean {
  const ca = Number(txt.ca)
  return Number.isFinite(ca) && (ca & 1) === 1
}

/**
 * Nature du lecteur, d'après ce que l'appareil annonce : une sortie vidéo dont l'écran est celui de
 * l'appareil (Nest Hub, Smart Display) est un `display` ; toute autre sortie vidéo est un téléviseur
 * ou un boîtier branché dessus (Chromecast, TV Android : `tv`) ; sans vidéo, une enceinte.
 * Le volume `fixed` d'un Chromecast confirme le branchement HDMI mais n'est connu qu'après
 * connexion ; le masque mDNS suffit et est disponible dès la découverte.
 */
export function mediaPlayerClass(txt: { md?: string; ca?: string }): MediaPlayerClass {
  if (!hasScreen(txt)) return 'speaker'
  return /\b(Nest Hub|Home Hub|Smart Display)\b/i.test(txt.md ?? '') ? 'display' : 'tv'
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
  const capabilities: Capability[] = ['playback', 'now_playing', 'track_skip', 'seek', ...(fixed ? [] : ['volume', 'mute'] as Capability[])]
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
      // le plugin retient les appareils déjà vus (`known.ts`) : celui qui a disparu pour de bon
      // s'oublie depuis l'UI, sinon il resterait listé pour toujours
      forgettable: true,
    },
  }
}

/**
 * Complète un morceau avec ce que l'API du service a appris (titre, série, saison, numéro, affiche) : la série
 * prend la place de l'artiste, « S1 · E10 » celle de l'album, l'affiche de la série celle de la pochette (relayée).
 * Ce que l'appareil a dit reste prioritaire quand il l'a dit.
 */
export function applyEnrichment(patch: StatePatch<'media_player'>, e: Enrichment): StatePatch<'media_player'> {
  const n = patch.nowPlaying
  if (!n) return patch
  const se = [typeof e.seasonNumber === 'number' ? `S${e.seasonNumber}` : '', typeof e.episodeNumber === 'number' ? `E${e.episodeNumber}` : ''].filter(Boolean).join(' · ')
  return {
    ...patch,
    nowPlaying: {
      ...n,
      // titre absent côté appareil (vu en réel : métadonnées réduites à un artiste vide) → celui de l'API
      ...(!n.title && e.title ? { title: e.title } : {}),
      ...(!n.artist && e.series ? { artist: e.series } : {}),
      ...(!n.album && se ? { album: se } : {}),
      ...(!n.artUrl && e.artwork ? { artUrl: artProxyUrl(e.artwork) } : {}),
    },
  }
}

/** Pochette de repli (logo de l'appli, relayé) sur un morceau qui n'en a pas ; sans morceau, rien à décorer. */
export function withFallbackArt(patch: StatePatch<'media_player'>, url: string): StatePatch<'media_player'> {
  if (!patch.nowPlaying || patch.nowPlaying.artUrl) return patch
  return { ...patch, nowPlaying: { ...patch.nowPlaying, artUrl: artProxyUrl(url) } }
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
 * pour EFFACER le morceau précédent (un patch sans la clé le laisserait affiché). Une appli sans canal
 * média (Netflix natif) : `on`, avec l'appli pour seule information — pas de titre, pas de position,
 * et ni lecture ni pause qu'on puisse affirmer.
 */
export function toMediaPatch(media: MediaStatus | undefined, app: ReceiverApplication | undefined): StatePatch<'media_player'> {
  if (!app) return { playback: 'idle', nowPlaying: null }
  if (!app.transportId) return { playback: 'on', nowPlaying: { title: '', ...(app.displayName ? { source: app.displayName } : {}) } }
  if (!media) return { playback: 'idle', nowPlaying: null }
  const playback = toPlayback(media.playerState)
  const m = media.media?.metadata
  if (playback === 'idle' || !media.media) return { playback, nowPlaying: null }
  // `||` et non `??`, et `clean` : les champs vides, `null` ou faits d'espaces (Crunchyroll envoie
  // `artist: " "`) valent « absent » — sinon une ligne blanche prenait la place de la source.
  // Le titre est le titre des métadonnées, ou RIEN (`''`) : ni `contentId` (identifiant — id de vidéo
  // YouTube, URI Spotify — qui arrive AVANT les métadonnées à chaque changement de morceau, on voyait
  // « NxHNlQsUooM » une seconde), ni le nom de l'appli (il est déjà dans `source`, l'UI le répétait
  // trois fois). Titre vide = « en attente » : l'UI affiche un repère discret le temps qu'il arrive.
  const clean = (v: string | null | undefined) => v?.trim() || undefined
  const artist = clean(m?.artist) || clean(m?.albumArtist) || clean(m?.subtitle)
  const album = clean(m?.albumName)
  const art = clean(m?.images?.[0]?.url)
  return {
    playback,
    nowPlaying: {
      title: clean(m?.title) ?? '',
      ...(artist ? { artist } : {}),
      ...(album ? { album } : {}),
      ...(art ? { artUrl: artProxyUrl(art) } : {}),
      ...(typeof media.media.duration === 'number' ? { durationS: media.media.duration } : {}),
      ...(typeof media.currentTime === 'number' ? { positionS: media.currentTime } : {}),
      ...(app.displayName ? { source: app.displayName } : {}),
    },
  }
}
