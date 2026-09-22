import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { toNetscape } from './cookie'

// Résolution de flux (yt-dlp + PO Token) et proxy LAN (ffmpeg → MP3) pour Cast/Sonos.
// Les enceintes ne voient jamais googlevideo.com — seulement une URL HTTP du serveur Kasbah.
//
// Le proxy se présente à l'enceinte comme un FICHIER MP3 de taille connue, découpable par plages
// d'octets, sans rien télécharger d'avance : MP3 à débit constant 192 kb/s à 48 kHz, sans en-tête
// Xing ni ID3, donc chaque trame fait exactement 576 octets pour 24 ms. Une durée se traduit en
// taille exacte, une plage d'octets en instant précis où lancer ffmpeg. L'enceinte connaît alors la
// durée et sa position, met en pause, reprend et se déplace toute seule, et passe au repos à la
// fin : plus de décalage à calculer ni de reprise à deviner côté serveur. Un flux sans durée (un
// direct) est servi à l'ancienne, sans taille.

export type SpawnFn = (command: string, args: readonly string[], options?: SpawnOptions) => ChildProcessWithoutNullStreams

export interface StreamResolveOpts {
  videoId: string
  cookieRaw: string
  ytdlpPath: string
  poTokenUrl: string
  /** Fichier Netscape déjà écrit ; sinon on en crée un temporaire. */
  netscapePath?: string
  spawnImpl?: SpawnFn
}

export interface ResolvedStream {
  url: string
  formatId: string | null
  ext: string | null
  /** Durée du média d'après yt-dlp (s), sinon null (direct, inconnue). */
  durationS: number | null
}

/** Ping du générateur PO Token (Music Assistant : `GET {base}/ping`). */
export async function pingPoToken(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/ping`
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(3_000) })
    return r.ok
  } catch {
    return false
  }
}

function runCapture(command: string, args: string[], spawnImpl: SpawnFn): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawnImpl(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')
    proc.stdout.on('data', (c: string) => { stdout += c })
    proc.stderr.on('data', (c: string) => { stderr += c })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * Résout la meilleure URL audio via yt-dlp (client `web_music` + PO Token + runtime JS node).
 * Même idée que Music Assistant `_get_stream_format` ; sans `--js-runtimes` yt-dlp ≥2026
 * ne livre plus que des storyboards.
 */
export async function resolveStreamUrl(opts: StreamResolveOpts): Promise<ResolvedStream> {
  const spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
  let netscapePath = opts.netscapePath
  if (!netscapePath) {
    netscapePath = join(tmpdir(), `kasbah-ytm-${randomBytes(8).toString('hex')}.netscape`)
    await writeFile(netscapePath, toNetscape(opts.cookieRaw), 'utf8')
  }
  const poBase = opts.poTokenUrl.replace(/\/$/, '')
  const pageUrl = `https://music.youtube.com/watch?v=${opts.videoId}`
  // yt-dlp ≥2026.08 : `android_music` n'existe plus (« Skipping unsupported client »).
  // Sans runtime JS, seuls les storyboards restent (challenge n/sig) → « Requested format
  // is not available ». `web_music` + `--js-runtimes node` + PO Token livre m4a/opus.
  // Pas de `-f` : on dump `-J` puis on trie en JS. `--ignore-config` évite un `-f` user.
  const args = [
    '--ignore-config',
    '-J', '--no-download', '--no-warnings',
    '--cookies', netscapePath,
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--extractor-args', `youtubepot-bgutilhttp:base_url=${poBase}`,
    '--extractor-args', 'youtube:player_client=web_music;skip=translated_subs',
    pageUrl,
  ]
  const { code, stdout, stderr } = await runCapture(opts.ytdlpPath, args, spawnImpl)
  if (code !== 0) {
    const tail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ; ')
    throw new Error(`yt-dlp failed (${code})${tail ? `: ${tail}` : ''}`)
  }
  let info: { formats?: Array<{ url?: string; format_id?: string; ext?: string; acodec?: string; vcodec?: string; abr?: number; tbr?: number }> ; url?: string; format_id?: string; ext?: string; duration?: number; is_live?: boolean }
  try { info = JSON.parse(stdout) as typeof info }
  catch { throw new Error('yt-dlp returned non-JSON') }
  // Préférer m4a / 140 / 141, sinon opus/webm, sinon premier format avec audio.
  const formats = info.formats ?? []
  const audio = formats
    .filter((f) => f.url && f.acodec && f.acodec !== 'none' && (f.vcodec === 'none' || !f.vcodec))
    .sort((a, b) => {
      const rank = (f: { ext?: string; format_id?: string; abr?: number; tbr?: number }) => {
        let r = 0
        if (f.format_id === '141') r += 30
        else if (f.format_id === '140' || f.ext === 'm4a') r += 20
        else if (f.ext === 'webm' || f.ext === 'opus') r += 10
        r += f.abr ?? f.tbr ?? 0
        return r
      }
      return rank(b) - rank(a)
    })
  // Fallback : flux muxé (audio+vidéo) s'il n'y a pas d'audio-only — ffmpeg -vn suffit.
  const muxed = formats
    .filter((f) => f.url && f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.abr ?? b.tbr ?? 0) - (a.abr ?? a.tbr ?? 0))
  const pick = audio[0] ?? muxed[0] ?? (info.url ? { url: info.url, format_id: info.format_id, ext: info.ext } : null)
  if (!pick?.url) throw new Error(`no audio stream format found (${formats.length} formats reported)`)
  const durationS = !info.is_live && typeof info.duration === 'number' && info.duration > 0 ? info.duration : null
  return { url: pick.url, formatId: pick.format_id ?? null, ext: pick.ext ?? null, durationS }
}

// ---- le « fichier » MP3 : trames de taille fixe ---------------------------------------------------
/** MPEG-1 Layer III, 48 kHz, 192 kb/s : 144 × 192000 / 48000 = 576 octets par trame, sans bit de bourrage. */
export const FRAME_BYTES = 576
/** 1152 échantillons à 48 kHz. */
export const FRAME_S = 1152 / 48000
export const BYTES_PER_S = FRAME_BYTES / FRAME_S   // 24 000

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

export interface SessionMeta {
  title?: string
  artist?: string
  artUrl?: string
  /** Durée du titre (catalogue ou yt-dlp) : c'est elle qui fixe la taille du « fichier ». */
  durationS?: number
}

export interface ProxySession {
  sid: string
  videoId: string
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
 * Sessions courtes : `GET /stream/:sid` lance ffmpeg qui lit googlevideo et sort du MP3 sur stdout.
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

  open(videoId: string, deviceId: string, sourceUrl: string, meta: SessionMeta = {}): ProxySession {
    this.closeDevice(deviceId)
    const sid = randomBytes(12).toString('hex')
    const session: ProxySession = {
      sid, videoId, deviceId, sourceUrl,
      createdAt: this.now(),
      mime: 'audio/mpeg',
      lengthBytes: meta.durationS && meta.durationS > 0 ? lengthFor(meta.durationS) : null,
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
    // Sortie à trames FIXES (48 kHz, CBR 192k, ni Xing ni ID3) : voir l'en-tête du fichier. Fondu
    // d'entrée de 60 ms : un flux qui démarre en milieu de morceau commence sur un échantillon
    // quelconque et claque sans lui ; au début d'un titre il est inaudible.
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      ...(startS > 0 ? ['-ss', startS.toFixed(3)] : []),
      '-i', sourceUrl,
      '-vn', '-af', 'afade=t=in:st=0:d=0.06',
      '-ar', '48000', '-ac', '2',
      '-c:a', 'libmp3lame', '-b:a', '192k',
      '-write_xing', '0', '-id3v2_version', '0',
      '-f', 'mp3', 'pipe:1',
    ]
    return this.spawnImpl(this.opts.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }

  /** Une trame de silence (576 octets), produite une fois par ffmpeg, pour compléter une taille promise. */
  silentFrame(): Promise<Buffer> {
    this.silence ??= new Promise<Buffer>((resolve) => {
      const proc = this.spawnImpl(this.opts.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.5',
        '-c:a', 'libmp3lame', '-b:a', '192k', '-write_xing', '0', '-id3v2_version', '0',
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
