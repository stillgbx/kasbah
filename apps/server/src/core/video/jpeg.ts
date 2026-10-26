// Splitting a stream of concatenated JPEG images (what ffmpeg writes with `-f image2pipe -c:v mjpeg`)
// into whole images. PURE: Buffers in, Buffers out; testable without ffmpeg.
//
// The end of an image cannot be found by looking for its EOI marker (`FF D9`) alone: those two
// bytes may sit inside a segment's payload (a quantization or Huffman table). So the segments are
// walked by their lengths up to the scan (SOS), and only the entropy-coded data after it is
// scanned — where a 0xFF byte is always followed by 0x00 (stuffing) or a restart marker, unless it
// starts a real marker.

const SOI = 0xd8, EOI = 0xd9, SOS = 0xda
const SOI_BYTES = Buffer.from([0xff, SOI])

/** Length of the complete JPEG at the start of `buf`, or -1 if it is not all there yet. */
export function jpegLength(buf: Buffer): number {
  if (buf.length < 2) return -1
  if (buf[0] !== 0xff || buf[1] !== SOI) throw new Error('not a JPEG image (no SOI marker)')
  let i = 2
  let inScan = false
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) {
      if (!inScan) throw new Error(`invalid JPEG marker at byte ${i}`)
      i = buf.indexOf(0xff, i)
      if (i < 0) return -1
      continue
    }
    const marker = buf[i + 1]!
    if (marker === 0xff) { i += 1; continue }                            // fill byte before a marker
    if (inScan && (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))) { i += 2; continue }   // stuffing, restart marker
    if (marker === EOI) return i + 2
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }               // markers without a length
    if (i + 3 >= buf.length) return -1
    i += 2 + buf.readUInt16BE(i + 2)
    inScan = marker === SOS
  }
  return -1
}

/**
 * Accumulates arbitrary chunks and returns the complete images as they come. Unreadable bytes are
 * dropped up to the next start of image, from which the splitting resumes; `dropped` counts them.
 */
export class JpegSplitter {
  private pending: Buffer = Buffer.alloc(0)
  dropped = 0

  push(chunk: Buffer): Buffer[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    const out: Buffer[] = []
    for (;;) {
      let end: number
      try { end = jpegLength(this.pending) }
      catch {
        const next = this.pending.indexOf(SOI_BYTES, 1)
        this.dropped += next > 0 ? next : this.pending.length
        this.pending = next > 0 ? this.pending.subarray(next) : Buffer.alloc(0)
        continue
      }
      if (end < 0) return out
      out.push(Buffer.from(this.pending.subarray(0, end)))   // a copy: a kept image must not pin the whole chunk
      this.pending = this.pending.subarray(end)
    }
  }
}
