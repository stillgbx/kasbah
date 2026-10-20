import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'

// UPnP SOAP client: an XML POST by hand, no library. Captured on 2026-09-19 on a Port
// (firmware 97.1) and a Play:3 (83.1): HTTP 200, no authentication, port 1400.

export const RC_URN = 'urn:schemas-upnp-org:service:RenderingControl:1'
export const AV_URN = 'urn:schemas-upnp-org:service:AVTransport:1'
export const ZG_URN = 'urn:schemas-upnp-org:service:ZoneGroupTopology:1'
export const RC_PATH = '/MediaRenderer/RenderingControl/Control'
export const AV_PATH = '/MediaRenderer/AVTransport/Control'
export const ZG_PATH = '/ZoneGroupTopology/Control'

export interface SoapOptions {
  host: string
  path: string
  urn: string
  action: string
  args?: Record<string, string>
  fetchImpl: FetchLike
  signal?: AbortSignal
  timeoutMs: number
}

export function encodeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Decode the entities: `&amp;` first, otherwise `&amp;lt;` would stay `&lt;` in plain text. */
export function decodeXml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
}

export function xmlTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>`)
  const m = xml.match(re)
  return m ? m[1] : undefined
}

export function xmlAttr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? m[1] : undefined
}

function envelope(urn: string, action: string, args: Record<string, string>): string {
  const inner = Object.entries(args).map(([k, v]) => `<${k}>${encodeXml(v)}</${k}>`).join('')
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${urn}">${inner}</u:${action}></s:Body></s:Envelope>`
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export async function soapAction(opts: SoapOptions): Promise<string> {
  const body = envelope(opts.urn, opts.action, opts.args ?? {})
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await opts.fetchImpl(`http://${opts.host}:1400${opts.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${opts.urn}#${opts.action}"` },
      body,
      signal: withTimeout(opts.signal, opts.timeoutMs),
    })
  } catch (err) {
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      throw new PluginError('TIMEOUT', `Sonos ${opts.action} timed out`, { cause: err })
    }
    throw new PluginError('UPSTREAM_ERROR', `Sonos ${opts.host} unreachable (${(err as Error).message})`, { cause: err })
  }
  const text = await res.text()
  if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Sonos ${opts.action} HTTP ${res.status}`)
  return text
}

export async function httpGet(opts: { host: string; path: string; fetchImpl: FetchLike; signal?: AbortSignal; timeoutMs: number }): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>
  try {
    res = await opts.fetchImpl(`http://${opts.host}:1400${opts.path}`, {
      method: 'GET',
      signal: withTimeout(opts.signal, opts.timeoutMs),
    })
  } catch (err) {
    if ((err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError') {
      throw new PluginError('TIMEOUT', `Sonos GET ${opts.path} timed out`, { cause: err })
    }
    throw new PluginError('UPSTREAM_ERROR', `Sonos ${opts.host} unreachable (${(err as Error).message})`, { cause: err })
  }
  const text = await res.text()
  if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `Sonos GET ${opts.path} HTTP ${res.status}`)
  return text
}
