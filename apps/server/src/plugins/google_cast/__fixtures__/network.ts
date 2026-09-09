import type { CastService } from '../types'

// Relevé du 2026-09-09 sur le réseau réel (11 appareils) : enregistrements TXT mDNS et réponses
// RECEIVER_STATUS telles que reçues, identifiants et adresses anonymisés. Les bizarreries sont
// gardées : `rs` absent partout, `stepInterval` en flottant approximatif, Backdrop déclaré comme
// appli sur les Nest Hub au repos, volume `fixed` à 1.00 sur les Chromecast branchés à une TV.

export const TXT_NEST_HUB = {
  id: 'dbd928f3aaaaaaaaaaaaaaaaaaaaaaaa', cd: 'C0FFEE', rm: '', ve: '05', md: 'Google Nest Hub',
  ic: '/setup/icon.png', fn: 'Réveil parents', ca: '231941', st: '0', bs: 'FA8FCA000000', nf: '1', rs: '',
}
export const TXT_NEST_MINI = {
  id: '6866cf98bbbbbbbbbbbbbbbbbbbbbbbb', cd: 'C0FFEE', rm: '', ve: '05', md: 'Google Nest Mini',
  ic: '/setup/icon.png', fn: 'Cuisine', ca: '198660', st: '0', bs: 'FA8FCA000001', nf: '1', rs: '',
}
export const TXT_CHROMECAST = {
  id: 'bd68775fcccccccccccccccccccccccc', cd: 'C0FFEE', rm: '', ve: '05', md: 'Chromecast',
  ic: '/setup/icon.png', fn: "Chambre 3", ca: '465413', st: '0', bs: 'FA8FCA000002', nf: '1', rs: '',
}
export const TXT_LENOVO_CLOCK = {
  id: '4170ee74dddddddddddddddddddddddd', cd: 'C0FFEE', rm: '', ve: '05', md: 'Lenovo CD-4N341Y',
  ic: '/setup/icon.png', fn: 'Réveil chambre 3', ca: '207364', st: '0', bs: 'FA8FCA000003', nf: '1', rs: '',
}
export const TXT_SOUNDBAR = {
  id: 'c6c7c6faeeeeeeeeeeeeeeeeeeeeeeee', cd: 'C0FFEE', rm: '', ve: '05', md: 'Flexus Core 300',
  ic: '/setup/icon.png', fn: 'Barre de son Salon', ca: '198660', st: '0', bs: 'FA8FCA000004', nf: '1', rs: '',
}

export const SERVICE_NEST_HUB: CastService = { host: '192.168.1.128', port: 8009, txt: TXT_NEST_HUB }
export const SERVICE_NEST_MINI: CastService = { host: '192.168.1.93', port: 8009, txt: TXT_NEST_MINI }
export const SERVICE_CHROMECAST: CastService = { host: '192.168.1.43', port: 8009, txt: TXT_CHROMECAST }
export const SERVICE_LENOVO_CLOCK: CastService = { host: '192.168.1.96', port: 8009, txt: TXT_LENOVO_CLOCK }
export const SERVICE_SOUNDBAR: CastService = { host: '192.168.1.14', port: 8009, txt: TXT_SOUNDBAR }

/** Nest Hub au repos : Backdrop (fond d'écran) est déclaré comme appli, `isIdleScreen: true`. */
export const RECEIVER_STATUS_NEST_HUB_IDLE = {
  applications: [{
    appId: 'E8C28D3C', appType: 'WEB', displayName: 'Backdrop', iconUrl: '', isIdleScreen: true,
    launchedFromCloud: false, namespaces: [{ name: 'urn:x-cast:com.google.cast.sse' }, { name: 'urn:x-cast:com.google.cast.cac' }],
    sessionId: 'e2d7f6e4-0000-4000-8000-000000000001', statusText: '', transportId: 'e2d7f6e4-0000-4000-8000-000000000001',
    universalAppId: 'E8C28D3C',
  }],
  userEq: {}, volume: { controlType: 'master', level: 0.20000000298023224, muted: false, stepInterval: 0.019999999552965164 },
}

/** Réveil Lenovo au repos : pas d'appli du tout, volume à zéro. */
export const RECEIVER_STATUS_LENOVO_IDLE = {
  userEq: {}, volume: { controlType: 'master', level: 0, muted: false, stepInterval: 0.019999999552965164 },
}

/** Chromecast sur une TV : volume `fixed`, toujours 1.00 — le niveau se règle sur la TV. */
export const RECEIVER_STATUS_CHROMECAST_FIXED = {
  userEq: {}, volume: { controlType: 'fixed', level: 1, muted: false, stepInterval: 0.03999999910593033 },
}

/** Barre de son au repos, en sourdine. */
export const RECEIVER_STATUS_SOUNDBAR_MUTED = {
  userEq: {}, volume: { controlType: 'master', level: 0.1599999964237213, muted: true, stepInterval: 0.019999999552965164 },
}

/**
 * Enceinte en lecture depuis l'appli Spotify (RECEIVER_STATUS) puis MEDIA_STATUS de la session.
 * ATTENTION : forme DÉDUITE de la référence Cast (messages MediaStatus / MusicTrackMediaMetadata),
 * aucune lecture Spotify n'ayant été relevée. Une capture RÉELLE existe plus bas (`*_RADIO`) : à
 * remplacer celle-ci aussi dès qu'un morceau à durée joue (`GET /api/plugins/google_cast/raw`).
 */
export const RECEIVER_STATUS_PLAYING = {
  applications: [{
    appId: 'CC32E753', appType: 'WEB', displayName: 'Spotify', iconUrl: '', isIdleScreen: false,
    launchedFromCloud: true, namespaces: [{ name: 'urn:x-cast:com.google.cast.media' }, { name: 'urn:x-cast:com.spotify.chromecast.secure.v1' }],
    sessionId: '7a1b2c3d-0000-4000-8000-000000000002', statusText: 'Spotify', transportId: '7a1b2c3d-0000-4000-8000-000000000002',
    universalAppId: 'CC32E753',
  }],
  userEq: {}, volume: { controlType: 'master', level: 0.44999998807907104, muted: false, stepInterval: 0.019999999552965164 },
}

export const MEDIA_STATUS_PLAYING = {
  mediaSessionId: 1, playbackRate: 1, playerState: 'PLAYING', currentTime: 42.5, supportedMediaCommands: 274447,
  volume: { level: 1, muted: false }, currentItemId: 1, repeatMode: 'REPEAT_OFF',
  media: {
    contentId: 'spotify:track:0000000000000000000000', streamType: 'BUFFERED', contentType: 'application/x-spotify.track',
    metadata: {
      metadataType: 3, title: 'Terracotta', artist: 'Mira Solano', albumName: 'Ochre',
      images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273aaaaaaaaaaaaaaaaaaaaaaaa', height: 640, width: 640 }],
    },
    duration: 187.2,
  },
}

export const MEDIA_STATUS_PAUSED = { ...MEDIA_STATUS_PLAYING, playerState: 'PAUSED', currentTime: 61 }

/**
 * CAPTURE RÉELLE (2026-09-09, `GET /api/plugins/google_cast/raw`) : le Nest Mini de la cuisine joue une
 * radio lancée à la voix. À garder tel quel, bizarreries comprises : `duration: null` (direct),
 * `contentId: ""` (l'URL est dans `contentUrl`), une piste `VIDEO` sur un flux audio, un `items[]`
 * dont le média est presque vide. Le premier schéma exigeait un nombre pour `duration` : tout le
 * message était rejeté et l'enceinte restait « au repos ».
 */
export const RECEIVER_STATUS_RADIO = {
  volume: { level: 0.30000001192092896, muted: false, controlType: 'master', stepInterval: 0.019999999552965164 },
  applications: [{
    appId: '0A236DD3', appType: 'WEB', displayName: 'Radio France', iconUrl: 'https://lh3.googleusercontent.com/anonymised',
    isIdleScreen: false, launchedFromCloud: true,
    namespaces: [{ name: 'urn:x-cast:com.google.cast.debugoverlay' }, { name: 'urn:x-cast:com.google.cast.cac' }, { name: 'urn:x-cast:com.google.cast.media' }],
    senderConnected: true, sessionId: 'a725691c-0000-4000-8000-000000000003', statusText: 'Diffusion: franceinfo',
    transportId: 'a725691c-0000-4000-8000-000000000003', universalAppId: '0A236DD3',
  }],
  version: 2,
}

export const MEDIA_STATUS_RADIO = {
  mediaSessionId: 1, playbackRate: 1, playerState: 'PLAYING', currentTime: 38.243996, supportedMediaCommands: 12495,
  volume: { level: 1, muted: false }, activeTrackIds: [],
  media: {
    contentId: '', contentUrl: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3', streamType: 'LIVE', mediaCategory: 'AUDIO',
    contentType: 'audio/mp3',
    metadata: { metadataType: 3, title: 'franceinfo', images: [{ url: 'https://www.radiofrance.fr/s3/anonymised/1000x1000_sc_rf_omm_l00002_ite.jpg' }] },
    entity: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3', duration: null, tracks: [{ trackId: 1, type: 'VIDEO' }], breaks: [], breakClips: [],
  },
  currentItemId: 1,
  items: [{ itemId: 1, media: { contentId: '', streamType: 'NONE', contentType: '', entity: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3', duration: null }, autoplay: true, orderId: 0 }],
  repeatMode: 'REPEAT_OFF',
}

/** Fin de file : la session existe encore mais plus rien à jouer. */
export const MEDIA_STATUS_IDLE = { mediaSessionId: 1, playbackRate: 1, playerState: 'IDLE', currentTime: 0, idleReason: 'FINISHED', supportedMediaCommands: 0, volume: { level: 1, muted: false } }
