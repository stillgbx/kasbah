import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { Transform, type TransformCallback } from 'node:stream'

// LAN proxy for Cast/Sonos, shared by all music sources (YouTube Music, Mixcloud…): the speakers
// never see the source host (googlevideo, mixcloud.stream) — only an HTTP URL of the Kasbah server.
// Each source only says where a track's stream is (`ResolvedStream`).
//
// What the speaker receives is a FILE of known size, splittable by byte ranges, without
// downloading anything ahead: it knows its duration and its position, pauses, resumes and seeks on
// its own, and goes idle at the end. Two ways to get there:
//
//  1. RELAY (the normal case) — the source ALREADY IS that file: googlevideo announces an exact size
//     and accepts ranges. Its bytes are passed through as is (AAC in MP4, `player.ts` route `/raw`),
//     without re-encoding: no loss, no ffmpeg.
//  2. ffmpeg FALLBACK — when the source cannot be relayed (no announced size, or only Opus in WebM,
//     which a Sonos cannot play): constant bitrate MP3 at 320 kb/s and 48 kHz, without a Xing or ID3
//     header, so each frame is exactly 960 bytes for 24 ms. The duration then translates into an
//     exact size, and a byte range into a precise instant at which to start ffmpeg. A stream without
//     a duration (a live one) is served the old way, without a size.

export type SpawnFn = (command: string, args: readonly string[], options?: SpawnOptions) => ChildProcessWithoutNullStreams

export interface ResolvedStream {
  url: string
  formatId: string | null
  ext: string | null
  /** Bitrate announced by the source for this format (kb/s): what we receive BEFORE our transcoding. */
  abrKbps: number | null
  /** Exact size of the source stream (bytes), when the source gives it: it makes the relay possible. */
  sizeBytes: number | null
  /** Media duration according to the source (s), otherwise null (live, unknown). */
  durationS: number | null
}

// ---- the MP3 "file": fixed-size frames ------------------------------------------------------------
/**
 * What the proxy serves, always: this fixedness is what makes the size of the "file" computable.
 * 320 kb/s while YouTube gives us 130–160 kb/s already compressed: we gain no detail, we only lose
 * less in re-encoding, for 40 KB/s on the local network.
 * TRAP: the bitrate must give a WHOLE number of bytes per frame (192 → 576, 320 → 960); otherwise
 * the encoder adds a padding bit, frames change size and the whole size promise — hence the
 * duration and the speaker's seeking — falls apart.
 */
export const OUT_BITRATE_KBPS = 320
export const OUT_SAMPLE_RATE_HZ = 48_000
export const OUT_CHANNELS = 2
/** MPEG-1 Layer III: 144 × bitrate / sample rate, without a padding bit. */
export const FRAME_BYTES = (144 * OUT_BITRATE_KBPS * 1000) / OUT_SAMPLE_RATE_HZ
/** 1152 samples at 48 kHz. */
export const FRAME_S = 1152 / 48000
export const BYTES_PER_S = FRAME_BYTES / FRAME_S   // 40 000

/** Size announced for a duration: a whole number of frames, the last partial second included. */
export function lengthFor(durationS: number): number {
  return Math.ceil(durationS / FRAME_S) * FRAME_BYTES
}

/** Instant (s) at which the frame containing this byte starts, and the bytes of that frame to skip. */
export function seekFor(byteOffset: number): { startS: number; skipBytes: number } {
  const frame = Math.floor(byteOffset / FRAME_BYTES)
  return { startS: frame * FRAME_S, skipBytes: byteOffset - frame * FRAME_BYTES }
}

/** `bytes=a-b` range (b optional) clamped to the size; null = no range or impossible range. */
export function parseRange(header: string | undefined, length: number): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  if (a === '') {
    // suffix: the last N bytes
    const n = Number(b)
    return n > 0 ? { start: Math.max(0, length - n), end: length - 1 } : null
  }
  const start = Number(a)
  const end = b === '' ? length - 1 : Math.min(Number(b), length - 1)
  if (!Number.isFinite(start) || start >= length || start > end) return null
  return { start, end }
}

/**
 * Keeps the size promise: passes exactly `total` bytes, dropping what ffmpeg produces in excess
 * (its last frame may overflow the duration) and padding with silence if it stops early (rounded
 * duration, slightly shorter source). `skip` bytes are swallowed first: a range starting in the
 * middle of a frame receives exactly the requested bytes.
 */
export class LengthLock extends Transform {
  private sent = 0
  constructor(private readonly total: number, private skip: number, private readonly silence: Buffer) {
    super()
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    let c = chunk
    if (this.skip > 0) {
      const eat = Math.min(this.skip, c.length)
      this.skip -= eat
      c = c.subarray(eat)
    }
    const room = this.total - this.sent
    if (room <= 0 || c.length === 0) return cb()
    const out = c.length > room ? c.subarray(0, room) : c
    this.sent += out.length
    cb(null, out)
  }

  override _flush(cb: TransformCallback): void {
    let room = this.total - this.sent
    while (room > 0) {
      const out = this.silence.length > room ? this.silence.subarray(0, room) : this.silence
      this.push(out)
      this.sent += out.length
      room -= out.length
    }
    cb()
  }
}

/** A track, wherever it comes from: the source that knows how to find it, and its identifier there. */
export interface TrackRef {
  /** Id of the source plugin (`ytmusic`, `mixcloud`…). */
  source: string
  /** Identifier at the source (YouTube videoId, Mixcloud `/user/mix/` key). */
  id: string
}

export interface SessionMeta {
  title?: string
  artist?: string
  artUrl?: string
  /** Track flagged explicit by the catalog: set again as is on transfer. */
  explicit?: boolean
  /** The format received from the source, to tell the screen what is relayed or transcoded. */
  source?: { ext: string | null; formatId: string | null; abrKbps: number | null }
  /** Track duration (catalog or yt-dlp): it is what sets the size of the "file". */
  durationS?: number
}

export interface ProxySession {
  sid: string
  /**
   * PROBE: serve the source's bytes instead of re-encoding them. googlevideo already announces an
   * exact size and accepts ranges — the "file" the MP3 builds, it provides it.
   */
  raw: boolean
  /** The track being served. */
  track: TrackRef
  deviceId: string
  sourceUrl: string
  createdAt: number
  mime: string
  /** Announced size; null = unknown duration (live), served without a size or ranges. */
  lengthBytes: number | null
  /** What the UI knew about the track at start (catalog): reused as is on transfer. */
  meta: SessionMeta
}

export interface StreamProxyOpts {
  ffmpegPath: string
  spawnImpl?: SpawnFn
  /** TTL of an inactive session (ms). */
  ttlMs?: number
  now?: () => number
}

/**
 * Short sessions: `GET /stream/:sid` starts ffmpeg which reads the source and outputs MP3 on stdout.
 * One session per player; opening the next one closes the previous one of the same player.
 */
export class StreamProxy {
  private readonly sessions = new Map<string, ProxySession>()
  private readonly byDevice = new Map<string, string>()
  private readonly spawnImpl: SpawnFn
  private readonly ttlMs: number
  private readonly now: () => number
  private silence: Promise<Buffer> | null = null

  constructor(private readonly opts: StreamProxyOpts) {
    this.spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
    // Long: a mix several hours long must stay servable, and the speaker requests the file again on
    // every resume or seek.
    this.ttlMs = opts.ttlMs ?? 6 * 3_600_000
    this.now = opts.now ?? (() => Date.now())
  }

  open(track: TrackRef, deviceId: string, sourceUrl: string, meta: SessionMeta = {}, raw?: { mime: string; sizeBytes: number }): ProxySession {
    this.closeDevice(deviceId)
    const sid = randomBytes(12).toString('hex')
    const session: ProxySession = {
      sid, track: { source: track.source, id: track.id }, deviceId, sourceUrl,
      raw: !!raw,
      createdAt: this.now(),
      mime: raw?.mime ?? 'audio/mpeg',
      lengthBytes: raw
        ? raw.sizeBytes
        : meta.durationS && meta.durationS > 0 ? lengthFor(meta.durationS) : null,
      meta,
    }
    this.sessions.set(sid, session)
    this.byDevice.set(deviceId, sid)
    return session
  }

  get(sid: string): ProxySession | undefined {
    const s = this.sessions.get(sid)
    if (!s) return undefined
    if (this.now() - s.createdAt > this.ttlMs) {
      this.close(sid)
      return undefined
    }
    return s
  }

  close(sid: string): void {
    const s = this.sessions.get(sid)
    if (!s) return
    this.sessions.delete(sid)
    if (this.byDevice.get(s.deviceId) === sid) this.byDevice.delete(s.deviceId)
  }

  closeDevice(deviceId: string): void {
    const sid = this.byDevice.get(deviceId)
    if (sid) this.close(sid)
  }

  /** Live session of this player (what it plays from us), otherwise undefined. */
  forDevice(deviceId: string): ProxySession | undefined {
    const sid = this.byDevice.get(deviceId)
    return sid ? this.get(sid) : undefined
  }

  /** Live sessions, one per player. */
  list(): ProxySession[] {
    return [...this.byDevice.values()].map((sid) => this.get(sid)).filter((s): s is ProxySession => !!s)
  }

  clear(): void {
    this.sessions.clear()
    this.byDevice.clear()
  }

  /** Pipes ffmpeg stdout to the HTTP client. The caller must destroy the process if the client leaves. */
  spawnFfmpeg(sourceUrl: string, startS = 0): ChildProcessWithoutNullStreams {
    // `-ss` BEFORE `-i`: ffmpeg seeks within the source (fast, without decoding what comes before).
    // FIXED-frame output (48 kHz, CBR, no Xing or ID3): see the file header. 60 ms fade-in: a stream
    // starting mid-song begins on an arbitrary sample and clicks without it; at the start of a track
    // it is inaudible.
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      ...(startS > 0 ? ['-ss', startS.toFixed(3)] : []),
      '-i', sourceUrl,
      '-vn', '-af', 'afade=t=in:st=0:d=0.06',
      '-ar', String(OUT_SAMPLE_RATE_HZ), '-ac', String(OUT_CHANNELS),
      '-c:a', 'libmp3lame', '-b:a', `${OUT_BITRATE_KBPS}k`,
      '-write_xing', '0', '-id3v2_version', '0',
      '-f', 'mp3', 'pipe:1',
    ]
    return this.spawnImpl(this.opts.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }

  /** One frame of silence ({@link FRAME_BYTES} bytes), produced once by ffmpeg, to pad up to a promised size. */
  silentFrame(): Promise<Buffer> {
    this.silence ??= new Promise<Buffer>((resolve) => {
      const proc = this.spawnImpl(this.opts.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `anullsrc=r=${OUT_SAMPLE_RATE_HZ}:cl=stereo`, '-t', '0.5',
        '-c:a', 'libmp3lame', '-b:a', `${OUT_BITRATE_KBPS}k`, '-write_xing', '0', '-id3v2_version', '0',
        '-f', 'mp3', 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      const chunks: Buffer[] = []
      proc.stdout.on('data', (c: Buffer) => chunks.push(c))
      const done = () => {
        const all = Buffer.concat(chunks)
        // a whole frame if ffmpeg delivered one, otherwise zeros (decoders ignore them)
        resolve(all.length >= FRAME_BYTES ? all.subarray(0, FRAME_BYTES) : Buffer.alloc(FRAME_BYTES))
      }
      proc.on('close', done)
      proc.on('error', done)
    })
    return this.silence
  }
}
