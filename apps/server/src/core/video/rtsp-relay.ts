import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Logger } from 'pino'
import type { Clock } from '../clock'
import { Mp4BoxParser, mseMimeFromMoov } from './fmp4'

// Relais RTSP → MP4 fragmenté, pour afficher dans un navigateur une caméra qui ne parle que RTSP
// (tout le parc Nest de la maison). UN processus ffmpeg par caméra regardée, quel que soit le
// nombre de tablettes : il recopie les flux tels quels (`-c copy`, aucun ré-encodage, donc presque
// pas de CPU) dans un MP4 fragmenté que Media Source Extensions sait lire, et ce relais le distribue
// à chaque abonné. Le premier fragment envoyé à un abonné est toujours l'entête (`ftyp` + `moov`),
// puis les fragments (`moof` + `mdat`) au fil de l'eau.
//
// `frag_keyframe` : un fragment par groupe d'images, donc CHAQUE fragment commence par une image
// clé — un abonné qui arrive en cours de route peut décoder dès le premier fragment reçu, sans
// qu'on ait à repérer les images clés soi-même. Le prix : le fragment n'est écrit qu'à l'image clé
// SUIVANTE, donc une latence d'un groupe d'images (une à deux secondes sur ces caméras).

export type RelayMessage =
  | { kind: 'init'; mime: string; data: Buffer }
  | { kind: 'fragment'; data: Buffer }
  | { kind: 'ended'; reason: string }
export type RelaySubscriber = (msg: RelayMessage) => void

export interface RtspRelayOptions {
  ffmpegPath: string
  url: string
  clock: Clock
  logger?: Logger
  /** Plus aucun abonné depuis ce délai → `onIdle` (l'appelant arrête le relais et libère la source). */
  idleGraceMs?: number
  onIdle: () => void
  /** Injection pour les tests : remplace `spawn`. */
  spawnImpl?: typeof spawn
}

export class RtspRelay {
  private proc: ChildProcessWithoutNullStreams | null = null
  private readonly parser = new Mp4BoxParser()
  private ftyp: Buffer | undefined
  private init: { mime: string; data: Buffer } | undefined
  private pendingMoof: Buffer | undefined
  private readonly subscribers = new Set<RelaySubscriber>()
  private idleTimer: unknown = null
  private ended: string | null = null
  private stderrTail = ''

  constructor(private readonly opts: RtspRelayOptions) {}

  get subscriberCount(): number { return this.subscribers.size }
  get hasEnded(): boolean { return this.ended !== null }

  start(): void {
    if (this.proc) return
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-nostdin',
      '-rtsp_transport', 'tcp', '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-i', this.opts.url,
      '-c', 'copy', '-f', 'mp4', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', '-reset_timestamps', '1',
      'pipe:1',
    ]
    const spawnImpl = this.opts.spawnImpl ?? spawn
    const proc = spawnImpl(this.opts.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) as unknown as ChildProcessWithoutNullStreams
    this.proc = proc
    proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    // ffmpeg n'écrit sur stderr qu'en cas de souci (`-loglevel warning`) : on garde la fin pour le diagnostic
    proc.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-2000)
      this.opts.logger?.debug({ ffmpeg: chunk.toString('utf8').trim() }, 'ffmpeg')
    })
    proc.on('error', (err) => this.finish(`ffmpeg could not start: ${err.message}`))
    proc.on('exit', (code, signal) => {
      const tail = this.stderrTail.trim().split('\n').at(-1)
      this.finish(`ffmpeg exited (${signal ?? code})${tail ? `: ${tail}` : ''}`)
    })
    // Un relais démarre sans abonné (l'ouverture chez le fabricant prend quelques secondes, et la
    // tablette a pu repartir entre-temps) : s'il n'en reçoit aucun dans le délai de grâce, il se
    // signale inutile plutôt que de tourner sans fin — c'est arrivé, un ffmpeg orphelin à la clé.
    this.armIdle()
  }

  subscribe(fn: RelaySubscriber): void {
    if (this.ended) { fn({ kind: 'ended', reason: this.ended }); return }
    this.subscribers.add(fn)
    this.disarmIdle()
    if (this.init) fn({ kind: 'init', ...this.init })
  }

  unsubscribe(fn: RelaySubscriber): void {
    if (!this.subscribers.delete(fn) || this.subscribers.size > 0 || this.ended) return
    this.armIdle()
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

  /** Arrête ffmpeg et prévient les abonnés. Idempotent. */
  stop(reason = 'stopped'): void {
    const proc = this.proc
    this.finish(reason)                                 // d'abord la raison de l'appelant : celle du `exit` qui suit n'apporte rien
    if (proc && proc.exitCode === null) proc.kill()
  }

  private onData(chunk: Buffer): void {
    let boxes
    try { boxes = this.parser.push(chunk) }
    catch (err) { this.stop(`bad MP4 stream: ${(err as Error).message}`); return }
    for (const box of boxes) {
      switch (box.type) {
        case 'ftyp': this.ftyp = box.data; break
        case 'moov': {
          const mime = mseMimeFromMoov(box.data)
          if (!mime) { this.stop('unsupported codecs (no avcC in moov)'); return }
          this.init = { mime, data: this.ftyp ? Buffer.concat([this.ftyp, box.data]) : box.data }
          this.opts.logger?.info({ mime }, 'rtsp relay ready')
          this.broadcast({ kind: 'init', ...this.init })
          break
        }
        case 'moof': this.pendingMoof = box.data; break
        case 'mdat':
          if (this.pendingMoof) {
            this.broadcast({ kind: 'fragment', data: Buffer.concat([this.pendingMoof, box.data]) })
            this.pendingMoof = undefined
          }
          break
        default: break                                  // `sidx`, `mfra`… : rien d'utile pour MSE
      }
    }
  }

  private broadcast(msg: RelayMessage): void {
    for (const fn of this.subscribers) fn(msg)
  }

  private finish(reason: string): void {
    if (this.ended) return
    this.ended = reason
    this.disarmIdle()
    this.opts.logger?.info({ reason }, 'rtsp relay ended')
    this.broadcast({ kind: 'ended', reason })
    this.subscribers.clear()
    this.proc = null
  }
}
