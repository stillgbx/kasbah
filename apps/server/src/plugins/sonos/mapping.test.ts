import { deviceDescriptorSchema } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import {
  DESC_PORT, DESC_PLAY3, DIDL_ALBUM, DIDL_TRACK, HLS_ART, HOST_PORT, HOST_PLAY3, SOAP_MUTE_0, SOAP_MUTE_1,
  SOAP_PAUSED, SOAP_PLAYING, SOAP_POSITION_ALBUM, SOAP_POSITION_IDLE, SOAP_POSITION_PLAYING, SOAP_STOPPED,
  SOAP_VOLUME_21, SOAP_ZONES,
  SSDP_PLAY3, SSDP_PORT, UUID_PLAY3, UUID_PORT, ZP_PLAY3, ZP_PORT,
} from './__fixtures__/network'
import {
  artProxyUrl, formatSonosTime, overlayStreamMeta, parseDeviceDescription, parseDidl, parseMute, parsePosition, parseSonosTime,
  parseSsdpHeaders, parseTransport, parseVolume, parseZoneMembers, parseZpInfo, streamLoad, toDescriptor,
  toPlayback, toStatePatch, uuidFromUsn,
} from './mapping'

describe('sonos mapping', () => {
  it('reads the SSDP USN captured on the Port and the Play:3', () => {
    expect(parseSsdpHeaders(SSDP_PORT)).toEqual({ uuid: UUID_PORT, host: HOST_PORT })
    expect(parseSsdpHeaders(SSDP_PLAY3)).toEqual({ uuid: UUID_PLAY3, host: HOST_PLAY3 })
    expect(parseSsdpHeaders('HTTP/1.1 200 OK\r\nST: upnp:rootdevice\r\nUSN: uuid:abc::upnp:rootdevice\r\n')).toBeUndefined()
    expect(uuidFromUsn(`uuid:${UUID_PORT}::urn:schemas-upnp-org:device:ZonePlayer:1`)).toBe(UUID_PORT)
  })

  it('reads /status/zp (XML, not the empty /status/info)', () => {
    expect(parseZpInfo(ZP_PORT)).toEqual({ uuid: UUID_PORT, name: 'Bureau', softwareVersion: '97.1-80312' })
    expect(parseZpInfo(ZP_PLAY3)).toEqual({ uuid: UUID_PLAY3, name: 'Cuisine', softwareVersion: '83.1-61210' })
    expect(parseZpInfo('<ZPSupportInfo></ZPSupportInfo>')).toBeUndefined()
  })

  it('reads modelName from the captured device description', () => {
    expect(parseDeviceDescription(DESC_PORT)).toEqual({ model: 'Sonos Port', modelNumber: 'S23', name: 'Bureau' })
    expect(parseDeviceDescription(DESC_PLAY3)).toEqual({ model: 'Sonos Play:3', modelNumber: 'S3', name: 'Cuisine' })
  })

  it('lists both players from the captured ZoneGroupState (two groups of one)', () => {
    const members = parseZoneMembers(SOAP_ZONES)
    expect(members).toEqual([
      { uuid: UUID_PORT, host: HOST_PORT, name: 'Bureau', coordinatorUuid: UUID_PORT },
      { uuid: UUID_PLAY3, host: HOST_PLAY3, name: 'Cuisine', coordinatorUuid: UUID_PLAY3 },
    ])
  })

  it('reads volume, mute and transport from the captured SOAP', () => {
    expect(parseVolume(SOAP_VOLUME_21)).toBe(21)
    expect(parseMute(SOAP_MUTE_0)).toBe(false)
    expect(parseMute(SOAP_MUTE_1)).toBe(true)
    expect(parseTransport(SOAP_STOPPED)).toEqual({ state: 'STOPPED', status: 'OK' })
    expect(toPlayback('PLAYING')).toBe('playing')
    expect(toPlayback('PAUSED_PLAYBACK')).toBe('paused')
    expect(toPlayback('STOPPED')).toBe('idle')
    expect(toPlayback('TRANSITIONING')).toBe('playing')
  })

  it('treats the captured idle position as no duration and no track', () => {
    const pos = parsePosition(SOAP_POSITION_IDLE)
    expect(pos).toEqual({ durationS: undefined, positionS: 0, trackUri: '', didl: '' })
    const patch = toStatePatch(21, false, parseTransport(SOAP_STOPPED), pos, HOST_PORT)
    expect(patch).toEqual({ volume: 21, muted: false, playback: 'idle', nowPlaying: null })
  })

  it('parses the HLS track captured on the Play:3', () => {
    const meta = parseDidl(DIDL_TRACK, HOST_PLAY3)
    expect(meta).toEqual({
      title: 'Northwind - Quiet Hours',
      artist: 'MicroGram',
      artUrl: `/api/plugins/sonos/art?url=${encodeURIComponent(`http://${HOST_PLAY3}:1400${HLS_ART}`)}`,
      live: false,
    })
    const pos = parsePosition(SOAP_POSITION_PLAYING)
    expect(pos.durationS).toBe(138)
    expect(pos.positionS).toBe(25)
    const patch = toStatePatch(2, false, parseTransport(SOAP_PLAYING), pos, HOST_PLAY3)
    expect(patch.playback).toBe('playing')
    expect(patch.nowPlaying).toMatchObject({
      title: 'Northwind - Quiet Hours',
      artist: 'MicroGram',
      durationS: 138,
      positionS: 25,
      artUrl: `/api/plugins/sonos/art?url=${encodeURIComponent(`http://${HOST_PLAY3}:1400${HLS_ART}`)}`,
    })
    expect(patch.nowPlaying?.album).toBeUndefined()
    expect(patch.nowPlaying?.live).toBeUndefined()
    expect(toStatePatch(2, false, parseTransport(SOAP_PAUSED), pos, HOST_PLAY3).playback).toBe('paused')
  })

  it('parses the next HLS track that carries title, artist and album separately', () => {
    const meta = parseDidl(DIDL_ALBUM, HOST_PLAY3)
    expect(meta).toEqual({
      title: 'Slow Tide',
      artist: 'Lumen',
      album: 'Meridians',
      artUrl: `/api/plugins/sonos/art?url=${encodeURIComponent(`http://${HOST_PLAY3}:1400${HLS_ART}`)}`,
      live: false,
    })
    const pos = parsePosition(SOAP_POSITION_ALBUM)
    expect(pos.durationS).toBe(198)
    expect(pos.positionS).toBe(86)
    expect(toStatePatch(2, false, parseTransport(SOAP_PLAYING), pos, HOST_PLAY3).nowPlaying).toMatchObject({
      title: 'Slow Tide',
      artist: 'Lumen',
      album: 'Meridians',
      durationS: 198,
      positionS: 86,
    })
  })

  it('formats and parses Sonos H:MM:SS', () => {
    expect(parseSonosTime('0:03:21')).toBe(201)
    expect(parseSonosTime('0:00:00')).toBe(0)
    expect(parseSonosTime('NOT_IMPLEMENTED')).toBeUndefined()
    expect(formatSonosTime(64)).toBe('0:01:04')
    expect(formatSonosTime(0)).toBe('0:00:00')
  })

  it('builds a valid forgettable speaker descriptor', () => {
    const d = toDescriptor({ uuid: UUID_PORT, host: HOST_PORT, name: 'Bureau', model: 'Sonos Port' })
    expect(deviceDescriptorSchema.safeParse(d).success).toBe(true)
    expect(d.externalId).toBe(UUID_PORT)
    expect(d.meta.forgettable).toBe(true)
    expect(d.meta.mediaPlayer).toEqual({ deviceClass: 'speaker' })
    expect(d.capabilities).toContain('play_url')
    expect(d.id).not.toContain('::')
  })

  it('builds DIDL for an HTTP stream', () => {
    const { uri, didl } = streamLoad('https://icecast.radiofrance.fr/franceinfo-midfi.mp3')
    expect(uri).toBe('https://icecast.radiofrance.fr/franceinfo-midfi.mp3')
    expect(didl).toContain('icecast.radiofrance.fr')
    expect(didl).toContain('audio/mpeg')
    expect(didl).toContain('musicTrack')
    expect(streamLoad('https://ex.example/live.m3u8').didl).toContain('audioBroadcast')
  })

  it('embeds title, artist and artwork in stream DIDL', () => {
    const { didl } = streamLoad('http://192.168.1.10:8787/api/plugins/ytmusic/stream/abc', {
      title: 'Horizon',
      artist: 'Mira Solano',
      artUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
    })
    expect(didl).toContain('<dc:title>Horizon</dc:title>')
    expect(didl).toContain('<dc:creator>Mira Solano</dc:creator>')
    expect(didl).toContain('<upnp:albumArtURI>https://i.ytimg.com/vi/x/hqdefault.jpg</upnp:albumArtURI>')
    expect(didl).not.toContain('<dc:title>192.168.1.10</dc:title>')
  })

  it('overlays sticky play_url meta when Sonos forgets DIDL', () => {
    const weak = {
      playback: 'playing' as const,
      nowPlaying: { title: '', source: 'http://192.168.1.10:8787/api/plugins/ytmusic/stream/abc' },
    }
    const out = overlayStreamMeta(
      weak,
      { uri: 'http://192.168.1.10:8787/api/plugins/ytmusic/stream/abc', title: 'Horizon', artist: 'Mira', artUrl: 'https://i.ytimg.com/a.jpg' },
      'http://192.168.1.10:8787/api/plugins/ytmusic/stream/abc',
      artProxyUrl,
    )
    expect(out.nowPlaying).toMatchObject({
      title: 'Horizon',
      artist: 'Mira',
      artUrl: artProxyUrl('https://i.ytimg.com/a.jpg'),
    })
  })

  /**
   * Le marquage explicit vient du catalogue, JAMAIS du Sonos : sans report, le badge s'allumait au
   * lancement puis s'éteignait au premier sondage, quelques secondes plus tard.
   */
  it('keeps the explicit mark across polls: no Sonos reading ever carries it', () => {
    const uri = 'http://192.168.1.10:8787/api/plugins/ytmusic/stream/abc'
    const out = overlayStreamMeta(
      { playback: 'playing' as const, nowPlaying: { title: 'abc', source: uri } },
      { uri, title: 'Horizon', explicit: true },
      uri,
      artProxyUrl,
    )
    expect(out.nowPlaying).toMatchObject({ title: 'Horizon', explicit: true })
  })
})
