// Splitting a fragmented MP4 stream (fMP4) into boxes, and reading the bare minimum in `moov` to
// announce the codecs to the browser (`video/mp4; codecs="avc1.…, mp4a.40.2"`) — that is what
// Media Source Extensions demands before the first byte. PURE: Buffers in, Buffers and strings
// out; testable without ffmpeg.

export interface Mp4Box { type: string; data: Buffer }

/**
 * Accumulates arbitrary chunks (what ffmpeg writes to stdout) and returns complete MP4 boxes as
 * they come. A box = size on 4 bytes, type on 4, then the content; size 1 announces a size on
 * 8 bytes (never seen from ffmpeg in fragmented mode, handled anyway).
 */
export class Mp4BoxParser {
  private pending: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): Mp4Box[] {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk
    const out: Mp4Box[] = []
    for (;;) {
      if (this.pending.length < 8) break
      let size = this.pending.readUInt32BE(0)
      let header = 8
      if (size === 1) {
        if (this.pending.length < 16) break
        size = Number(this.pending.readBigUInt64BE(8))
        header = 16
      }
      if (size < header) throw new Error(`invalid MP4 box size ${size}`)
      if (this.pending.length < size) break
      out.push({ type: this.pending.toString('latin1', 4, 8), data: this.pending.subarray(0, size) })
      this.pending = this.pending.subarray(size)
    }
    return out
  }
}

/** First occurrence of a box by its type, at any depth (byte search). */
function findBox(data: Buffer, type: string): Buffer | undefined {
  let from = 0
  for (;;) {
    const i = data.indexOf(type, from, 'latin1')
    if (i < 4) return undefined
    const size = data.readUInt32BE(i - 4)
    if (size >= 8 && i - 4 + size <= data.length) return data.subarray(i - 4, i - 4 + size)
    from = i + 4
  }
}

/**
 * MSE `codecs` string from `moov`: the H.264 profile comes from the `avcC` box (profile,
 * compatibility, level, in hexadecimal); AAC audio is announced as `mp4a.40.2` (AAC-LC, what Nest
 * cameras emit) as soon as an `mp4a` entry exists. Without `avcC`, we cannot describe the video:
 * `undefined`, and the caller refuses the stream rather than sending a wrong string.
 */
export function mseMimeFromMoov(moov: Buffer): string | undefined {
  const avcC = findBox(moov, 'avcC')
  if (!avcC || avcC.length < 12) return undefined
  const hex = (b: number) => b.toString(16).padStart(2, '0').toUpperCase()
  const codecs = [`avc1.${hex(avcC[9]!)}${hex(avcC[10]!)}${hex(avcC[11]!)}`]
  if (findBox(moov, 'mp4a')) codecs.push('mp4a.40.2')
  return `video/mp4; codecs="${codecs.join(', ')}"`
}
