// Screenshots of the 3D benches: 8-bit RGB/RGBA PNG (what Chrome's DevTools protocol captures), read
// and written without a dependency, and compared on luminance.
import { readFileSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'

/** Decodes a non-interlaced 8-bit RGB or RGBA PNG. */
export function readPng(file) {
  const buf = readFileSync(file)
  let p = 8, w = 0, h = 0, ct = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]
      if (data[8] !== 8 || data[12] !== 0) throw new Error(`${file}: only 8-bit, non-interlaced PNG`)
    }
    if (type === 'IDAT') idat.push(data)
    p += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp
  const px = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0
      let v = src[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      px[y * stride + x] = v & 255
    }
  }
  return { w, h, bpp, px }
}

function writeRgbPng(file, w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  const chunk = (type, data) => {
    const b = Buffer.alloc(12 + data.length)
    b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8)
    b.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])) >>> 0, 8 + data.length)
    return b
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

/**
 * Luminance gap between two captures of the same size, out of 255: the mean, and the share of pixels
 * apart by more than 8 and 32. With `heatMap`, writes the first image greyed with the gaps in red.
 */
export function compareImages(fileA, fileB, heatMap) {
  const A = readPng(fileA), B = readPng(fileB)
  if (A.w !== B.w || A.h !== B.h) throw new Error(`size mismatch: ${fileA} / ${fileB}`)
  const n = A.w * A.h, heat = heatMap ? Buffer.alloc(n * 3) : null
  let sum = 0, over8 = 0, over32 = 0
  const lum = (I, i) => 0.2126 * I.px[i * I.bpp] + 0.7152 * I.px[i * I.bpp + 1] + 0.0722 * I.px[i * I.bpp + 2]
  for (let i = 0; i < n; i++) {
    const la = lum(A, i), d = Math.abs(la - lum(B, i))
    sum += d
    if (d > 8) over8++
    if (d > 32) over32++
    if (heat) { const g = la * 0.35; heat[i * 3] = Math.min(255, g + d * 4); heat[i * 3 + 1] = g; heat[i * 3 + 2] = g }
  }
  if (heat) writeRgbPng(heatMap, A.w, A.h, heat)
  return { mean: +(sum / n).toFixed(2), over8: +((over8 * 100) / n).toFixed(2), over32: +((over32 * 100) / n).toFixed(2) }
}
