import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { Logger } from 'pino'
import type { Clock } from '../clock'
import { Mp4BoxParser, mseMimeFromMoov, startsWithKeyframe, type Mp4Box } from './fmp4'
import { JpegSplitter } from './jpeg'

// RTSP → fragmented MP4 relay, to show in a browser a camera that only speaks RTSP (the house's
// whole Nest device set). ONE ffmpeg process per watched camera, whatever the number of screens: it
// copies the streams as is (`-c copy`, no re-encoding, so almost no CPU) into a fragmented MP4 that
// Media Source Extensions can read, and this relay distributes it to each subscriber. The first
// fragment sent to a subscriber is always the header (`ftyp` + `moov`), then the fragments
// (`moof` + `mdat`) as they come.
//
// Fragments of half a second (`frag_duration`), and a new one at each keyframe (`frag_keyframe`).
// A fragment is only sent once complete: with one fragment per group of pictures, as before, the
// live stream was always a group of pictures late (four seconds on these cameras). Short fragments
// bring it down to about half a second, but most of them no longer start on a keyframe, and a viewer
// can only decode from one. So the relay keeps every fragment since the last keyframe
// (`startsWithKeyframe`, read in the `moof`) and replays them to a subscriber arriving midway, right
// after the header: the image is there at once, and the player jumps to the live edge.
//
// `rotateSource(url)`: the source may change address midway (at Google, an RTSP session expires
// after five minutes and extending it gives a NEW token, to use on a new connection — the old one
// is cut at the deadline, observed). A second ffmpeg is started on the new address; as soon as it
// delivers its header and a first fragment, it becomes the source, subscribers receive a new header
// (the player shifts its timestamps) and the old one is stopped.

export type RelayMessage =
  | { kind: 'init'; mime: string; data: Buffer }
  /** `key`: the fragment starts on a keyframe — a screen that skipped fragments resumes only on one. */
  | { kind: 'fragment'; data: Buffer; key: boolean }
  | { kind: 'ended'; reason: string }
export type RelaySubscriber = (msg: RelayMessage) => void

export interface RtspRelayOptions {
  ffmpegPath: string
  url: string
  clock: Clock
  logger?: Logger
  /** No subscriber left for this long → `onIdle` (the caller stops the relay and frees the source). */
  idleGraceMs?: number
  onIdle: () => void
  /**
   * The relay stopped BY ITSELF (ffmpeg exited: camera off, stream refused, or a stalled stream).
   * The caller must then free the source too — otherwise the session stays counted and is never
   * returned (seen for real).
   */
  onEnded?: (reason: string) => void
  /**
   * A started stream (header received) that delivers no fragment for this long is stopped as
   * stalled. Seen for real: a camera that drops off the network leaves the vendor's server silent
   * without closing the connection, and ffmpeg waited; the thumbnail only aged. No watchdog when
   * left out.
   */
  stallMs?: number
  /**
   * JPEG thumbnail handed to `onImage` as soon as the stream starts, then every `intervalMs`. It
   * travels through a pipe, never through the disk: up to the caller to keep it in memory. It is the
   * only output that DECODES the video — the MP4 relay only copies — hence a few percent of CPU per
   * camera, whatever the interval: decoding covers every frame, the interval only picks the ones
   * that get encoded.
   */
  snapshot?: { intervalMs: number; width: number; onImage: (jpeg: Buffer) => void }
  /** Injection for tests: replaces `spawn`. */
  spawnImpl?: typeof spawn
}

/** Longest silence of the network connection before ffmpeg gives up: 10 s, in microseconds. */
const RTSP_IO_TIMEOUT_US = 10_000_000
/** Longest fragment: half a second, in microseconds — what the live stream lags by, at least. */
const FRAGMENT_US = 500_000
/** Fragments kept since the last keyframe, at most (a minute at half a second each). */
const MAX_KEPT_FRAGMENTS = 120

/** Erases the token of a stream URL (`?auth=…`) and the signed path before it. */
export function redactStreamUrl(text: string): string {
  return text.replace(/rtsps?:\/\/[^\s'"]+/g, (url) => {
    try { const u = new URL(url); return `${u.protocol}//${u.host}/…` } catch { return 'rtsps://…' }
  })
}

/**
 * The source address, access token included, written for ffmpeg in a file only the server can read:
 * on its command line, any local account would read it (`ps`, `/proc/<pid>/cmdline`). ffmpeg reads
 * its `-i` from nowhere else (`-/i file` is refused: `-i` separates the inputs), hence a one-entry
 * `concat` list. The RTSP options go with the entry: they apply to the stream the list opens.
 *
 * No `fflags nobuffer`, here or on the command line: it makes ffmpeg throw away the packets read
 * while it analyses the stream, so the first keyframe was lost and the first picture came one group
 * of pictures later (measured on a real camera, see the Nest page of the wiki, 2026-10-26).
 *
 * `timeout` (microseconds) bounds each network read: by default there is none, and ffmpeg facing a
 * server that keeps the connection open but sends nothing waited forever (measured against a silent
 * local server: still waiting after 12 s without it, gone after 3 s with a 3 s timeout).
 */
export function writeSourceList(url: string): string {
  const path = join(tmpdir(), `kasbah-rtsp-${randomBytes(8).toString('hex')}.ffconcat`)
  const quoted = url.replaceAll("'", "'\\''")
  writeFileSync(path, `ffconcat version 1.0\nfile '${quoted}'\noption rtsp_transport tcp\noption timeout ${RTSP_IO_TIMEOUT_US}\n`, { mode: 0o600 })
  return path
}

/** ffmpeg read the list when it opened it: once it exits, the file goes, token included. */
function removeSourceList(path: string): void {
  try { unlinkSync(path) } catch { /* already gone */ }
}

/** An ffmpeg process and what was read from its output. */
interface Source {
  proc: ChildProcessWithoutNullStreams
  parser: Mp4BoxParser
  jpegs: JpegSplitter
  ftyp?: Buffer
  moov?: Buffer
  moof?: Buffer
  stderrTail: string
}

export class RtspRelay {
  /** The source feeding the subscribers. */
  private current: Source | null = null
  /** The replacement source, waiting for its header and its first fragment. */
  private next: Source | null = null
  private init: { mime: string; data: Buffer } | undefined
  /** Fragments of the current source since its last keyframe, replayed to a subscriber arriving midway. */
  private sinceKeyframe: Buffer[] = []
  private pendingMoof: Buffer | undefined
  private readonly subscribers = new Set<RelaySubscriber>()
  private idleTimer: unknown = null
  private stallTimer: unknown = null
  private ended: string | null = null

  constructor(private readonly opts: RtspRelayOptions) {}

  get subscriberCount(): number { return this.subscribers.size }
  get hasEnded(): boolean { return this.ended !== null }
  /** The MP4 header went through: the stream really started (a camera that is off never gets there). */
  get ready(): boolean { return this.init !== undefined }

  start(): void {
    if (this.current || this.ended) return
    this.current = this.launch(this.opts.url)
    // A relay starts without a subscriber (opening at the vendor takes a few seconds, and the screen
    // may have left in the meantime): if it gets none within the grace period, it reports itself
    // useless rather than running forever — it happened, with an orphan ffmpeg as the result.
    this.armIdle()
  }

  /** Switches source without a cut: the new ffmpeg replaces the old one as soon as it delivers picture. */
  rotateSource(url: string): void {
    if (this.ended || !this.current) return
    if (this.next) this.discard(this.next, 'superseded')
    this.opts.logger?.info('rtsp relay rotating source')
    this.next = this.launch(url)
  }

  subscribe(fn: RelaySubscriber): void {
    if (this.ended) { fn({ kind: 'ended', reason: this.ended }); return }
    this.subscribers.add(fn)
    this.disarmIdle()
    if (this.init) fn({ kind: 'init', ...this.init })
    if (this.init) this.sinceKeyframe.forEach((data, i) => fn({ kind: 'fragment', data, key: i === 0 }))
  }

  /** A fragment of the current source: kept for latecomers (from its last keyframe on), then sent. */
  private keep(data: Buffer): void {
    const key = startsWithKeyframe(data)
    if (key) this.sinceKeyframe = [data]
    // without a keyframe for too long, the run would grow without end: dropped, a latecomer waits for the next one
    else if (this.sinceKeyframe.length > 0) this.sinceKeyframe = this.sinceKeyframe.length < MAX_KEPT_FRAGMENTS ? [...this.sinceKeyframe, data] : []
    this.armStall()
    this.broadcast({ kind: 'fragment', data, key })
  }

  unsubscribe(fn: RelaySubscriber): void {
    if (!this.subscribers.delete(fn) || this.subscribers.size > 0 || this.ended) return
    this.armIdle()
  }

  /** Stops ffmpeg and notifies the subscribers. Idempotent. */
  stop(reason = 'stopped'): void {
    const sources = [this.current, this.next]
    this.finish(reason)                                 // the caller's reason first: the one from the `exit` that follows adds nothing
    for (const s of sources) if (s) this.kill(s)
  }

  private launch(url: string): Source {
    const list = writeSourceList(url)
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-nostdin',
      '-flags', 'low_delay',
      '-protocol_whitelist', 'file,tcp,tls,rtsp,rtsps,rtp,udp,crypto',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy', '-f', 'mp4', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', '-frag_duration', String(FRAGMENT_US),
      '-reset_timestamps', '1', 'pipe:1',
    ]
    const snap = this.opts.snapshot
    if (snap) {
      // `select` keeps the first decoded frame then one per interval: `fps=1/10` only gave its first
      // image after one and a half intervals (measured with ffmpeg 9.0.2). `-threads 1`: with several
      // threads the JPEG encoder only hands an image over once the NEXT one is chosen, so every image
      // came one interval late — measured, and gone with a single thread.
      const everyS = Math.max(1, Math.round(snap.intervalMs / 1000))
      args.push(
        '-map', '0:v:0', '-vf', `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${everyS})',scale=${snap.width}:-2`,
        '-fps_mode', 'vfr', '-threads', '1', '-q:v', '4', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:3',
      )
    }
    const spawnImpl = this.opts.spawnImpl ?? spawn
    const stdio: ('ignore' | 'pipe')[] = snap ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
    const proc = spawnImpl(this.opts.ffmpegPath, args, { stdio, windowsHide: true }) as unknown as ChildProcessWithoutNullStreams
    const source: Source = { proc, parser: new Mp4BoxParser(), jpegs: new JpegSplitter(), stderrTail: '' }
    proc.stdout.on('data', (chunk: Buffer) => this.onData(source, chunk))
    const images = (proc.stdio as unknown[] | undefined)?.[3] as Readable | undefined
    images?.on('data', (chunk: Buffer) => this.onImageData(source, chunk))
    // ffmpeg only writes to stderr when something is wrong (`-loglevel warning`): the tail is kept for diagnosis
    proc.stderr.on('data', (chunk: Buffer) => {
      // ffmpeg copies the URL into its messages, access token included: it is erased before logging
      const text = redactStreamUrl(chunk.toString('utf8'))
      source.stderrTail = (source.stderrTail + text).slice(-2000)
      this.opts.logger?.debug({ ffmpeg: text.trim() }, 'ffmpeg')
    })
    proc.on('error', (err) => { removeSourceList(list); this.onExit(source, `ffmpeg could not start: ${err.message}`) })
    proc.on('exit', (code, signal) => {
      removeSourceList(list)
      const tail = source.stderrTail.trim().split('\n').at(-1)
      this.onExit(source, `ffmpeg exited (${signal ?? code})${tail ? `: ${tail}` : ''}`)
    })
    return source
  }

  private onExit(source: Source, reason: string): void {
    if (source === this.current) this.finish(reason)
    else if (source === this.next) {
      // the replacement failed: the old source carries on until its end, the caller will react to that
      this.next = null
      this.opts.logger?.warn({ reason }, 'rtsp relay replacement source failed')
    }
  }

  private kill(source: Source): void {
    if (source.proc.exitCode === null) source.proc.kill()
  }

  private discard(source: Source, reason: string): void {
    this.opts.logger?.debug({ reason }, 'rtsp relay source discarded')
    if (source === this.next) this.next = null
    this.kill(source)
  }

  private onData(source: Source, chunk: Buffer): void {
    if (source !== this.current && source !== this.next) return    // source already replaced: its tail is ignored
    let boxes: Mp4Box[]
    try { boxes = source.parser.push(chunk) }
    catch (err) {
      if (source === this.current) this.stop(`bad MP4 stream: ${(err as Error).message}`)
      else this.discard(source, `bad MP4 stream: ${(err as Error).message}`)
      return
    }
    for (const box of boxes) {
      if (source === this.current) this.onCurrentBox(box)
      else this.onNextBox(source, box)
      if (source !== this.current && source !== this.next) return
    }
  }

  /** Thumbnails: only those of the current source; a replacement's become valid once it takes over. */
  private onImageData(source: Source, chunk: Buffer): void {
    if (source !== this.current) return
    const dropped = source.jpegs.dropped
    for (const jpeg of source.jpegs.push(chunk)) this.opts.snapshot?.onImage(jpeg)
    if (source.jpegs.dropped > dropped) this.opts.logger?.warn({ bytes: source.jpegs.dropped - dropped }, 'unreadable bytes in the thumbnail stream')
  }

  private onCurrentBox(box: Mp4Box): void {
    switch (box.type) {
      case 'ftyp': this.current!.ftyp = box.data; break
      case 'moov': {
        const mime = mseMimeFromMoov(box.data)
        if (!mime) { this.stop('unsupported codecs (no avcC in moov)'); return }
        const ftyp = this.current!.ftyp
        this.init = { mime, data: ftyp ? Buffer.concat([ftyp, box.data]) : box.data }
        this.sinceKeyframe = []
        this.armStall()
        this.opts.logger?.info({ mime }, 'rtsp relay ready')
        this.broadcast({ kind: 'init', ...this.init })
        break
      }
      case 'moof': this.pendingMoof = box.data; break
      case 'mdat':
        if (this.pendingMoof) {
          const data = Buffer.concat([this.pendingMoof, box.data])
          this.pendingMoof = undefined
          this.keep(data)
        }
        break
      default: break                                    // `sidx`, `mfra`…: nothing useful for MSE
    }
  }

  /** The replacement source: we wait for its header AND a first complete fragment before switching. */
  private onNextBox(source: Source, box: Mp4Box): void {
    switch (box.type) {
      case 'ftyp': source.ftyp = box.data; break
      case 'moov': source.moov = box.data; break
      case 'moof': source.moof = box.data; break
      case 'mdat': {
        const moof = source.moof
        if (!moof || !source.moov) return
        const mime = mseMimeFromMoov(source.moov)
        if (!mime) { this.discard(source, 'unsupported codecs in replacement source'); return }
        const old = this.current
        this.current = source
        this.next = null
        this.pendingMoof = undefined
        this.init = { mime, data: source.ftyp ? Buffer.concat([source.ftyp, source.moov]) : source.moov }
        this.sinceKeyframe = []
        this.opts.logger?.info({ mime }, 'rtsp relay switched source')
        this.broadcast({ kind: 'init', ...this.init })
        this.keep(Buffer.concat([moof, box.data]))      // ffmpeg starts its output on a keyframe
        if (old) this.kill(old)
        break
      }
      default: break
    }
  }

  private armIdle(): void {
    if (this.idleTimer !== null || this.ended) return
    this.idleTimer = this.opts.clock.setTimeout(() => {
      this.idleTimer = null
      if (this.subscribers.size === 0) this.opts.onIdle()
    }, this.opts.idleGraceMs ?? 5000)
  }

  private disarmIdle(): void {
    if (this.idleTimer !== null) { this.opts.clock.clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  /** (Re)starts the stall countdown: called at the header and at each fragment of the current source. */
  private armStall(): void {
    const ms = this.opts.stallMs
    if (ms === undefined || this.ended) return
    if (this.stallTimer !== null) this.opts.clock.clearTimeout(this.stallTimer)
    this.stallTimer = this.opts.clock.setTimeout(() => {
      this.stallTimer = null
      this.stop(`stalled: no picture for ${Math.round(ms / 1000)} s`)
    }, ms)
  }

  private broadcast(msg: RelayMessage): void {
    // a copy: a subscriber added by one of these calls already got this fragment as its replay
    for (const fn of [...this.subscribers]) fn(msg)
  }

  private finish(reason: string): void {
    if (this.ended) return
    this.ended = reason
    this.disarmIdle()
    if (this.stallTimer !== null) { this.opts.clock.clearTimeout(this.stallTimer); this.stallTimer = null }
    this.opts.onEnded?.(reason)
    this.opts.logger?.info({ reason }, 'rtsp relay ended')
    this.broadcast({ kind: 'ended', reason })
    this.subscribers.clear()
    if (this.next) { this.kill(this.next); this.next = null }
    this.current = null
    this.sinceKeyframe = []
  }
}
