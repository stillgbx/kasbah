// Captures du 2026-09-19, anonymisées (MAC, serial, household id, jeton HLS). Forme réelle conservée.
// Port « Bureau » firmware 97.1-80312 (ZPS23) et Play:3 « Cuisine » 83.1-61210 (ZPS3).
// Repos : STOPPED, file vide. Lecture : Play:3 Cuisine, GET /raw 2026-09-19 ~23:18, HLS `x-sonosapi-hls-static`.

export const UUID_PORT = 'RINCON_AAAABBBBCCCC01400'
export const UUID_PLAY3 = 'RINCON_DDDDEEEEFFFF01400'
export const HOST_PORT = '192.168.1.15'
export const HOST_PLAY3 = '192.168.1.90'

export const SSDP_PORT = [
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age = 1800',
  'EXT:',
  `LOCATION: http://${HOST_PORT}:1400/xml/device_description.xml`,
  'SERVER: Linux UPnP/1.0 Sonos/97.1-80312 (ZPS23)',
  'ST: urn:schemas-upnp-org:device:ZonePlayer:1',
  `USN: uuid:${UUID_PORT}::urn:schemas-upnp-org:device:ZonePlayer:1`,
  'X-RINCON-BOOTSEQ: 288',
  '',
].join('\r\n')

export const SSDP_PLAY3 = [
  'HTTP/1.1 200 OK',
  'CACHE-CONTROL: max-age = 1800',
  'EXT:',
  `LOCATION: http://${HOST_PLAY3}:1400/xml/device_description.xml`,
  'SERVER: Linux UPnP/1.0 Sonos/83.1-61210 (ZPS3)',
  'ST: urn:schemas-upnp-org:device:ZonePlayer:1',
  `USN: uuid:${UUID_PLAY3}::urn:schemas-upnp-org:device:ZonePlayer:1`,
  'X-RINCON-BOOTSEQ: 172',
  '',
].join('\r\n')

export const ZP_PORT = `<?xml version="1.0" ?><ZPSupportInfo><ZPInfo><ZoneName>Bureau</ZoneName><LocalUID>${UUID_PORT}</LocalUID><SoftwareVersion>97.1-80312</SoftwareVersion><IPAddress>${HOST_PORT}</IPAddress></ZPInfo></ZPSupportInfo>`
export const ZP_PLAY3 = `<?xml version="1.0" ?><ZPSupportInfo><ZPInfo><ZoneName>Cuisine</ZoneName><LocalUID>${UUID_PLAY3}</LocalUID><SoftwareVersion>83.1-61210</SoftwareVersion><IPAddress>${HOST_PLAY3}</IPAddress></ZPInfo></ZPSupportInfo>`

export const DESC_PORT = `<?xml version="1.0" encoding="utf-8" ?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><manufacturer>Sonos, Inc.</manufacturer><modelNumber>S23</modelNumber><modelName>Sonos Port</modelName><displayName>Port</displayName><roomName>Bureau</roomName><UDN>uuid:${UUID_PORT}</UDN></device></root>`
export const DESC_PLAY3 = `<?xml version="1.0" encoding="utf-8" ?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><manufacturer>Sonos, Inc.</manufacturer><modelNumber>S3</modelNumber><modelName>Sonos Play:3</modelName><displayName>Play:3</displayName><roomName>Cuisine</roomName><UDN>uuid:${UUID_PLAY3}</UDN></device></root>`

export const SOAP_VOLUME_21 = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetVolumeResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><CurrentVolume>21</CurrentVolume></u:GetVolumeResponse></s:Body></s:Envelope>'
export const SOAP_VOLUME_8 = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetVolumeResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><CurrentVolume>8</CurrentVolume></u:GetVolumeResponse></s:Body></s:Envelope>'
export const SOAP_MUTE_0 = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetMuteResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><CurrentMute>0</CurrentMute></u:GetMuteResponse></s:Body></s:Envelope>'
export const SOAP_MUTE_1 = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetMuteResponse xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><CurrentMute>1</CurrentMute></u:GetMuteResponse></s:Body></s:Envelope>'
export const SOAP_STOPPED = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>STOPPED</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse></s:Body></s:Envelope>'
export const SOAP_PLAYING = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>PLAYING</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse></s:Body></s:Envelope>'
export const SOAP_PAUSED = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetTransportInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><CurrentTransportState>PAUSED_PLAYBACK</CurrentTransportState><CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed></u:GetTransportInfoResponse></s:Body></s:Envelope>'
export const SOAP_POSITION_IDLE = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Track>0</Track><TrackDuration>0:00:00</TrackDuration><TrackMetaData></TrackMetaData><TrackURI></TrackURI><RelTime>0:00:00</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount></u:GetPositionInfoResponse></s:Body></s:Envelope>'

/** Jeton HLS anonymisé ; `sid=284` conservé (identifiant de service Sonos). */
export const HLS_URI = 'x-sonosapi-hls-static:TOKEN?sid=284&flags=8&sn=1'
export const HLS_ART = '/getaa?s=1&u=x-sonosapi-hls-static%3aTOKEN%3fsid%3d284%26flags%3d8%26sn%3d1'

/**
 * DIDL capturé sur le Play:3 Cuisine en lecture (HLS). Pas d'`upnp:album`. `dc:title` porte
 * « artiste — titre » ; `dc:creator` est le nom de la source (`MicroGram`), pas l'interprète.
 * `albumArtURI` est un chemin relatif `/getaa?…` (le mappage préfixe `http://{ip}:1400`).
 */
export const DIDL_TRACK = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true"><res protocolInfo="sonos.com-http:*:application/x-mpegURL:*" duration="0:02:18">${HLS_URI.replace(/&/g, '&amp;')}</res><r:streamContent></r:streamContent><upnp:albumArtURI>${HLS_ART.replace(/&/g, '&amp;')}</upnp:albumArtURI><dc:title>Northwind - Quiet Hours</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><dc:creator>MicroGram</dc:creator></item></DIDL-Lite>`

export const SOAP_POSITION_PLAYING = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Track>1</Track><TrackDuration>0:02:18</TrackDuration><TrackMetaData>${DIDL_TRACK.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</TrackMetaData><TrackURI>${HLS_URI.replace(/&/g, '&amp;')}</TrackURI><RelTime>0:00:25</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount></u:GetPositionInfoResponse></s:Body></s:Envelope>`

/** Même service HLS, piste suivante : titre / artiste / album séparés. */
export const DIDL_ALBUM = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true"><res protocolInfo="sonos.com-http:*:application/x-mpegURL:*" duration="0:03:18">${HLS_URI.replace(/&/g, '&amp;')}</res><r:streamContent></r:streamContent><upnp:albumArtURI>${HLS_ART.replace(/&/g, '&amp;')}</upnp:albumArtURI><dc:title>Slow Tide</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><dc:creator>Lumen</dc:creator><upnp:album>Meridians</upnp:album></item></DIDL-Lite>`

export const SOAP_POSITION_ALBUM = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetPositionInfoResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><Track>1</Track><TrackDuration>0:03:18</TrackDuration><TrackMetaData>${DIDL_ALBUM.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</TrackMetaData><TrackURI>${HLS_URI.replace(/&/g, '&amp;')}</TrackURI><RelTime>0:01:26</RelTime><AbsTime>NOT_IMPLEMENTED</AbsTime><RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount></u:GetPositionInfoResponse></s:Body></s:Envelope>`

export const SOAP_ZONES = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetZoneGroupStateResponse xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1"><ZoneGroupState>&lt;ZoneGroupState&gt;&lt;ZoneGroups&gt;&lt;ZoneGroup Coordinator=&quot;${UUID_PORT}&quot; ID=&quot;${UUID_PORT}:2072429637&quot;&gt;&lt;ZoneGroupMember UUID=&quot;${UUID_PORT}&quot; Location=&quot;http://${HOST_PORT}:1400/xml/device_description.xml&quot; ZoneName=&quot;Bureau&quot;/&gt;&lt;/ZoneGroup&gt;&lt;ZoneGroup Coordinator=&quot;${UUID_PLAY3}&quot; ID=&quot;${UUID_PLAY3}:237657558&quot;&gt;&lt;ZoneGroupMember UUID=&quot;${UUID_PLAY3}&quot; Location=&quot;http://${HOST_PLAY3}:1400/xml/device_description.xml&quot; ZoneName=&quot;Cuisine&quot;/&gt;&lt;/ZoneGroup&gt;&lt;/ZoneGroups&gt;&lt;VanishedDevices&gt;&lt;/VanishedDevices&gt;&lt;/ZoneGroupState&gt;</ZoneGroupState></u:GetZoneGroupStateResponse></s:Body></s:Envelope>`

export const SOAP_OK = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:PlayResponse xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:PlayResponse></s:Body></s:Envelope>'
