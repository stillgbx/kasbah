import { deviceDescriptorSchema } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import {
  MEDIA_STATUS_IDLE, MEDIA_STATUS_PAUSED, MEDIA_STATUS_PLAYING, RECEIVER_STATUS_CHROMECAST_FIXED, RECEIVER_STATUS_LENOVO_IDLE,
  RECEIVER_STATUS_NEST_HUB_IDLE, RECEIVER_STATUS_PLAYING, RECEIVER_STATUS_SOUNDBAR_MUTED, SERVICE_CHROMECAST, SERVICE_LENOVO_CLOCK,
  SERVICE_NEST_HUB, SERVICE_SOUNDBAR, TXT_CHROMECAST, TXT_LENOVO_CLOCK, TXT_NEST_HUB, TXT_NEST_MINI,
} from './__fixtures__/network'
import { toCastService } from './discovery'
import { activeApplication, hasScreen, manufacturerOf, mediaPlayerClass, toDescriptor, toMediaPatch, toReceiverPatch } from './mapping'
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
    expect(hub.capabilities).toEqual(expect.arrayContaining(['playback', 'volume', 'mute', 'now_playing', 'track_skip']))

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
      nowPlaying: { title: 'Terracotta', artist: 'Mira Solano', album: 'Ochre', artUrl: expect.stringContaining('scdn'), durationS: 187.2, positionS: 42.5, source: 'Spotify' },
    })
    expect(toMediaPatch(media(MEDIA_STATUS_PAUSED), app)).toMatchObject({ playback: 'paused', nowPlaying: { positionS: 61 } })
    expect(toMediaPatch(media(MEDIA_STATUS_IDLE), app)).toEqual({ playback: 'idle', nowPlaying: null })
    expect(toMediaPatch(undefined, app)).toEqual({ playback: 'idle', nowPlaying: null })
    expect(toMediaPatch(media(MEDIA_STATUS_PLAYING), undefined)).toEqual({ playback: 'idle', nowPlaying: null })
  })

  it('falls back on subtitle then content id when the metadata is thin', () => {
    const app = activeApplication(receiver(RECEIVER_STATUS_PLAYING))
    const thin = media({ mediaSessionId: 2, playerState: 'BUFFERING', media: { contentId: 'https://radio.example/stream', metadata: { subtitle: 'Radio Nova' } } })
    expect(toMediaPatch(thin, app)).toEqual({ playback: 'playing', nowPlaying: { title: 'https://radio.example/stream', artist: 'Radio Nova', source: 'Spotify' } })
  })

  it('accepts the sound bar and the Lenovo clock as plain media players', () => {
    for (const s of [SERVICE_SOUNDBAR, SERVICE_LENOVO_CLOCK]) expect(deviceDescriptorSchema.safeParse(toDescriptor(s)).success).toBe(true)
  })
})
