import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { FRAME_BYTES, FRAME_S, LengthLock, lengthFor, parseRange, seekFor } from './proxy'

// The fixed-frame MP3 "file": size from the duration, instant from the byte, ranges, and the size
// promise kept whatever ffmpeg produces.

async function collect(lock: LengthLock, chunks: Buffer[]): Promise<Buffer> {
  const out = new PassThrough()
  const got: Buffer[] = []
  out.on('data', (c: Buffer) => got.push(c))
  const done = new Promise<void>((resolve) => out.on('end', resolve))
  lock.pipe(out)
  for (const c of chunks) lock.write(c)
  lock.end()
  await done
  return Buffer.concat(got)
}

describe('the sized MP3 file', () => {
  it('turns a duration into whole frames and a byte offset into a frame start', () => {
    expect(FRAME_BYTES).toBe(960)
    expect(FRAME_S).toBeCloseTo(0.024, 9)
    expect(lengthFor(20)).toBe(834 * 960)
    expect(lengthFor(0.001)).toBe(960)
    expect(seekFor(0)).toEqual({ startS: 0, skipBytes: 0 })
    expect(seekFor(960 * 100)).toEqual({ startS: expect.closeTo(2.4, 9), skipBytes: 0 })
    expect(seekFor(960 * 100 + 10)).toEqual({ startS: expect.closeTo(2.4, 9), skipBytes: 10 })
  })

  it('parses byte ranges against the announced length', () => {
    expect(parseRange(undefined, 1000)).toBeNull()
    expect(parseRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
    expect(parseRange('bytes=100-5000', 1000)).toEqual({ start: 100, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=1000-', 1000)).toBeNull()
    expect(parseRange('items=0-1', 1000)).toBeNull()
  })

  it('delivers exactly the promised bytes: skips the head of the first frame, truncates, pads with silence', async () => {
    const silence = Buffer.alloc(960, 7)
    // ffmpeg produces too much: we cut
    const a = await collect(new LengthLock(10, 0, silence), [Buffer.alloc(8, 1), Buffer.alloc(8, 2)])
    expect(a.length).toBe(10)
    expect([...a.subarray(0, 8)]).toEqual(Array(8).fill(1))
    expect([...a.subarray(8)]).toEqual([2, 2])
    // ffmpeg stops too early: silence up to the promised size
    const b = await collect(new LengthLock(1000, 0, silence), [Buffer.alloc(100, 1)])
    expect(b.length).toBe(1000)
    expect(b[99]).toBe(1)
    expect(b[100]).toBe(7)
    expect(b[999]).toBe(7)
    // range starting in the middle of a frame: the first bytes are swallowed
    const c = await collect(new LengthLock(5, 3, silence), [Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9])])
    expect([...c]).toEqual([4, 5, 6, 7, 8])
  })
})
