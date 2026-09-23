import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { Transform, type TransformCallback } from 'node:stream'

// Proxy LAN pour Cast/Sonos, commun à toutes les sources musicales (YouTube Music, Mixcloud…) : les
// enceintes ne voient jamais l'hôte de la source (googlevideo, mixcloud.stream) — seulement une URL
// HTTP du serveur Kasbah. Chaque source dit seulement où est le flux d'une piste (`ResolvedStream`).
//
// Ce que l'enceinte reçoit est un FICHIER de taille connue, découpable par plages d'octets, sans
// rien télécharger d'avance : elle en connaît la durée et sa position, met en pause, reprend et se
// déplace toute seule, et passe au repos à la fin. Deux façons d'y arriver :
//
//  1. RELAIS (le cas normal) — la source EST déjà ce fichier : googlevideo annonce une taille exacte
//     et accepte les plages. On repasse ses octets tels quels (AAC en MP4, `player.ts` route `/raw`),
//     sans réencoder : aucune perte, aucun ffmpeg.
//  2. REPLI ffmpeg — quand la source n'est pas relayable (pas de taille annoncée, ou seulement de
//     l'Opus en WebM, qu'un Sonos ne lit pas) : MP3 à débit constant 320 kb/s à 48 kHz, sans en-tête
//     Xing ni ID3, donc chaque trame fait exactement 960 octets pour 24 ms. La durée se traduit alors
//     en taille exacte, et une plage d'octets en instant précis où lancer ffmpeg. Un flux sans durée
//     (un direct) est servi à l'ancienne, sans taille.

export type SpawnFn = (command: string, args: readonly string[], options?: SpawnOptions) => ChildProcessWithoutNullStreams

export interface ResolvedStream {
  url: string
  formatId: string | null
  ext: string | null
  /** Débit annoncé par la source pour ce format (kb/s) : ce qu'on reçoit AVANT notre transcodage. */
  abrKbps: number | null
  /** Taille exacte du flux source (octets), quand la source la donne : elle rend le relais possible. */
  sizeBytes: number | null
  /** Durée du média d'après la source (s), sinon null (direct, inconnue). */
  durationS: number | null
}

// ---- le « fichier » MP3 : trames de taille fixe ---------------------------------------------------
/**
 * Ce que le proxy sert, toujours : c'est cette fixité qui rend la taille du « fichier » calculable.
 * 320 kb/s alors que YouTube nous donne du 130–160 kb/s déjà compressé : on n'y gagne aucune
 * finesse, on perd seulement moins au réencodage, pour 40 ko/s sur le réseau local.
 * PIÈGE : le débit doit donner un nombre ENTIER d'octets par trame (192 → 576, 320 → 960) ; sinon
 * l'encodeur ajoute un bit de bourrage, les trames changent de taille et toute la promesse de
 * taille — donc la durée et le déplacement de l'enceinte — tombe.
 */
export const OUT_BITRATE_KBPS = 320
export const OUT_SAMPLE_RATE_HZ = 48_000
export const OUT_CHANNELS = 2
/** MPEG-1 Layer III : 144 × débit / échantillonnage, sans bit de bourrage. */
export const FRAME_BYTES = (144 * OUT_BITRATE_KBPS * 1000) / OUT_SAMPLE_RATE_HZ
/** 1152 échantillons à 48 kHz. */
export const FRAME_S = 1152 / 48000
export const BYTES_PER_S = FRAME_BYTES / FRAME_S   // 40 000

/** Taille annoncée pour une durée : un nombre entier de trames, la dernière seconde partielle comprise. */
export function lengthFor(durationS: number): number {
  return Math.ceil(durationS / FRAME_S) * FRAME_BYTES
}

/** Instant (s) où commence la trame qui contient cet octet, et les octets de cette trame à sauter. */
export function seekFor(byteOffset: number): { startS: number; skipBytes: number } {
  const frame = Math.floor(byteOffset / FRAME_BYTES)
  return { startS: frame * FRAME_S, skipBytes: byteOffset - frame * FRAME_BYTES }
}

/** Plage `bytes=a-b` (b optionnel) ramenée à la taille ; null = pas de plage ou plage impossible. */
export function parseRange(header: string | undefined, length: number): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  if (a === '') {
    // suffixe : les N derniers octets
    const n = Number(b)
    return n > 0 ? { start: Math.max(0, length - n), end: length - 1 } : null
  }
  const start = Number(a)
  const end = b === '' ? length - 1 : Math.min(Number(b), length - 1)
  if (!Number.isFinite(start) || start >= length || start > end) return null
  return { start, end }
}

/**
 * Tient la promesse de taille : passe exactement `total` octets, en jetant ce que ffmpeg produit
 * en trop (sa dernière trame peut déborder de la durée) et en complétant par du silence s'il
 * s'arrête avant (durée arrondie, source un peu plus courte). `skip` octets sont d'abord avalés :
 * une plage qui commence au milieu d'une trame reçoit exactement les octets demandés.
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

/** Une piste, d'où qu'elle vienne : la source qui sait la trouver, et son identifiant chez elle. */
export interface TrackRef {
  /** Id du plugin source (`ytmusic`, `mixcloud`…). */
  source: string
  /** Identifiant chez la source (videoId YouTube, clé `/user/mix/` Mixcloud). */
  id: string
}

export interface SessionMeta {
  title?: string
  artist?: string
  artUrl?: string
  /** Titre marqué explicit par le catalogue : reposé tel quel au transfert. */
  explicit?: boolean
  /** Le format reçu de la source, pour dire à l'écran ce qu'on relaie ou transcode. */
  source?: { ext: string | null; formatId: string | null; abrKbps: number | null }
  /** Durée du titre (catalogue ou yt-dlp) : c'est elle qui fixe la taille du « fichier ». */
  durationS?: number
}

export interface ProxySession {
  sid: string
  /**
   * SONDE : servir les octets de la source au lieu de les réencoder. googlevideo annonce déjà une
   * taille exacte et accepte les plages — le « fichier » que le MP3 fabrique, il le fournit.
   */
  raw: boolean
  /** La piste servie. */
  track: TrackRef
  deviceId: string
  sourceUrl: string
  createdAt: number
  mime: string
  /** Taille annoncée ; null = durée inconnue (direct), servi sans taille ni plages. */
  lengthBytes: number | null
  /** Ce que l'UI savait du titre au lancement (catalogue) : réutilisé tel quel au transfert. */
  meta: SessionMeta
}

export interface StreamProxyOpts {
  ffmpegPath: string
  spawnImpl?: SpawnFn
  /** TTL d'une session inactive (ms). */
  ttlMs?: number
  now?: () => number
}

/**
 * Sessions courtes : `GET /stream/:sid` lance ffmpeg qui lit la source et sort du MP3 sur stdout.
 * Une session par lecteur ; ouvrir la suivante ferme la précédente du même lecteur.
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
    // Longtemps : un mix de plusieurs heures doit rester servable, et l'enceinte redemande le fichier
    // à chaque reprise ou déplacement.
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

  /** Session vivante de ce lecteur (ce qu'il joue de nous), sinon undefined. */
  forDevice(deviceId: string): ProxySession | undefined {
    const sid = this.byDevice.get(deviceId)
    return sid ? this.get(sid) : undefined
  }

  /** Sessions vivantes, une par lecteur. */
  list(): ProxySession[] {
    return [...this.byDevice.values()].map((sid) => this.get(sid)).filter((s): s is ProxySession => !!s)
  }

  clear(): void {
    this.sessions.clear()
    this.byDevice.clear()
  }

  /** Pipe ffmpeg stdout vers le client HTTP. Le caller doit détruire le processus si le client part. */
  spawnFfmpeg(sourceUrl: string, startS = 0): ChildProcessWithoutNullStreams {
    // `-ss` AVANT `-i` : ffmpeg se place dans la source (rapide, sans décoder ce qui précède).
    // Sortie à trames FIXES (48 kHz, CBR, ni Xing ni ID3) : voir l'en-tête du fichier. Fondu
    // d'entrée de 60 ms : un flux qui démarre en milieu de morceau commence sur un échantillon
    // quelconque et claque sans lui ; au début d'un titre il est inaudible.
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

  /** Une trame de silence ({@link FRAME_BYTES} octets), produite une fois par ffmpeg, pour compléter une taille promise. */
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
        // une trame entière si ffmpeg en a livré, sinon des zéros (les décodeurs les ignorent)
        resolve(all.length >= FRAME_BYTES ? all.subarray(0, FRAME_BYTES) : Buffer.alloc(FRAME_BYTES))
      }
      proc.on('close', done)
      proc.on('error', done)
    })
    return this.silence
  }
}
