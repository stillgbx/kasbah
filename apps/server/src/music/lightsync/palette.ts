import { spawn } from 'node:child_process'
import type { Logger } from 'pino'
import { hexToRgb, hsvToRgb, LIGHTSYNC_PRESETS, rgbToHex, rgbToHsv, type LightSyncPalette } from '@kasbah/shared'
import type { SpawnFn } from '../proxy'
import type { Rgb } from './effects'

// Where the colours of the light sync come from: a ready-made palette, a light scene of the room,
// colours picked by hand, or the cover art of the playing track. The cover is decoded by the ffmpeg
// already used for the sound (16 × 16 raw RGB), no image library.

export const FALLBACK_PALETTE: readonly string[] = LIGHTSYNC_PRESETS.warm

export const toRgb = (hexes: readonly string[]): Rgb[] => hexes.map((h) => { const c = hexToRgb(h); return [c.r, c.g, c.b] as const })

/**
 * The palette's colours when they don't depend on the track; null for the cover (asynchronous,
 * per track). A scene that disappeared, or has fewer than two colours, falls back to the default.
 */
export function staticPalette(p: LightSyncPalette, sceneColors: (sceneId: string) => readonly string[] | undefined): readonly string[] | null {
  switch (p.source) {
    case 'preset': return LIGHTSYNC_PRESETS[p.preset]
    case 'custom': return p.colors
    case 'scene': {
      const colors = sceneColors(p.sceneId)
      return colors && colors.length >= 1 ? colors : FALLBACK_PALETTE
    }
    case 'cover': return null
  }
}

const HUE_BUCKETS = 12

/**
 * The 2 to `max` dominant colours of an image given as raw RGB bytes: hue buckets weighted by
 * saturation × value, greys and near-blacks ignored, neighbouring buckets skipped so the colours
 * differ, then pushed to full saturation and value (a light shows colour, not a dull tint).
 * Empty for a grey image: the caller falls back to the default palette.
 */
export function dominantColors(rgb: Uint8Array, max = 4): string[] {
  const buckets = Array.from({ length: HUE_BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }))
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const c = { r: rgb[i]! / 255, g: rgb[i + 1]! / 255, b: rgb[i + 2]! / 255 }
    const { h, s, v } = rgbToHsv(c)
    if (v < 0.15 || s < 0.2) continue
    const w = s * v
    const k = Math.floor(((h % 360) / 360) * HUE_BUCKETS) % HUE_BUCKETS
    const bk = buckets[k]!
    bk.w += w; bk.r += c.r * w; bk.g += c.g * w; bk.b += c.b * w
  }
  const total = buckets.reduce((s, b) => s + b.w, 0)
  if (total === 0) return []
  const order = buckets.map((b, k) => ({ ...b, k })).filter((b) => b.w / total >= 0.04).sort((a, b) => b.w - a.w)
  const picked: typeof order = []
  for (const b of order) {
    if (picked.length >= max) break
    const near = picked.some((p) => { const d = Math.abs(p.k - b.k); return Math.min(d, HUE_BUCKETS - d) <= 1 })
    if (!near) picked.push(b)
  }
  const colors = picked.map((b) => {
    const { h, s } = rgbToHsv({ r: b.r / b.w, g: b.g / b.w, b: b.b / b.w })
    return rgbToHex(hsvToRgb({ h, s: Math.max(s, 0.75), v: 1 }))
  })
  // a single hue: add a neighbour 40° away, an effect needs two colours to play with
  if (colors.length === 1) {
    const { h } = rgbToHsv(hexToRgb(colors[0]!))
    colors.push(rgbToHex(hsvToRgb({ h: (h + 40) % 360, s: 0.85, v: 1 })))
  }
  return colors
}

export interface CoverOpts {
  ffmpegPath: string
  spawnImpl?: SpawnFn
  fetchImpl?: typeof fetch
  logger?: Logger
}

const MAX_IMAGE_BYTES = 2_000_000
const FETCH_TIMEOUT_MS = 5000
const CACHE_MAX = 50

/** Fetches a cover and returns its dominant colours ([] on any failure: the caller falls back). */
export async function coverColors(url: string, o: CoverOpts): Promise<string[]> {
  try {
    const res = await (o.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return []
    const image = new Uint8Array(await res.arrayBuffer())
    if (image.length === 0 || image.length > MAX_IMAGE_BYTES) return []
    const pixels = await decodeThumb(image, o)
    return dominantColors(pixels)
  } catch (err) {
    o.logger?.debug({ err }, 'lightsync: cover colours unavailable')
    return []
  }
}

/** ffmpeg: any image in on stdin, 16 × 16 raw RGB out. */
function decodeThumb(image: Uint8Array, o: CoverOpts): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const proc = (o.spawnImpl ?? (spawn as unknown as SpawnFn))(o.ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-vf', 'scale=16:16', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const chunks: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve(new Uint8Array(Buffer.concat(chunks))) : reject(new Error(`ffmpeg exited with ${code}`))))
    proc.stdin.on('error', () => { /* ffmpeg may close its input early: the exit code tells */ })
    proc.stdin.end(Buffer.from(image))
  })
}

/** Cover colours by URL, each cover fetched once (a track's cover does not change). */
export class CoverPalettes {
  private readonly cache = new Map<string, Promise<string[]>>()
  constructor(private readonly opts: CoverOpts) {}
  get(url: string): Promise<string[]> {
    let p = this.cache.get(url)
    if (!p) {
      p = coverColors(url, this.opts)
      this.cache.set(url, p)
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!)
    }
    return p
  }
}
