import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { hexToRgb, LIGHTSYNC_PRESETS, rgbToHsv } from '@kasbah/shared'
import type { SpawnFn } from '../proxy'
import { coverColors, CoverPalettes, dominantColors, FALLBACK_PALETTE, staticPalette } from './palette'

/** Raw RGB image made of blocks of solid colours: `[r, g, b, count]`. */
function pixels(blocks: [number, number, number, number][]): Uint8Array {
  const out: number[] = []
  for (const [r, g, b, n] of blocks) for (let i = 0; i < n; i++) out.push(r, g, b)
  return Uint8Array.from(out)
}
const hueOf = (hex: string) => rgbToHsv(hexToRgb(hex)).h

describe('staticPalette', () => {
  const scenes = (id: string) => (id === 'scene-1' ? ['#112233', '#445566'] : undefined)
  it('reads presets, hand-picked colours and a scene of the room', () => {
    expect(staticPalette({ source: 'preset', preset: 'ocean' }, scenes)).toEqual(LIGHTSYNC_PRESETS.ocean)
    expect(staticPalette({ source: 'custom', colors: ['#ff0000', '#00ff00'] }, scenes)).toEqual(['#ff0000', '#00ff00'])
    expect(staticPalette({ source: 'scene', sceneId: 'scene-1' }, scenes)).toEqual(['#112233', '#445566'])
  })
  it('falls back when the scene is gone, and leaves the cover to the track', () => {
    expect(staticPalette({ source: 'scene', sceneId: 'gone' }, scenes)).toBe(FALLBACK_PALETTE)
    expect(staticPalette({ source: 'cover' }, scenes)).toBeNull()
  })
})

describe('dominantColors', () => {
  it('finds the main hues by weight, ignoring greys and blacks, and saturates them', () => {
    const img = pixels([[200, 30, 30, 120], [30, 60, 210, 80], [128, 128, 128, 200], [5, 5, 5, 200], [40, 180, 60, 30]])
    const colors = dominantColors(img)
    expect(colors.length).toBe(3)
    expect(hueOf(colors[0]!)).toBeLessThan(15)                       // red first: the heaviest
    expect(hueOf(colors[1]!)).toBeGreaterThan(200)                   // then blue
    for (const c of colors) expect(rgbToHsv(hexToRgb(c)).s).toBeGreaterThanOrEqual(0.74)
  })
  it('keeps the colours apart (neighbouring hues count once) and adds a second hue to a one-colour cover', () => {
    const colors = dominantColors(pixels([[220, 40, 20, 100], [220, 70, 20, 100]]))
    expect(colors).toHaveLength(2)
    expect(Math.abs(hueOf(colors[1]!) - hueOf(colors[0]!))).toBeGreaterThan(25)
  })
  it('gives nothing for a grey cover', () => {
    expect(dominantColors(pixels([[100, 100, 100, 50], [250, 250, 250, 50]]))).toEqual([])
  })
})

function fakeFfmpeg(output: Uint8Array, code = 0) {
  const spawnImpl = vi.fn((_cmd: string, _args: readonly string[]) => {
    const proc = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough }
    proc.stdin = new PassThrough(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough()
    proc.stdin.on('finish', () => { proc.stdout.end(Buffer.from(output)); setTimeout(() => proc.emit('close', code), 0) })
    proc.stdin.resume()
    return proc
  })
  return spawnImpl as unknown as SpawnFn & typeof spawnImpl
}

describe('coverColors', () => {
  const image = new Response(new Uint8Array([0xff, 0xd8, 1, 2, 3]))
  it('fetches the cover, has ffmpeg shrink it to raw pixels, and returns its colours', async () => {
    const spawnImpl = fakeFfmpeg(pixels([[30, 60, 210, 256]]))
    const fetchImpl = vi.fn(async () => image.clone()) as unknown as typeof fetch
    const colors = await coverColors('https://img.example.org/cover.jpg', { ffmpegPath: 'ffmpeg', spawnImpl, fetchImpl })
    expect(colors).toHaveLength(2)
    expect(hueOf(colors[0]!)).toBeGreaterThan(200)
    expect(spawnImpl.mock.calls[0]![1]).toEqual(expect.arrayContaining(['rawvideo', 'rgb24', 'scale=16:16']))
  })
  it('gives nothing (the caller falls back) when the cover cannot be read', async () => {
    const fail = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    expect(await coverColors('https://img.example.org/x.jpg', { ffmpegPath: 'ffmpeg', fetchImpl: fail })).toEqual([])
    const ok = vi.fn(async () => image.clone()) as unknown as typeof fetch
    expect(await coverColors('https://img.example.org/x.jpg', { ffmpegPath: 'ffmpeg', fetchImpl: ok, spawnImpl: fakeFfmpeg(new Uint8Array(), 1) })).toEqual([])
  })
  it('fetches each cover once', async () => {
    const fetchImpl = vi.fn(async () => image.clone()) as unknown as typeof fetch & ReturnType<typeof vi.fn>
    const covers = new CoverPalettes({ ffmpegPath: 'ffmpeg', fetchImpl, spawnImpl: fakeFfmpeg(pixels([[200, 30, 30, 256]])) })
    await covers.get('https://img.example.org/a.jpg')
    await covers.get('https://img.example.org/a.jpg')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
