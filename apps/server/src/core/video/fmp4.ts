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

/** Child boxes of a box's payload (`start`..`end`), by type and position. */
function childBoxes(data: Buffer, start: number, end: number): { type: string; body: number; end: number }[] {
  const out: { type: string; body: number; end: number }[] = []
  for (let i = start; i + 8 <= end;) {
    const size = data.readUInt32BE(i)
    if (size < 8 || i + size > end) break
    out.push({ type: data.toString('latin1', i + 4, i + 8), body: i + 8, end: i + size })
    i += size
  }
  return out
}

/** `sample_is_non_sync_sample` in the sample flags of `tfhd` / `trun`. */
const NON_SYNC = 0x10000

/**
 * Does this fragment (`moof`, possibly followed by its `mdat`) start on a keyframe, so that a viewer
 * can decode from it? Each track (`traf`) gives the flags of its first sample — in the `trun` when it
 * carries `first_sample_flags` or per-sample flags, otherwise the `tfhd` default. ffmpeg marks the
 * fragments it cut between two keyframes (`frag_duration`) with a non-sync default on the video
 * track; audio samples are all sync. Unknown flags count as a keyframe: the safe reading for a
 * stream cut at keyframes only.
 */
export function startsWithKeyframe(fragment: Buffer): boolean {
  if (fragment.length < 8 || fragment.toString('latin1', 4, 8) !== 'moof') return true
  const moofEnd = Math.min(fragment.readUInt32BE(0), fragment.length)
  for (const traf of childBoxes(fragment, 8, moofEnd).filter((b) => b.type === 'traf')) {
    const kids = childBoxes(fragment, traf.body, traf.end)
    const tfhd = kids.find((b) => b.type === 'tfhd'), trun = kids.find((b) => b.type === 'trun')
    if (!tfhd || !trun) continue
    const tf = fragment.readUInt32BE(tfhd.body) & 0xffffff
    let p = tfhd.body + 8                               // version/flags, track_ID
    if (tf & 0x01) p += 8                               // base_data_offset
    if (tf & 0x02) p += 4                               // sample_description_index
    if (tf & 0x08) p += 4                               // default_sample_duration
    if (tf & 0x10) p += 4                               // default_sample_size
    const defaultFlags = tf & 0x20 ? fragment.readUInt32BE(p) : undefined
    const rf = fragment.readUInt32BE(trun.body) & 0xffffff
    let q = trun.body + 8                               // version/flags, sample_count
    if (rf & 0x01) q += 4                               // data_offset
    let first: number | undefined
    if (rf & 0x04) first = fragment.readUInt32BE(q)     // first_sample_flags
    else if (rf & 0x400) first = fragment.readUInt32BE(q + (rf & 0x100 ? 4 : 0) + (rf & 0x200 ? 4 : 0))
    else first = defaultFlags
    if (first !== undefined && first & NON_SYNC) return false
  }
  return true
}
