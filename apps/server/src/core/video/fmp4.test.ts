import { describe, expect, it } from 'vitest'
import { Mp4BoxParser, mseMimeFromMoov } from './fmp4'

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
