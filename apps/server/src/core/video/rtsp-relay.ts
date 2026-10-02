import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Logger } from 'pino'
import type { Clock } from '../clock'
import { Mp4BoxParser, mseMimeFromMoov, type Mp4Box } from './fmp4'

// Relais RTSP → MP4 fragmenté, pour afficher dans un navigateur une caméra qui ne parle que RTSP
// (tout le parc Nest de la maison). UN processus ffmpeg par caméra regardée, quel que soit le
// nombre d'écrans : il recopie les flux tels quels (`-c copy`, aucun ré-encodage, donc presque
// pas de CPU) dans un MP4 fragmenté que Media Source Extensions sait lire, et ce relais le distribue
// à chaque abonné. Le premier fragment envoyé à un abonné est toujours l'entête (`ftyp` + `moov`),
// puis les fragments (`moof` + `mdat`) au fil de l'eau.
//
// `frag_keyframe` : un fragment par groupe d'images, donc CHAQUE fragment commence par une image
// clé — un abonné qui arrive en cours de route peut décoder dès le premier fragment reçu, sans
// qu'on ait à repérer les images clés soi-même. Le prix : le fragment n'est écrit qu'à l'image clé
// SUIVANTE, donc une latence d'un groupe d'images (une à deux secondes sur ces caméras).
//
// `rotateSource(url)` : la source peut changer d'adresse en cours de route (chez Google, une session
// RTSP expire au bout de cinq minutes et sa prolongation donne un NOUVEAU jeton, à utiliser sur une
// nouvelle connexion — l'ancienne est coupée à l'échéance, constaté). Un second ffmpeg est lancé sur
// la nouvelle adresse ; dès qu'il livre son entête et un premier fragment, il devient la source, les
// abonnés reçoivent une nouvelle entête (le lecteur décale ses horodatages) et l'ancien est arrêté.

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
  /**
   * Le relais s'est arrêté de LUI-MÊME (ffmpeg sorti : caméra éteinte, flux refusé). L'appelant doit
   * alors libérer la source aussi — sinon la session reste comptée et jamais rendue (vu en réel).
   */
  onEnded?: (reason: string) => void
  /**
   * Vignette JPEG écrite dans `path` toutes les `intervalMs` (écriture atomique : le lecteur ne voit
   * jamais un fichier à moitié écrit). C'est la seule sortie qui DÉCODE la vidéo — le relais MP4 ne
   * fait que recopier — donc quelques pourcents de CPU par caméra, quel que soit l'intervalle : le
   * décodage porte sur toutes les images, l'intervalle ne choisit que celles qu'on encode.
   */
  snapshot?: { path: string; intervalMs: number; width: number }
  /** Injection pour les tests : remplace `spawn`. */
  spawnImpl?: typeof spawn
}

/** Efface le jeton d'une URL de flux (`?auth=…`) et le chemin signé qui le précède. */
export function redactStreamUrl(text: string): string {
  return text.replace(/rtsps?:\/\/[^\s'"]+/g, (url) => {
    try { const u = new URL(url); return `${u.protocol}//${u.host}/…` } catch { return 'rtsps://…' }
  })
}

/** Un processus ffmpeg et ce qu'on a lu de sa sortie. */
interface Source {
  proc: ChildProcessWithoutNullStreams
  parser: Mp4BoxParser
  ftyp?: Buffer
  moov?: Buffer
  moof?: Buffer
  stderrTail: string
}

export class RtspRelay {
  /** La source qui alimente les abonnés. */
  private current: Source | null = null
  /** La source de remplacement, en attente de son entête et de son premier fragment. */
  private next: Source | null = null
  private init: { mime: string; data: Buffer } | undefined
  private pendingMoof: Buffer | undefined
  private readonly subscribers = new Set<RelaySubscriber>()
  private idleTimer: unknown = null
  private ended: string | null = null

  constructor(private readonly opts: RtspRelayOptions) {}

  get subscriberCount(): number { return this.subscribers.size }
  get hasEnded(): boolean { return this.ended !== null }
  /** L'entête MP4 est passée : le flux a réellement démarré (une caméra éteinte ne l'atteint jamais). */
  get ready(): boolean { return this.init !== undefined }

  start(): void {
    if (this.current || this.ended) return
    this.current = this.launch(this.opts.url)
    // Un relais démarre sans abonné (l'ouverture chez le fabricant prend quelques secondes, et
    // l'écran a pu repartir entre-temps) : s'il n'en reçoit aucun dans le délai de grâce, il se
    // signale inutile plutôt que de tourner sans fin — c'est arrivé, un ffmpeg orphelin à la clé.
    this.armIdle()
  }

  /** Change de source sans coupure : le nouveau ffmpeg remplace l'ancien dès qu'il livre de l'image. */
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
  }

  unsubscribe(fn: RelaySubscriber): void {
    if (!this.subscribers.delete(fn) || this.subscribers.size > 0 || this.ended) return
    this.armIdle()
  }

  /** Arrête ffmpeg et prévient les abonnés. Idempotent. */
  stop(reason = 'stopped'): void {
    const sources = [this.current, this.next]
    this.finish(reason)                                 // d'abord la raison de l'appelant : celle du `exit` qui suit n'apporte rien
    for (const s of sources) if (s) this.kill(s)
  }

  private launch(url: string): Source {
    const args = [
      // `-y` : la vignette est réécrite en place ; sans lui ffmpeg refuse un fichier déjà là et s'arrête
      '-y', '-hide_banner', '-loglevel', 'warning', '-nostdin',
      '-rtsp_transport', 'tcp', '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-i', url,
      '-c', 'copy', '-f', 'mp4', '-movflags', 'empty_moov+default_base_moof+frag_keyframe', '-reset_timestamps', '1',
      'pipe:1',
    ]
    const snap = this.opts.snapshot
    if (snap) {
      args.push(
        '-map', '0:v:0', '-vf', `fps=1/${Math.max(1, Math.round(snap.intervalMs / 1000))},scale=${snap.width}:-2`,
        '-q:v', '4', '-update', '1', '-atomic_writing', '1', '-f', 'image2', snap.path,
      )
    }
    const spawnImpl = this.opts.spawnImpl ?? spawn
    const proc = spawnImpl(this.opts.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) as unknown as ChildProcessWithoutNullStreams
    const source: Source = { proc, parser: new Mp4BoxParser(), stderrTail: '' }
    proc.stdout.on('data', (chunk: Buffer) => this.onData(source, chunk))
    // ffmpeg n'écrit sur stderr qu'en cas de souci (`-loglevel warning`) : on garde la fin pour le diagnostic
    proc.stderr.on('data', (chunk: Buffer) => {
      // ffmpeg recopie l'URL dans ses messages, jeton d'accès compris : on l'efface avant de journaliser
      const text = redactStreamUrl(chunk.toString('utf8'))
      source.stderrTail = (source.stderrTail + text).slice(-2000)
      this.opts.logger?.debug({ ffmpeg: text.trim() }, 'ffmpeg')
    })
    proc.on('error', (err) => this.onExit(source, `ffmpeg could not start: ${err.message}`))
    proc.on('exit', (code, signal) => {
      const tail = source.stderrTail.trim().split('\n').at(-1)
      this.onExit(source, `ffmpeg exited (${signal ?? code})${tail ? `: ${tail}` : ''}`)
    })
    return source
  }

  private onExit(source: Source, reason: string): void {
    if (source === this.current) this.finish(reason)
    else if (source === this.next) {
      // la relève a échoué : l'ancienne source continue jusqu'à son terme, l'appelant réagira à sa fin
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
    if (source !== this.current && source !== this.next) return    // source déjà remplacée : on ignore sa traîne
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

  private onCurrentBox(box: Mp4Box): void {
    switch (box.type) {
      case 'ftyp': this.current!.ftyp = box.data; break
      case 'moov': {
        const mime = mseMimeFromMoov(box.data)
        if (!mime) { this.stop('unsupported codecs (no avcC in moov)'); return }
        const ftyp = this.current!.ftyp
        this.init = { mime, data: ftyp ? Buffer.concat([ftyp, box.data]) : box.data }
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
      default: break                                    // `sidx`, `mfra`… : rien d'utile pour MSE
    }
  }

  /** La source de remplacement : on attend son entête ET un premier fragment complet avant de basculer. */
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
        this.opts.logger?.info({ mime }, 'rtsp relay switched source')
        this.broadcast({ kind: 'init', ...this.init })
        this.broadcast({ kind: 'fragment', data: Buffer.concat([moof, box.data]) })
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

  private broadcast(msg: RelayMessage): void {
    for (const fn of this.subscribers) fn(msg)
  }

  private finish(reason: string): void {
    if (this.ended) return
    this.ended = reason
    this.disarmIdle()
    this.opts.onEnded?.(reason)
    this.opts.logger?.info({ reason }, 'rtsp relay ended')
    this.broadcast({ kind: 'ended', reason })
    this.subscribers.clear()
    if (this.next) { this.kill(this.next); this.next = null }
    this.current = null
  }
}
