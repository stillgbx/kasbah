import type { Capability, DeviceDescriptor, StatePatch } from '@kasbah/shared'
import { decodeXml, encodeXml, xmlAttr, xmlTag } from './soap'
import type { PositionInfo, SonosPlayer, TrackMeta, TransportInfo, ZoneMember } from './types'
import { PLUGIN_ID } from './types'

// PURE mapping: Sonos XML (SSDP, /status/zp, SOAP) ↔ `media_player` descriptor / patch.
// Fixtures = captures of 2026-09-19 (Port Bureau + Play:3 Cuisine), anonymized.

export { PLUGIN_ID }

/** Artwork route, mounted under `/api/plugins/sonos`. */
export const ART_ROUTE = '/api/plugins/sonos/art'

export function artProxyUrl(url: string): string {
  return `${ART_ROUTE}?url=${encodeURIComponent(url)}`
}

export const CAPABILITIES: Capability[] = ['playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek', 'play_url']

export function toDescriptor(player: SonosPlayer): DeviceDescriptor {
  return {
    id: `${PLUGIN_ID}:${player.uuid}`,
    pluginId: PLUGIN_ID,
    externalId: player.uuid,
    kind: 'media_player',
    name: player.name,
    capabilities: [...CAPABILITIES],
    meta: {
      manufacturer: 'Sonos',
      ...(player.model ? { model: player.model } : {}),
      mediaPlayer: { deviceClass: 'speaker' },
      forgettable: true,
    },
  }
}

/** Captured SSDP USN: `uuid:RINCON_…01400::urn:schemas-upnp-org:device:ZonePlayer:1`. */
export function uuidFromUsn(usn: string | undefined): string | undefined {
  const m = usn?.match(/uuid:([^:\s]+)/i)
  const uuid = m?.[1]
  return uuid?.startsWith('RINCON_') ? uuid : undefined
}

export function hostFromLocation(location: string | undefined): string | undefined {
  if (!location) return undefined
  try { return new URL(location).hostname } catch { return undefined }
}

export function parseSsdpHeaders(text: string): { uuid: string; host: string } | undefined {
  const headers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
  }
  const st = headers.st ?? headers.nt ?? ''
  if (!/zoneplayer/i.test(st) && !/zoneplayer/i.test(headers.usn ?? '')) return undefined
  const uuid = uuidFromUsn(headers.usn)
  const host = hostFromLocation(headers.location)
  if (!uuid || !host) return undefined
  return { uuid, host }
}

/** `/status/zp`: XML, not the JSON that third-party docs announced for `/status/info` (empty here). */
export function parseZpInfo(xml: string): { uuid: string; name: string; softwareVersion?: string } | undefined {
  const uuid = xmlTag(xml, 'LocalUID')?.trim()
  const name = xmlTag(xml, 'ZoneName')?.trim()
  if (!uuid || !name) return undefined
  const softwareVersion = xmlTag(xml, 'SoftwareVersion')?.trim()
  return { uuid, name, ...(softwareVersion ? { softwareVersion } : {}) }
}

export function parseDeviceDescription(xml: string): { model?: string; modelNumber?: string; name?: string } {
  const model = xmlTag(xml, 'modelName')?.trim() || xmlTag(xml, 'displayName')?.trim()
  const modelNumber = xmlTag(xml, 'modelNumber')?.trim()
  const name = xmlTag(xml, 'roomName')?.trim()
  return {
    ...(model ? { model } : {}),
    ...(modelNumber ? { modelNumber } : {}),
    ...(name ? { name } : {}),
  }
}

export function parseZoneMembers(soapBody: string): ZoneMember[] {
  const escaped = xmlTag(soapBody, 'ZoneGroupState')
  if (!escaped) return []
  const inner = decodeXml(escaped)
  const out: ZoneMember[] = []
  const groupRe = /<ZoneGroup\b([^>]*)>([\s\S]*?)<\/ZoneGroup>/g
  let g: RegExpExecArray | null
  while ((g = groupRe.exec(inner))) {
    const coordinatorUuid = xmlAttr(g[1] ?? '', 'Coordinator') ?? ''
    const memberRe = /<ZoneGroupMember\b([^>]*)\/?>/g
    let m: RegExpExecArray | null
    while ((m = memberRe.exec(g[2] ?? ''))) {
      const attrs = m[1] ?? ''
      const uuid = xmlAttr(attrs, 'UUID')
      const location = xmlAttr(attrs, 'Location')
      const name = xmlAttr(attrs, 'ZoneName')
      const host = hostFromLocation(location)
      if (!uuid || !host || !name) continue
      out.push({ uuid, host, name, coordinatorUuid: coordinatorUuid || uuid })
    }
  }
  return out
}

export function parseTransport(soapBody: string): TransportInfo {
  return {
    state: xmlTag(soapBody, 'CurrentTransportState')?.trim() ?? '',
    status: xmlTag(soapBody, 'CurrentTransportStatus')?.trim() ?? '',
  }
}

export function parseVolume(soapBody: string): number | undefined {
  const raw = xmlTag(soapBody, 'CurrentVolume')?.trim()
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined
}

export function parseMute(soapBody: string): boolean | undefined {
  const raw = xmlTag(soapBody, 'CurrentMute')?.trim()
  if (raw === undefined) return undefined
  return raw === '1' || raw.toLowerCase() === 'true'
}

/**
 * Sonos time `H:MM:SS` (sometimes `.mmm`). `NOT_IMPLEMENTED` and `0:00:00` when stopped are not
 * a duration: captured empty, TrackDuration is `0:00:00` when idle.
 */
export function parseSonosTime(raw: string | undefined): number | undefined {
  if (!raw || raw === 'NOT_IMPLEMENTED') return undefined
  const m = raw.trim().match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/)
  if (!m) return undefined
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0)
  return Number.isFinite(s) && s >= 0 ? s : undefined
}

export function formatSonosTime(positionS: number): string {
  const s = Math.max(0, Math.floor(positionS))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export function parsePosition(soapBody: string): PositionInfo {
  const durationS = parseSonosTime(xmlTag(soapBody, 'TrackDuration') ?? undefined)
  const positionS = parseSonosTime(xmlTag(soapBody, 'RelTime') ?? undefined)
  return {
    durationS: durationS && durationS > 0 ? durationS : undefined,
    positionS: positionS !== undefined && positionS >= 0 ? positionS : undefined,
    trackUri: xmlTag(soapBody, 'TrackURI')?.trim() ?? '',
    didl: xmlTag(soapBody, 'TrackMetaData') ?? '',
  }
}

export function parseDidl(didl: string, artHost: string): TrackMeta | undefined {
  const xml = didl.includes('&lt;') ? decodeXml(didl) : didl
  if (!xml.trim()) return undefined
  const field = (tag: string) => decodeXml((xmlTag(xml, tag) ?? '').trim())
  const title = field('dc:title') || field('title')
  const artist = field('dc:creator') || field('upnp:artist')
  const album = field('upnp:album')
  const stream = field('r:streamContent')
  const klass = field('upnp:class')
  let art = field('upnp:albumArtURI')
  if (art && art.startsWith('/')) art = `http://${artHost}:1400${art}`
  const live = /audioBroadcast/i.test(klass) || (!title && !!stream)
  const shown = title || stream
  if (!shown && !artist && !album) return undefined
  return {
    title: shown,
    ...(artist ? { artist } : {}),
    ...(album ? { album } : {}),
    ...(art ? { artUrl: artProxyUrl(art) } : {}),
    live,
    ...(stream && !title ? { source: stream } : {}),
  }
}

export function toPlayback(state: string): 'playing' | 'paused' | 'idle' {
  switch (state) {
    case 'PLAYING':
    case 'TRANSITIONING':
      return 'playing'
    case 'PAUSED_PLAYBACK':
      return 'paused'
    default:
      return 'idle'
  }
}

export function toStatePatch(
  volume: number | undefined,
  muted: boolean | undefined,
  transport: TransportInfo,
  position: PositionInfo,
  artHost: string,
): StatePatch<'media_player'> {
  const playback = toPlayback(transport.state)
  const patch: StatePatch<'media_player'> = {}
  if (volume !== undefined) patch.volume = volume
  if (muted !== undefined) patch.muted = muted
  patch.playback = playback
  if (playback === 'idle') {
    patch.nowPlaying = null
    return patch
  }
  const meta = parseDidl(position.didl, artHost)
  if (!meta) {
    patch.nowPlaying = position.trackUri ? { title: '', source: position.trackUri } : null
    return patch
  }
  patch.nowPlaying = {
    title: meta.title,
    ...(meta.artist ? { artist: meta.artist } : {}),
    ...(meta.album ? { album: meta.album } : {}),
    ...(meta.artUrl ? { artUrl: meta.artUrl } : {}),
    ...(position.durationS ? { durationS: position.durationS } : {}),
    ...(position.positionS !== undefined ? { positionS: position.positionS } : {}),
    ...(meta.live ? { live: true } : {}),
    ...(meta.source ? { source: meta.source } : {}),
  }
  return patch
}

/** Optional metadata for `play_url` (title / artist / artwork). */
export type StreamMeta = { title?: string; artist?: string; artUrl?: string; explicit?: boolean; live?: boolean }

/**
 * DIDL-Lite for `SetAVTransportURI`: an HTTP stream the speaker fetches. HLS / m3u = live
 * (`audioBroadcast`); the rest is a track. The URL and the title are escaped: SOAP re-escapes the
 * whole block afterwards. Without `meta.title`, the URL's hostname (historical behavior).
 */
export function streamDidl(url: string, contentType: string, live: boolean, meta?: StreamMeta): string {
  const fallback = (() => { try { return new URL(url).hostname } catch { return 'Stream' } })()
  const title = encodeXml(meta?.title?.trim() || fallback)
  const artist = meta?.artist?.trim()
  const art = meta?.artUrl?.trim()
  const res = encodeXml(url)
  const cls = live ? 'object.item.audioItem.audioBroadcast' : 'object.item.audioItem.musicTrack'
  const creator = artist ? `<dc:creator>${encodeXml(artist)}</dc:creator>` : ''
  const albumArt = art ? `<upnp:albumArtURI>${encodeXml(art)}</upnp:albumArtURI>` : ''
  return `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="0" parentID="-1" restricted="true"><dc:title>${title}</dc:title>${creator}${albumArt}<upnp:class>${cls}</upnp:class><res protocolInfo="http-get:*:${contentType}:*">${res}</res></item></DIDL-Lite>`
}

export function streamLoad(url: string, meta?: StreamMeta): { uri: string; didl: string } {
  const path = (() => { try { return new URL(url).pathname.toLowerCase() } catch { return url.toLowerCase() } })()
  const hls = path.endsWith('.m3u8') || path.endsWith('.m3u')
  const live = hls || meta?.live === true
  const contentType = hls ? 'application/x-mpegURL' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.aac') || path.endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg'
  return { uri: url, didl: streamDidl(url, contentType, live, meta) }
}

/**
 * Sonos does not always echo the DIDL of an HTTP `play_url`: GetPositionInfo often returns an empty
 * title or the URL's last segment (e.g. the ytmusic proxy's sid). As long as the sticky URI
 * matches, we impose the title / artist / artwork given with the command.
 */
export function overlayStreamMeta(
  patch: StatePatch<'media_player'>,
  sticky: StreamMeta & { uri: string },
  trackUri: string | undefined,
  artProxy: (url: string) => string,
): StatePatch<'media_player'> {
  if (patch.playback === 'idle') return patch
  if (trackUri && trackUri !== sticky.uri) return patch
  const art = sticky.artUrl?.trim() ? artProxy(sticky.artUrl.trim()) : undefined
  const base = patch.nowPlaying ?? { title: '' }
  return {
    ...patch,
    nowPlaying: {
      ...base,
      ...(sticky.title?.trim() ? { title: sticky.title.trim() } : {}),
      ...(sticky.artist?.trim() ? { artist: sticky.artist.trim() } : {}),
      ...(art ? { artUrl: art } : {}),
      // the Sonos readout says nothing about explicit: without carrying it over, the badge went
      // off on the first poll, a few seconds after the start
      ...(sticky.explicit ? { explicit: true } : {}),
      ...(sticky.live ? { live: true } : {}),
    },
  }
}
