import { describe, expect, it } from 'vitest'
import { JpegSplitter, jpegLength } from './jpeg'

/**
 * A JPEG with the traps of the format: `FF D9` inside a table segment (not an end of image), then in
 * the entropy-coded data a stuffed 0xFF (`FF 00`), a restart marker (`FF D0`) and fill bytes before EOI.
 */
const tricky = (fill: number) => Buffer.from([
  0xff, 0xd8,
  0xff, 0xdb, 0x00, 0x06, 0xff, 0xd9, 0x01, fill,
  0xff, 0xda, 0x00, 0x04, 0x01, 0x00,
  fill, 0xff, 0x00, 0x12, 0xff, 0xd0, 0x34,
  0xff, 0xff, 0xd9,
])

describe('jpegLength', () => {
  it('finds the end of image past an FF D9 inside a segment, stuffing and restart markers', () => {
    const img = tricky(7)
    expect(jpegLength(Buffer.concat([img, tricky(8)]))).toBe(img.length)
  })

  it('answers -1 while the image is incomplete, wherever it is cut', () => {
    const img = tricky(7)
    for (let n = 0; n < img.length; n++) expect(jpegLength(img.subarray(0, n))).toBe(-1)
  })

  it('refuses bytes that are not a JPEG', () => {
    expect(() => jpegLength(Buffer.from([0x00, 0x01, 0x02]))).toThrow(/SOI/)
  })
})

describe('JpegSplitter', () => {
  it('returns whole images from chunks cut anywhere', () => {
    const a = tricky(1), b = tricky(2), c = tricky(3)
    const all = Buffer.concat([a, b, c])
    const splitter = new JpegSplitter()
    const got: Buffer[] = []
    for (let i = 0; i < all.length; i += 5) got.push(...splitter.push(all.subarray(i, i + 5)))
    expect(got.map((x) => x.toString('hex'))).toEqual([a, b, c].map((x) => x.toString('hex')))
  })

  it('drops unreadable bytes up to the next image and counts them', () => {
    const splitter = new JpegSplitter()
    const got = splitter.push(Buffer.concat([Buffer.from([0x12, 0x34, 0x56]), tricky(4)]))
    expect(got.map((x) => x.toString('hex'))).toEqual([tricky(4).toString('hex')])
    expect(splitter.dropped).toBe(3)
  })
})
