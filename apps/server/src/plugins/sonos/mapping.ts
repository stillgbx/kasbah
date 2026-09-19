import type { Capability, DeviceDescriptor, StatePatch } from '@kasbah/shared'
import { decodeXml, xmlAttr, xmlTag } from './soap'
import type { PositionInfo, SonosPlayer, TrackMeta, TransportInfo, ZoneMember } from './types'
import { PLUGIN_ID } from './types'

// Mappage PUR : XML Sonos (SSDP, /status/zp, SOAP) ↔ descripteur / patch `media_player`.
// Fixtures = captures du 2026-09-19 (Port Bureau + Play:3 Cuisine), anonymisées.

export { PLUGIN_ID }

/** Route des pochettes, montée sous `/api/plugins/sonos`. */
export const ART_ROUTE = '/api/plugins/sonos/art'

export function artProxyUrl(url: string): string {
  return `${ART_ROUTE}?url=${encodeURIComponent(url)}`
}

export const CAPABILITIES: Capability[] = ['playback', 'volume', 'mute', 'now_playing', 'track_skip', 'seek']

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

/** USN SSDP capturé : `uuid:RINCON_…01400::urn:schemas-upnp-org:device:ZonePlayer:1`. */
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

/** `/status/zp` : XML, pas le JSON que la doc tierce annonçait pour `/status/info` (vide ici). */
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
 * Temps Sonos `H:MM:SS` (parfois `.mmm`). `NOT_IMPLEMENTED` et `0:00:00` à l'arrêt ne sont pas
 * une durée : capturé vide, TrackDuration vaut `0:00:00` au repos.
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
