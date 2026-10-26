import { describe, expect, it } from 'vitest'
import { Mp4BoxParser, mseMimeFromMoov, startsWithKeyframe } from './fmp4'

const box = (type: string, payload: Buffer | Buffer[] = Buffer.alloc(0)): Buffer => {
  const body = Array.isArray(payload) ? Buffer.concat(payload) : payload
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length + 8, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

describe('Mp4BoxParser', () => {
  it('splits a byte stream into boxes whatever the chunk boundaries', () => {
    const stream = Buffer.concat([box('ftyp', Buffer.from('isom')), box('moof', Buffer.alloc(20, 1)), box('mdat', Buffer.alloc(100, 2))])
    const parser = new Mp4BoxParser()
    const out = []
    for (let i = 0; i < stream.length; i += 7) out.push(...parser.push(stream.subarray(i, i + 7)))
    expect(out.map((b) => [b.type, b.data.length])).toEqual([['ftyp', 12], ['moof', 28], ['mdat', 108]])
  })

  it('handles the 64-bit size form and rejects an impossible size', () => {
    const payload = Buffer.alloc(10, 3)
    const head = Buffer.alloc(16)
    head.writeUInt32BE(1, 0)
    head.write('mdat', 4, 'latin1')
    head.writeBigUInt64BE(BigInt(16 + payload.length), 8)
    expect(new Mp4BoxParser().push(Buffer.concat([head, payload])).map((b) => b.type)).toEqual(['mdat'])
    const bad = Buffer.alloc(8)
    bad.writeUInt32BE(3, 0)
    expect(() => new Mp4BoxParser().push(bad)).toThrow(/invalid MP4 box size/)
  })
})

describe('mseMimeFromMoov', () => {
  // avcC: version 1, Main profile (0x4D), compatibility 0x00, level 3.0 (0x1E), then the rest
  const avcC = box('avcC', Buffer.from([1, 0x4d, 0x00, 0x1e, 0xff, 0xe1, 0, 0]))
  it('describes H.264 + AAC from the sample entries', () => {
    const moov = box('moov', [box('trak', box('stsd', box('avc1', [Buffer.alloc(78), avcC]))), box('trak', box('stsd', box('mp4a', Buffer.alloc(28))))])
    expect(mseMimeFromMoov(moov)).toBe('video/mp4; codecs="avc1.4D001E, mp4a.40.2"')
  })
  it('video only, and undefined without avcC', () => {
    expect(mseMimeFromMoov(box('moov', box('trak', box('stsd', box('avc1', [Buffer.alloc(78), avcC])))))).toBe('video/mp4; codecs="avc1.4D001E"')
    expect(mseMimeFromMoov(box('moov', box('trak', box('stsd', box('hvc1', Buffer.alloc(80))))))).toBeUndefined()
  })
})

// The boxes ffmpeg writes with `frag_keyframe` + `frag_duration` (read on its real output, ffmpeg
// 9.0.2): `tfhd` with base-is-moof, default duration, size and flags (0x20038); a fragment that
// starts on a keyframe carries `first_sample_flags` in its `trun` (0x205), the others rely on the
// video track's default flags, marked non-sync (0x1010000). Audio samples are all sync.
const u32 = (...values: number[]) => Buffer.concat(values.map((v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b }))
const traf = (track: number, defaultFlags: number, firstFlags?: number) => box('traf', [
  box('tfhd', u32(0x20038, track, 1024, 100, defaultFlags)),
  firstFlags === undefined
    ? box('trun', u32(0x201, 2, 0, 50, 50))                       // data_offset, per-sample sizes
    : box('trun', u32(0x205, 2, 0, firstFlags, 50, 50)),          // + first_sample_flags
])
const moof = (...trafs: Buffer[]) => Buffer.concat([box('moof', [box('mfhd', u32(0, 1)), ...trafs]), box('mdat', Buffer.alloc(100))])
const AUDIO = traf(2, 0x2000000)

describe('startsWithKeyframe', () => {
  it('a fragment whose video starts on a sync sample is a keyframe; one cut between two keyframes is not', () => {
    expect(startsWithKeyframe(moof(traf(1, 0x1010000, 0x2000000), AUDIO))).toBe(true)
    expect(startsWithKeyframe(moof(traf(1, 0x1010000), AUDIO))).toBe(false)
  })

  it('reads per-sample flags too, and counts unknown flags as a keyframe', () => {
    const perSample = (flags: number) => box('traf', [box('tfhd', u32(0x20000, 1)), box('trun', u32(0x401, 1, 0, flags))])
    expect(startsWithKeyframe(moof(perSample(0x1010000)))).toBe(false)
    expect(startsWithKeyframe(moof(perSample(0x2000000)))).toBe(true)
    // no flags anywhere (no default in tfhd, none in trun): nothing says it is not a keyframe
    expect(startsWithKeyframe(moof(box('traf', [box('tfhd', u32(0x20000, 1)), box('trun', u32(0x001, 1, 0))])))).toBe(true)
    expect(startsWithKeyframe(Buffer.concat([box('moof', Buffer.alloc(16)), box('mdat', Buffer.alloc(8))]))).toBe(true)
  })
})
