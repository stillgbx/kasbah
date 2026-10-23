import type { FastifyReply } from 'fastify'

// Cover art relayed by the server (`/art` of the Cast and Sonos plugins). The URLs come from outside
// (a receiver's media state, a radio directory's favicon, a `play_url`) and the answer goes out under
// Kasbah's origin: only a raster image may come back, and never as something a browser would run.

/** Types a browser only ever draws. Not `image/svg+xml`: an SVG can carry a script. */
const RASTER = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
  'image/x-icon', 'image/vnd.microsoft.icon',
])

/** The media type alone (`image/png; charset=…` → `image/png`), lowercased. */
const mediaType = (contentType: string) => contentType.split(';')[0]!.trim().toLowerCase()

export const isRasterImage = (contentType: string): boolean => RASTER.has(mediaType(contentType))

/** Only an http(s) address is worth remembering: not `data:`, `file:` or `javascript:`. */
export function isWebUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Sends a cover with headers that forbid running it, should it be opened as a page. */
export function sendArt(reply: FastifyReply, art: { type: string; body: Buffer }) {
  return reply
    .header('content-type', mediaType(art.type))
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('cache-control', 'public, max-age=86400')
    .send(art.body)
}
