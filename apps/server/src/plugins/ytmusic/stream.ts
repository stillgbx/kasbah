import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toNetscape } from './cookie'

// Résolution de flux (yt-dlp + PO Token) et proxy LAN (ffmpeg → MP3) pour Cast/Sonos.
// Les enceintes ne voient jamais googlevideo.com — seulement une URL HTTP du serveur Kasbah.

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
  let info: { formats?: Array<{ url?: string; format_id?: string; ext?: string; acodec?: string; vcodec?: string; abr?: number; tbr?: number }> ; url?: string; format_id?: string; ext?: string }
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
  return { url: pick.url, formatId: pick.format_id ?? null, ext: pick.ext ?? null }
}

export interface ProxySession {
  sid: string
  videoId: string
  deviceId: string
  sourceUrl: string
  createdAt: number
  mime: string
  /** Décalage de départ (s) : un transfert ou un déplacement reprend le morceau plus loin que son début. */
  startS: number
  /**
   * Reprise « en direct » (transfert) : `startS` vaut la position de la source à cet instant (ms
   * d'horloge). Le décalage définitif n'est fixé qu'au premier `GET /stream`, en y ajoutant le temps
   * écoulé depuis — commande au lecteur, connexion — et l'avance de mise en tampon (`startFor`).
   * Sans lui (lancement, déplacement voulu), `startS` est déjà définitif.
   */
  resumeAt?: number
  /** Dernier `GET /stream` servi : horloge (ms) et raison — pour décider quoi faire à la reconnexion. */
  servedAt?: number
  servedWhy?: ServeReason
  /**
   * Position (s dans le morceau) où l'écoute en était quand la dernière connexion s'est fermée : une
   * pause (le Sonos ARRÊTE un flux et le redemande au Play) reprend ici, quel que soit son délai.
   */
  playedS?: number
  /** Ce que l'UI savait du titre au lancement (catalogue) : réutilisé tel quel au transfert / déplacement. */
  meta: SessionMeta
}

/**
 * Un Sonos SONDE l'URI à sa réception (premier GET, aussitôt refermé) puis la lit pour de bon à la
 * commande Play (second GET, quelques centaines de ms plus tard) : la sonde n'est pas jouée. Le
 * second GET doit donc repartir au MÊME décalage, pas « au temps écoulé » — sinon le premier quart
 * de seconde saute, ou deux décalages différents s'entendent comme un accroc. Ça vaut au lancement,
 * au transfert et à la reprise après pause (le Sonos repose l'URI et sonde à nouveau).
 */
export const PROBE_WINDOW_MS = 1_500
export type ServeReason = 'start' | 'resume' | 'reconnect' | 'probe'

export interface OpenOpts {
  startS?: number
  meta?: SessionMeta
  /** Horloge (ms) à laquelle `startS` a été relevé sur la source d'un transfert. */
  resumeAt?: number
}

export interface SessionMeta {
  title?: string
  artist?: string
  artUrl?: string
  /** Durée catalogue : le flux proxy n'en annonce pas, l'enceinte ne peut donc pas la publier. */
  durationS?: number
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
 * Une session par sid ; on peut en avoir plusieurs (un lecteur = une session typiquement).
 */
export class StreamProxy {
  private readonly sessions = new Map<string, ProxySession>()
  private readonly byDevice = new Map<string, string>()
  private readonly spawnImpl: SpawnFn
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(private readonly opts: StreamProxyOpts) {
    this.spawnImpl = opts.spawnImpl ?? (spawn as unknown as SpawnFn)
    this.ttlMs = opts.ttlMs ?? 3_600_000
    this.now = opts.now ?? (() => Date.now())
  }

  open(videoId: string, deviceId: string, sourceUrl: string, opts: OpenOpts = {}): ProxySession {
    this.closeDevice(deviceId)
    const sid = randomBytes(12).toString('hex')
    const session: ProxySession = {
      sid, videoId, deviceId, sourceUrl,
      createdAt: this.now(),
      mime: 'audio/mpeg',
      startS: Math.max(0, opts.startS ?? 0),
      ...(opts.resumeAt !== undefined ? { resumeAt: opts.resumeAt } : {}),
      meta: opts.meta ?? {},
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

  /**
   * Décalage auquel servir CE `GET /stream`, et pourquoi (`why`, pour le journal) :
   * - `resume` : reprise après transfert — la source a continué d'avancer pendant la commande et la
   *   connexion, et l'enceinte ne jouera le premier octet qu'après avoir rempli son tampon (`leadS`) ;
   *   sans ça, la cible repartait ~1 s en arrière ;
   * - `reconnect` : le même lecteur redemande le flux — après une pause (connexion fermée : on
   *   reprend à la position atteinte à la fermeture, `playedS`, quel que soit le délai) ou pendant
   *   qu'il joue encore (connexion ouverte : on continue au temps écoulé) — au lieu de rejouer ce
   *   qu'il a déjà entendu ;
   * - `probe` : GET qui suit de peu une connexion aussitôt refermée — la sonde de format du Sonos
   *   n'a rien joué, la lecture commence ici, au MÊME décalage ; le délai jusqu'au premier son est
   *   l'affaire de l'avance de tampon `leadS`, pas du temps entre les deux GET ;
   * - `start` : premier service (lancement, déplacement voulu) — `startS` est déjà définitif.
   * `session.startS` reflète toujours le dernier service : c'est lui que l'UI ajoute à la position.
   */
  startFor(session: ProxySession, leadS: number): { startS: number; why: ServeReason } {
    const now = this.now()
    let why: ServeReason = 'start'
    if (session.resumeAt !== undefined) {
      session.startS += Math.max(0, (now - session.resumeAt) / 1000) + Math.max(0, leadS)
      delete session.resumeAt
      why = 'resume'
    } else if (session.servedAt !== undefined) {
      if (session.playedS !== undefined && now - session.servedAt < PROBE_WINDOW_MS) {
        why = 'probe'
      } else {
        session.startS = session.playedS ?? session.startS + (now - session.servedAt) / 1000
        why = 'reconnect'
      }
    }
    session.servedAt = now
    session.servedWhy = why
    delete session.playedS
    return { startS: session.startS, why }
  }

  /**
   * La connexion servie à `servedAt` s'est fermée : retenir où l'écoute en était. Le lecteur joue en
   * temps réel depuis le premier son, venu `leadS` après le début du service — d'où la soustraction.
   * Une connexion plus ancienne (la sonde qui se ferme après la vraie lecture) ne compte pas.
   */
  noteClosed(session: ProxySession, servedAt: number, leadS: number): void {
    if (session.servedAt !== servedAt) return
    const heardS = (this.now() - servedAt) / 1000 - Math.max(0, leadS)
    session.playedS = session.startS + Math.max(0, heardS)
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
    // Fondu d'entrée de 60 ms : un flux qui démarre en milieu de morceau commence sur un échantillon
    // quelconque et claque sans lui ; au début d'un titre il couvre l'amorce de l'encodeur et le
    // premier tampon de l'enceinte (petit craquement entendu au lancement). Inaudible sur une intro.
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      ...(startS > 0 ? ['-ss', startS.toFixed(3)] : []),
      '-i', sourceUrl,
      '-vn', '-af', 'afade=t=in:st=0:d=0.06',
      '-c:a', 'libmp3lame', '-b:a', '192k',
      '-f', 'mp3', 'pipe:1',
    ]
    return this.spawnImpl(this.opts.ffmpegPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }
}

/** Écrit un Netscape temporaire (tests / resolve sans fichier d'état). */
export async function writeTempNetscape(raw: string): Promise<string> {
  const dir = join(tmpdir(), 'kasbah-ytm')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${randomBytes(8).toString('hex')}.netscape`)
  await writeFile(path, toNetscape(raw), 'utf8')
  return path
}
