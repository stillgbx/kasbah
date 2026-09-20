import { deviceDescriptorSchema } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import {
  MEDIA_STATUS_CRUNCHYROLL, MEDIA_STATUS_IDLE, MEDIA_STATUS_PAUSED, MEDIA_STATUS_PLAYING, MEDIA_STATUS_PRIME_VIDEO, MEDIA_STATUS_RADIO, RECEIVER_STATUS_CHROMECAST_FIXED,
  RECEIVER_STATUS_CRUNCHYROLL, RECEIVER_STATUS_LENOVO_IDLE, RECEIVER_STATUS_NEST_HUB_IDLE, RECEIVER_STATUS_NETFLIX, RECEIVER_STATUS_PLAYING, RECEIVER_STATUS_PRIME_VIDEO, RECEIVER_STATUS_RADIO, RECEIVER_STATUS_SOUNDBAR_MUTED, SERVICE_CHROMECAST, SERVICE_LENOVO_CLOCK,
  SERVICE_NEST_HUB, SERVICE_SOUNDBAR, TXT_CHROMECAST, TXT_LENOVO_CLOCK, TXT_NEST_HUB, TXT_NEST_MINI,
} from './__fixtures__/network'
import { toCastService } from './discovery'
import { activeApplication, artProxyUrl, hasScreen, isLive, manufacturerOf, mediaFromUrl, mediaPlayerClass, toDescriptor, toMediaPatch, toReceiverPatch } from './mapping'
import { mediaStatusSchema, receiverStatusSchema } from './types'

const receiver = (raw: unknown) => receiverStatusSchema.parse(raw)
const media = (raw: unknown) => mediaStatusSchema.parse(raw)

describe('google_cast mapping', () => {
  it('reads the mDNS TXT record and prefers the IPv4 address', () => {
    const s = toCastService({ txt: TXT_NEST_HUB, addresses: ['2a01:e0a:988:2f20::1', '192.168.1.128', 'fe80::1'], host: 'hub.local', port: 8009 })
    expect(s).toEqual({ host: '192.168.1.128', port: 8009, txt: expect.objectContaining({ id: TXT_NEST_HUB.id, fn: 'Réveil parents', md: 'Google Nest Hub' }) })
    expect(toCastService({ txt: { md: 'X' }, addresses: [], host: 'h', port: 1 })).toBeUndefined()
  })

  it('tells screens from audio-only devices by the capability mask', () => {
    expect(hasScreen(TXT_NEST_HUB)).toBe(true)
    expect(hasScreen(TXT_CHROMECAST)).toBe(true)
    expect(hasScreen(TXT_NEST_MINI)).toBe(false)
    expect(hasScreen(TXT_LENOVO_CLOCK)).toBe(false)
    expect(hasScreen({})).toBe(false)
  })

  it('classes a Chromecast as a TV, a Nest Hub as a display, the rest as speakers', () => {
    expect(mediaPlayerClass(TXT_CHROMECAST)).toBe('tv')
    expect(mediaPlayerClass({ md: 'BRAVIA 4K VH2', ca: '465413' })).toBe('tv')       // TV Android à Chromecast intégré
    expect(mediaPlayerClass(TXT_NEST_HUB)).toBe('display')
    expect(mediaPlayerClass(TXT_NEST_MINI)).toBe('speaker')
    expect(mediaPlayerClass(TXT_LENOVO_CLOCK)).toBe('speaker')
    expect(toDescriptor(SERVICE_CHROMECAST).meta.mediaPlayer).toEqual({ deviceClass: 'tv' })
    expect(toDescriptor(SERVICE_SOUNDBAR).meta.mediaPlayer).toEqual({ deviceClass: 'speaker' })
  })

  it('attributes Google models to Google and others to their brand', () => {
    expect(manufacturerOf('Google Nest Hub')).toBe('Google')
    expect(manufacturerOf('Chromecast')).toBe('Google')
    expect(manufacturerOf('Lenovo CD-4N341Y')).toBe('Lenovo')
    expect(manufacturerOf('Flexus Core 300')).toBe('Flexus')
    expect(manufacturerOf(undefined)).toBeUndefined()
  })

  it('builds a valid descriptor, with volume and mute unless the volume is fixed', () => {
    const hub = toDescriptor(SERVICE_NEST_HUB, receiver(RECEIVER_STATUS_NEST_HUB_IDLE).volume)
    expect(deviceDescriptorSchema.safeParse(hub).success).toBe(true)
    expect(hub).toMatchObject({ id: `google_cast:${TXT_NEST_HUB.id}`, kind: 'media_player', name: 'Réveil parents', meta: { manufacturer: 'Google', model: 'Google Nest Hub' } })
    expect(hub.capabilities).toEqual(expect.arrayContaining(['playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek', 'play_url']))

    const tv = toDescriptor(SERVICE_CHROMECAST, receiver(RECEIVER_STATUS_CHROMECAST_FIXED).volume)
    expect(tv.capabilities).not.toContain('volume')
    expect(tv.capabilities).not.toContain('mute')
    // avant la première connexion, on suppose réglable
    expect(toDescriptor(SERVICE_CHROMECAST).capabilities).toContain('volume')
  })

  it('maps the receiver volume to a percentage and keeps mute', () => {
    expect(toReceiverPatch(receiver(RECEIVER_STATUS_NEST_HUB_IDLE))).toEqual({ volume: 20, muted: false })
    expect(toReceiverPatch(receiver(RECEIVER_STATUS_LENOVO_IDLE))).toEqual({ volume: 0, muted: false })
    expect(toReceiverPatch(receiver(RECEIVER_STATUS_SOUNDBAR_MUTED))).toEqual({ volume: 16, muted: true })
    expect(toReceiverPatch(receiver({}))).toEqual({})
  })

  it('ignores the idle screen (Backdrop) but keeps a real application', () => {
    expect(activeApplication(receiver(RECEIVER_STATUS_NEST_HUB_IDLE))).toBeUndefined()
    expect(activeApplication(receiver(RECEIVER_STATUS_LENOVO_IDLE))).toBeUndefined()
    expect(activeApplication(receiver(RECEIVER_STATUS_PLAYING))).toMatchObject({ displayName: 'Spotify', transportId: '7a1b2c3d-0000-4000-8000-000000000002' })
    // une appli à la forme inattendue ne cache pas les autres
    expect(activeApplication(receiver({ applications: [{ appId: 'X' }, RECEIVER_STATUS_PLAYING.applications[0]] }))).toMatchObject({ displayName: 'Spotify' })
  })

  it('maps a media session to the now-playing track, and clears it when nothing plays', () => {
    const app = activeApplication(receiver(RECEIVER_STATUS_PLAYING))
    expect(toMediaPatch(media(MEDIA_STATUS_PLAYING), app)).toEqual({
      playback: 'playing',
      // la pochette passe par le serveur : URL relative de la route, l'originale encodée en paramètre
      nowPlaying: { title: 'Terracotta', artist: 'Mira Solano', album: 'Ochre', artUrl: artProxyUrl('https://i.scdn.co/image/ab67616d0000b273aaaaaaaaaaaaaaaaaaaaaaaa'), durationS: 187.2, positionS: 42.5, source: 'Spotify' },
    })
    expect(toMediaPatch(media(MEDIA_STATUS_PAUSED), app)).toMatchObject({ playback: 'paused', nowPlaying: { positionS: 61 } })
    expect(toMediaPatch(media(MEDIA_STATUS_IDLE), app)).toEqual({ playback: 'idle', nowPlaying: null })
    expect(toMediaPatch(undefined, app)).toEqual({ playback: 'idle', nowPlaying: null })
    expect(toMediaPatch(media(MEDIA_STATUS_PLAYING), undefined)).toEqual({ playback: 'idle', nowPlaying: null })
  })

  it('reports an app without a media channel as on screen, named, with no title (real Netflix capture)', () => {
    const app = activeApplication(receiver(RECEIVER_STATUS_NETFLIX))
    expect(app).toMatchObject({ displayName: 'Netflix' })
    expect(app?.transportId).toBeUndefined()
    expect(toMediaPatch(undefined, app)).toEqual({ playback: 'on', nowPlaying: { title: '', source: 'Netflix' } })
  })

  it('accepts the real radio capture: null duration, empty content id, live stream', () => {
    // capture réelle : `duration: null` faisait rejeter tout le message par le premier schéma
    expect(mediaStatusSchema.safeParse(MEDIA_STATUS_RADIO).success).toBe(true)
    const app = activeApplication(receiver(RECEIVER_STATUS_RADIO))
    expect(app).toMatchObject({ displayName: 'Radio France', statusText: 'Diffusion: franceinfo' })
    expect(toMediaPatch(media(MEDIA_STATUS_RADIO), app)).toEqual({
      playback: 'playing',
      // `live` : l'appareil dit `streamType: LIVE` — l'UI grise alors précédent / suivant / se placer
      nowPlaying: { title: 'franceinfo', artUrl: expect.stringContaining('radiofrance'), positionS: 38.243996, source: 'Radio France', live: true },
    })
    expect(isLive(media(MEDIA_STATUS_RADIO))).toBe(true)
    // un morceau ordinaire n'est pas un direct, et une durée absente ne suffit pas à en faire un
    expect(isLive(media(MEDIA_STATUS_PLAYING))).toBe(false)
    expect(isLive(media(MEDIA_STATUS_PRIME_VIDEO))).toBe(false)
    expect(isLive(undefined)).toBe(false)
    // sans métadonnées, le titre reste vide : la source (« Radio France ») suffit à l'UI
    const untitled = media({ ...MEDIA_STATUS_RADIO, media: { ...MEDIA_STATUS_RADIO.media, metadata: null } })
    expect(toMediaPatch(untitled, app)!.nowPlaying).toMatchObject({ title: '', source: 'Radio France' })
  })

  it('leaves the title EMPTY while the metadata are missing: never a content id, never the app name', () => {
    const app = activeApplication(receiver(RECEIVER_STATUS_PLAYING))
    // changement de morceau : le récepteur envoie l'id de la vidéo avant ses métadonnées
    const changing = media({ mediaSessionId: 2, playerState: 'BUFFERING', media: { contentId: 'NxHNlQsUooM' } })
    expect(toMediaPatch(changing, app)!.nowPlaying).toEqual({ title: '', source: 'Spotify' })
    const thin = media({ mediaSessionId: 2, playerState: 'BUFFERING', media: { contentId: 'https://radio.example/stream', metadata: { subtitle: 'Radio Nova' } } })
    expect(toMediaPatch(thin, app)).toEqual({ playback: 'playing', nowPlaying: { title: '', artist: 'Radio Nova', source: 'Spotify' } })
  })

  it('routes artwork through the server, original URL encoded', () => {
    expect(artProxyUrl('https://yt3.googleusercontent.com/a=b&c')).toBe('/api/plugins/google_cast/art?url=https%3A%2F%2Fyt3.googleusercontent.com%2Fa%3Db%26c')
  })

  it('treats a blank artist as absent (real Crunchyroll capture: episode title only, no image)', () => {
    const app = activeApplication(receiver(RECEIVER_STATUS_CRUNCHYROLL))
    expect(app).toMatchObject({ displayName: 'Crunchyroll' })
    expect(toMediaPatch(media(MEDIA_STATUS_CRUNCHYROLL), app)).toEqual({
      playback: 'playing',
      nowPlaying: { title: 'Un épisode de démonstration', durationS: 1442.066, positionS: 618.581, source: 'Crunchyroll' },
    })
  })

  it('accepts the real Prime Video capture: negative duration means unknown, the position stays', () => {
    // capture réelle sur une TV Android : `duration: -0.001` s'affichait « -1:-1 » de chaque côté du
    // curseur et écrasait la position (le curseur bornait la position à la durée)
    const app = activeApplication(receiver(RECEIVER_STATUS_PRIME_VIDEO))
    expect(app).toMatchObject({ displayName: 'Prime Video', appId: 'AndroidNativeApp' })
    const patch = toMediaPatch(media(MEDIA_STATUS_PRIME_VIDEO), app)
    // titre vide (l'appli n'en publie aucun) : c'est l'UI qui nomme l'appli, on n'invente rien ici
    expect(patch).toEqual({ playback: 'playing', nowPlaying: { title: '', positionS: 141.89, source: 'Prime Video' } })
    expect(patch!.nowPlaying).not.toHaveProperty('durationS')
    // une position négative n'existe pas non plus
    const backwards = media({ ...MEDIA_STATUS_PRIME_VIDEO, currentTime: -1 })
    expect(toMediaPatch(backwards, app)!.nowPlaying).not.toHaveProperty('positionS')
  })

  it('accepts the sound bar and the Lenovo clock as plain media players', () => {
    for (const s of [SERVICE_SOUNDBAR, SERVICE_LENOVO_CLOCK]) expect(deviceDescriptorSchema.safeParse(toDescriptor(s)).success).toBe(true)
  })

  it('guesses Cast LOAD media from the URL path', () => {
    expect(mediaFromUrl('https://icecast.radiofrance.fr/franceinfo-midfi.mp3')).toMatchObject({
      contentId: 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3',
      contentType: 'audio/mpeg',
      streamType: 'BUFFERED',
    })
    expect(mediaFromUrl('https://stream.example/live.m3u8?token=1')).toMatchObject({
      contentType: 'application/x-mpegurl',
      streamType: 'LIVE',
    })
    expect(mediaFromUrl('https://cdn.example/clip.mp4')).toMatchObject({ contentType: 'video/mp4', streamType: 'BUFFERED' })
  })
})
