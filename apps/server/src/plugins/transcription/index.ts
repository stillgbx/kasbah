import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PluginHealth } from '@kasbah/shared'
import { writeFileAtomic } from '../../core/atomic-file'
import { stateFile, userStateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { sendError } from '../../http/errors'
import type { SpawnFn } from '../../music/proxy'
import { spokenText } from './spoken'
import { findVoiceStudio, killVoiceStudio, spawnVoiceStudio } from './voicestudio'

// Plugin Transcription : la voix de l'assistant. Le navigateur enregistre une instruction (WAV
// 16 kHz mono), le serveur la passe à un moteur de transcription par la route compatible OpenAI
// `POST /v1/audio/transcriptions`, et rend le texte, que l'app envoie à l'assistant.
//
// Trois fournisseurs, une seule route (décision de l'utilisateur, 2026-10-07 : le GPU local ne doit
// pas forcément être pris par la voix) :
// - `voicestudio` : l'application VoiceStudio en local (Whisper, Parakeet…), `model: whisper-1` ;
// - `vllm` : Voxtral Realtime servi par vLLM (WSL2 sur un serveur Windows, 16 Go de GPU) ;
// - `mistral` : l'API de Mistral (Voxtral Mini Transcribe), avec une clé.
// Les noms de la maison (pièces, appareils, ambiances) partent comme vocabulaire : `prompt` pour les
// deux premiers (Whisper l'emploie ainsi), `context_bias` pour Mistral (100 au plus).
//
// Réponses parlées (sous-item `speech`, éteint par défaut) : la réponse de l'assistant à une instruction
// DICTÉE est dite à voix haute, sur l'appareil qui a parlé. Même serveur, route compatible OpenAI
// `POST /v1/audio/speech` ; chez VoiceStudio, `tts-1` désigne le moteur de synthèse actif (OmniVoice,
// profil « fast », décision de l'utilisateur 2026-10-07).
//
// Envoi à la fin de la phrase (sous-item `autoSend`, allumé par défaut) : l'app arrête l'écoute seule
// après un silence, sans toucher au bouton (détection dans le navigateur, `apps/web/src/lib/vad.ts`).
//
// VoiceStudio sans son interface (sous-item `voicestudio`, éteint par défaut) : lancé avec le plugin
// quand `STT_URL` est sur cette machine et que rien n'y répond, arrêté avec lui (`voicestudio.ts`).

export const STT_PROVIDERS = ['voicestudio', 'vllm', 'mistral'] as const
export type SttProvider = (typeof STT_PROVIDERS)[number]

/** Ce que chaque fournisseur prend par défaut ; `STT_URL` / `STT_MODEL` les remplacent. */
const PRESETS: Record<SttProvider, { url: string | null; model: string; hints: 'prompt' | 'context_bias' }> = {
  // le port de VoiceStudio n'est pas documenté : à donner dans `STT_URL`
  voicestudio: { url: null, model: 'whisper-1', hints: 'prompt' },
  vllm: { url: 'http://localhost:8000', model: 'mistralai/Voxtral-Mini-4B-Realtime-2602', hints: 'prompt' },
  mistral: { url: 'https://api.mistral.ai', model: 'voxtral-mini-latest', hints: 'context_bias' },
}

export const transcriptionConfigSchema = z.object({
  STT_PROVIDER: z.enum(STT_PROVIDERS).default('voicestudio'),
  /** Racine du serveur (sans `/v1`) ; défaut selon le fournisseur. */
  STT_URL: z.string().trim().url().optional(),
  STT_MODEL: z.string().trim().min(1).optional(),
  /** Clé du fournisseur (`Authorization: Bearer`) : obligatoire pour `mistral`. */
  STT_API_KEY: z.string().trim().min(1).optional(),
  /** Langue parlée (ISO 639-1) : évite la détection, plus rapide et plus sûre sur une phrase courte. */
  STT_LANGUAGE: z.string().trim().regex(/^[a-z]{2}$/).default('fr'),
  /** Modèle de synthèse des réponses parlées ; `tts-1` = le moteur actif de VoiceStudio. */
  TTS_MODEL: z.string().trim().min(1).default('tts-1'),
  /** Voix : profil VoiceStudio, `default`, ou nom de voix du fournisseur. */
  TTS_VOICE: z.string().trim().min(1).default('default'),
  /** Le runtime de VoiceStudio (dossier `project`) ; défaut : celui que l'app note dans `%APPDATA%`. */
  VOICESTUDIO_DIR: z.string().trim().min(1).optional(),
})
export type TranscriptionConfig = z.infer<typeof transcriptionConfigSchema>

/** 15 s d'instruction en WAV 16 kHz mono = 480 Ko, 640 Ko en base64 : de la marge, pas plus. */
const BODY_LIMIT = 2 * 1024 * 1024
const MAX_HINTS = 100
/** Whisper ne lit que ~224 jetons de `prompt` : au-delà, rien ne sert. */
const MAX_PROMPT = 800
const TIMEOUT_MS = 30_000
/** Une réponse de l'assistant tient en une ou deux phrases ; au-delà, on coupe plutôt que d'attendre. */
const MAX_SPOKEN = 1000
/** La synthèse est plus lente que la transcription (OmniVoice sur la 3060 : à mesurer). */
const SPEAK_TIMEOUT_MS = 60_000
/** VoiceStudio lancé : `/health` répond 503 pendant le chargement (torch, modèles), 200 ensuite. */
const VOICESTUDIO_READY_MS = 180_000
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Réglages de la fiche du plugin : la voix des réponses. Celle de la maison (`.state/transcription.json`,
 * réglée depuis le réseau local) et, par-dessus, celle d'un compte connecté (son dossier d'état) ;
 * `null` = pas de choix, la voix du niveau d'en dessous sert (compte → maison → `TTS_VOICE`).
 */
const settingsFile = (user: string | null) => (user === null ? stateFile('transcription.json') : userStateFile(user, 'transcription.json'))
const settingsSchema = z.object({ voice: z.string().trim().min(1).max(100).nullable().default(null) })
type Settings = z.infer<typeof settingsSchema>

async function readSettings(user: string | null): Promise<Settings> {
  try { return settingsSchema.parse(JSON.parse(await readFile(settingsFile(user), 'utf8'))) } catch { return settingsSchema.parse({}) }
}

/** Une voix proposée par le fournisseur (`GET /v1/audio/voices`, extension de VoiceStudio à l'API OpenAI). */
const voicesSchema = z.object({
  voices: z.array(z.object({ voice_id: z.string(), name: z.string(), type: z.string().optional(), language: z.string().optional() })),
})

export interface TranscriptionPluginDeps {
  fetch?: typeof fetch
  spawnImpl?: SpawnFn
  /** Où chercher `VoiceStudio
untime-location.json` (défaut `%APPDATA%`). */
  appData?: string
  /** Intervalle de l'attente de VoiceStudio lancé (défaut 2 s). */
  pollMs?: number
}

export function createTranscriptionPlugin(deps: TranscriptionPluginDeps = {}): DevicePlugin {
  const doFetch = deps.fetch ?? fetch
  const spawnImpl = deps.spawnImpl ?? (spawn as unknown as SpawnFn)
  let ctx: PluginContext | null = null
  let target: { provider: SttProvider; url: string | null; model: string; hints: 'prompt' | 'context_bias'; key?: string; language: string; ttsModel: string; ttsVoice: string } | null = null
  /** Sous-item `speech` : les réponses aux instructions dictées sont dites à voix haute. */
  let speech = false
  /** Sous-item `autoSend` : l'écoute s'arrête seule à la fin de la phrase. */
  let autoSend = true
  let lastError: string | null = null
  /** Sous-item `voicestudio` : lancer VoiceStudio sans son interface. */
  let autostart = false
  let studioDir: string | undefined
  /** VoiceStudio vu par le lancement : ce que la santé en dit. */
  let studio: { state: 'starting' | 'running' | 'external' | 'failed'; detail: string } | null = null
  let studioChild: ReturnType<typeof spawnVoiceStudio> | null = null
  let studioWait: AbortController | null = null

  const headers = (): Record<string, string> => (target?.key ? { authorization: `Bearer ${target.key}` } : {})
  const missing = (): string | null => {
    if (!target) return null
    if (!target.url) return 'STT_URL is required for voicestudio (the address of its local API)'
    if (target.provider === 'mistral' && !target.key) return 'STT_API_KEY is required for mistral'
    return null
  }

  /** `GET /v1/models` : les trois l'exposent ; on n'en lit que la réponse. */
  async function probe(): Promise<void> {
    if (!target?.url || missing()) return
    try {
      const res = await doFetch(`${target.url}/v1/models`, { headers: headers(), signal: AbortSignal.timeout(5000) })
      lastError = res.ok ? null : `${target.provider} answered ${res.status} on /v1/models`
    } catch (err) {
      lastError = `${target.provider} unreachable at ${target.url} (${(err as Error).message})`
    }
  }

  /** Quelque chose répond-il déjà à l'adresse (l'app ouverte, un lancement précédent) ? 503 compris. */
  async function answers(url: string): Promise<boolean> {
    try { await doFetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }); return true } catch { return false }
  }

  /** Lance VoiceStudio sans son interface si rien ne répond à `STT_URL`, puis attend qu'il soit prêt, sans bloquer le démarrage. */
  async function launchStudio(): Promise<void> {
    const t = target
    if (!t?.url || t.provider !== 'voicestudio') return
    const url = new URL(t.url)
    if (!LOOPBACK.has(url.hostname)) { studio = { state: 'failed', detail: `not launched: STT_URL ${t.url} is not on this machine` }; return }
    if (await answers(t.url)) { studio = { state: 'external', detail: 'already running, not launched by Kasbah' }; return }
    const runtime = await findVoiceStudio(studioDir, deps.appData)
    if (typeof runtime === 'string') { studio = { state: 'failed', detail: runtime }; return }
    const launched = spawnVoiceStudio(spawnImpl, runtime, Number(url.port || 80))
    studioChild = launched
    studio = { state: 'starting', detail: 'starting (launched by Kasbah)' }
    const wait = new AbortController()
    studioWait = wait
    launched.child.on('error', (err) => { studio = { state: 'failed', detail: `could not start: ${err.message}` }; wait.abort() })
    launched.child.on('exit', (code) => {
      if (studioChild !== launched) return
      studioChild = null
      wait.abort()
      studio = { state: 'failed', detail: `exited with code ${code}${launched.tail() ? `: ${launched.tail()}` : ''}` }
      ctx?.logger.warn({ code }, 'VoiceStudio exited')
    })
    void (async () => {
      const until = Date.now() + VOICESTUDIO_READY_MS
      while (!wait.signal.aborted && Date.now() < until) {
        await new Promise((r) => setTimeout(r, deps.pollMs ?? 2000))
        if (wait.signal.aborted) return
        try {
          const res = await doFetch(`${t.url}/health`, { signal: AbortSignal.timeout(2000) })
          if (res.ok) {
            studio = { state: 'running', detail: 'launched by Kasbah' }
            ctx?.logger.info('VoiceStudio ready')
            await probe()
            return
          }
        } catch { /* pas encore à l'écoute */ }
      }
      if (!wait.signal.aborted) studio = { state: 'failed', detail: `not ready after ${VOICESTUDIO_READY_MS / 1000} s` }
    })()
  }

  function ready() {
    const t = target
    if (!t) throw new PluginError('DEVICE_UNAVAILABLE', 'transcription plugin is not started')
    const problem = missing()
    if (problem) throw new PluginError('NEEDS_PAIRING', problem)
    return t
  }

  /** Un appel au fournisseur : injoignable → `DEVICE_UNAVAILABLE`, clé refusée → `NEEDS_PAIRING`, autre refus → `UPSTREAM_ERROR`. */
  async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const t = ready()
    let res: Response
    try {
      res = await doFetch(`${t.url}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      lastError = `${t.provider} unreachable at ${t.url} (${(err as Error).message})`
      throw new PluginError('DEVICE_UNAVAILABLE', lastError, { cause: err })
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      lastError = `${t.provider} answered ${res.status}${body ? `: ${body}` : ''}`
      throw new PluginError(res.status === 401 || res.status === 403 ? 'NEEDS_PAIRING' : 'UPSTREAM_ERROR', lastError)
    }
    lastError = null
    return res
  }

  async function transcribe(audio: Buffer, hints: string[]): Promise<string> {
    const t = ready()
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'instruction.wav')
    form.append('model', t.model)
    form.append('language', t.language)
    const names = [...new Set(hints.map((h) => h.trim()).filter(Boolean))].slice(0, MAX_HINTS)
    if (names.length && t.hints === 'context_bias') for (const n of names) form.append('context_bias', n)
    else if (names.length) form.append('prompt', names.join(', ').slice(0, MAX_PROMPT))

    const res = await call('/v1/audio/transcriptions', { method: 'POST', body: form }, TIMEOUT_MS)
    return z.object({ text: z.string() }).parse(await res.json()).text.trim()
  }

  /** La réponse dite à voix haute : le son tel que le fournisseur le rend (WAV demandé). */
  async function speak(text: string, words: Record<string, string>, user: string | null): Promise<{ audio: Buffer; type: string }> {
    const t = ready()
    // la voix du compte, sinon celle de la maison, sinon `TTS_VOICE`
    const voice = (user === null ? null : (await readSettings(user)).voice) ?? (await readSettings(null)).voice ?? t.ttsVoice
    const res = await call('/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: t.ttsModel, input: spokenText(text, t.language, words).slice(0, MAX_SPOKEN), voice, language: t.language, response_format: 'wav' }),
    }, SPEAK_TIMEOUT_MS)
    return { audio: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') ?? 'audio/wav' }
  }

  return {
    id: 'transcription',
    configSchema: transcriptionConfigSchema,
    parts: [
      { id: 'speech', labelKey: 'voice.speakAnswers', enabledByDefault: false },
      { id: 'autoSend', labelKey: 'voice.autoSend', enabledByDefault: true },
      { id: 'voicestudio', labelKey: 'voice.voicestudioAutostart', enabledByDefault: false },
    ],

    async init(context) {
      ctx = context
      speech = context.parts.speech === true
      autoSend = context.parts.autoSend !== false
      autostart = context.parts.voicestudio === true
      // déjà validée par l'hôte : la revalider casserait un champ transformé (doc/6_faq/6_1, config re-validée)
      const c = context.config as TranscriptionConfig
      const preset = PRESETS[c.STT_PROVIDER]
      target = {
        provider: c.STT_PROVIDER,
        url: (c.STT_URL ?? preset.url)?.replace(/\/+$/, '').replace(/\/v1$/, '') ?? null,
        model: c.STT_MODEL ?? preset.model,
        hints: preset.hints,
        language: c.STT_LANGUAGE,
        ttsModel: c.TTS_MODEL,
        ttsVoice: c.TTS_VOICE,
        ...(c.STT_API_KEY ? { key: c.STT_API_KEY } : {}),
      }
      studioDir = c.VOICESTUDIO_DIR
    },
    async discover() { return [] },
    async start() {
      if (autostart && !missing()) await launchStudio()
      if (studio?.state !== 'starting') await probe()
    },
    async execute(_externalId, command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `transcription publishes no device (${command.type})`)
    },
    async stop() {
      studioWait?.abort()
      const launched = studioChild
      studioChild = null
      if (launched) await killVoiceStudio(spawnImpl, launched.child)
      studio = null
      ctx = null
      target = null
    },

    registerRoutes(app: FastifyInstance) {
      // L'app ne montre le micro que si le plugin tourne et sait où envoyer l'audio.
      app.get('/status', async () => ({ ready: ctx !== null && target !== null && !missing(), provider: target?.provider ?? null, speech: ctx !== null && speech, autoSend: ctx !== null && autoSend }))

      app.post('/transcribe', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
        const body = z.object({
          /** WAV en base64 (le navigateur l'encode lui-même : 16 kHz mono). */
          audio: z.string().min(1),
          hints: z.array(z.string().max(80)).max(400).default([]),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'audio (base64 WAV) is required')
        const audio = Buffer.from(body.data.audio, 'base64')
        if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF') return sendError(reply, 400, 'INVALID_BODY', 'audio must be a WAV file')
        const started = Date.now()
        const text = await transcribe(audio, body.data.hints)
        ctx?.logger.info({ provider: target?.provider, ms: Date.now() - started, chars: text.length }, 'transcribed')
        return { text, ms: Date.now() - started }
      })

      // Les voix du fournisseur, pour la fiche du plugin. Les alias OpenAI (alloy, nova…) renvoient tous
      // chez VoiceStudio à la voix par défaut du moteur : seuls les profils (voix créées) sont proposés.
      app.get('/voices', async () => {
        const res = await call('/v1/audio/voices', { method: 'GET' }, 10_000)
        const list = voicesSchema.parse(await res.json()).voices
        return { voices: list.filter((v) => v.type !== 'openai_alias').map((v) => ({ id: v.voice_id, name: v.name, ...(v.language ? { language: v.language } : {}) })) }
      })

      // La voix du compte courant : celle de la session (adresse publique), la maison sur le réseau
      // local. `houseVoice` : ce qui sert au compte qui n'a rien choisi.
      const settingsOf = async (user: string | null) => ({
        user,
        voice: (await readSettings(user)).voice,
        houseVoice: (await readSettings(null)).voice,
        defaultVoice: target?.ttsVoice ?? null,
      })

      app.get('/settings', async (req) => settingsOf(req.sessionUser ?? null))

      app.put('/settings', async (req, reply) => {
        const body = settingsSchema.safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'voice: a voice id, or null for the default')
        const user = req.sessionUser ?? null
        const file = settingsFile(user)
        await mkdir(dirname(file), { recursive: true })
        await writeFileAtomic(file, `${JSON.stringify(body.data)}
`)
        ctx?.logger.info({ user, voice: body.data.voice }, 'spoken answers voice set')
        return settingsOf(user)
      })

      // La réponse de l'assistant dite à voix haute, jouée par le navigateur qui a dicté l'instruction.
      app.post('/speak', async (req, reply) => {
        if (!speech) return sendError(reply, 409, 'SPEECH_DISABLED', 'spoken answers are off (Settings → transcription)')
        const body = z.object({
          text: z.string().trim().min(1).max(4000),
          /** Les mots de la maison à dire en entier : l'abréviation d'un étage → son nom (« RDC » → « Rez-de-chaussée »). */
          words: z.record(z.string().trim().min(1).max(12), z.string().trim().min(1).max(80))
            .refine((w) => Object.keys(w).length <= MAX_HINTS).default({}),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'text is required; words: { abbreviation: name }')
        const started = Date.now()
        const { audio, type } = await speak(body.data.text, body.data.words, req.sessionUser ?? null)
        ctx?.logger.info({ provider: target?.provider, ms: Date.now() - started, bytes: audio.length }, 'spoken')
        return reply.header('cache-control', 'no-store').type(type).send(audio)
      })
    },

    health(): PluginHealth {
      const keys = Object.keys(transcriptionConfigSchema.shape)
      const problem = missing()
      if (problem) return { status: 'needs_pairing', detail: problem, keys }
      if (!target) return { status: 'ok', keys }
      const where = `${target.provider} · ${target.model} at ${target.url}${studio ? ` — VoiceStudio ${studio.detail}` : ''}`
      if (studio?.state === 'starting') return { status: 'degraded', detail: where, keys }
      if (studio?.state === 'failed') return { status: 'error', detail: where, keys }
      return lastError ? { status: 'degraded', detail: `${where} — ${lastError}`, keys } : { status: 'ok', detail: where, keys }
    },
  }
}
