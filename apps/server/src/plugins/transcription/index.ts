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

// Transcription plugin: the assistant's voice. The browser records an instruction (16 kHz mono
// WAV), the server passes it to a transcription engine through the OpenAI-compatible route
// `POST /v1/audio/transcriptions`, and returns the text, which the app sends to the assistant.
//
// Three providers, a single route (the user's decision, 2026-10-07: the local GPU shouldn't
// necessarily be taken by voice):
// - `voicestudio`: the VoiceStudio application, locally (Whisper, Parakeet…), `model: whisper-1`;
// - `vllm`: Voxtral Realtime served by vLLM (WSL2 on a Windows server, 16 GB of GPU);
// - `mistral`: Mistral's API (Voxtral Mini Transcribe), with a key.
// The house's names (rooms, devices, light scenes) go along as vocabulary: `prompt` for the first
// two (Whisper uses it that way), `context_bias` for Mistral (100 at most).
//
// Spoken answers (`speech` sub-item, off by default): the assistant's answer to a DICTATED
// instruction is said aloud, on the device that spoke. Same server, OpenAI-compatible route
// `POST /v1/audio/speech`; at VoiceStudio, `tts-1` designates the active synthesis engine
// (OmniVoice, "fast" profile, the user's decision of 2026-10-07).
//
// Send at the end of the sentence (`autoSend` sub-item, on by default): the app stops listening on
// its own after a silence, without touching the button (detection in the browser,
// `apps/web/src/lib/vad.ts`).
//
// VoiceStudio without its interface (`voicestudio` sub-item, off by default): launched with the
// plugin when `STT_URL` is on this machine and nothing answers there, stopped with it (`voicestudio.ts`).

export const STT_PROVIDERS = ['voicestudio', 'vllm', 'mistral'] as const
export type SttProvider = (typeof STT_PROVIDERS)[number]

/** What each provider uses by default; `STT_URL` / `STT_MODEL` override them. */
const PRESETS: Record<SttProvider, { url: string | null; model: string; hints: 'prompt' | 'context_bias' }> = {
  // VoiceStudio's port is not documented: to be given in `STT_URL`
  voicestudio: { url: null, model: 'whisper-1', hints: 'prompt' },
  vllm: { url: 'http://localhost:8000', model: 'mistralai/Voxtral-Mini-4B-Realtime-2602', hints: 'prompt' },
  mistral: { url: 'https://api.mistral.ai', model: 'voxtral-mini-latest', hints: 'context_bias' },
}

export const transcriptionConfigSchema = z.object({
  STT_PROVIDER: z.enum(STT_PROVIDERS).default('voicestudio'),
  /** Server root (without `/v1`); default depends on the provider. */
  STT_URL: z.string().trim().url().optional(),
  STT_MODEL: z.string().trim().min(1).optional(),
  /** Provider key (`Authorization: Bearer`): required for `mistral`. */
  STT_API_KEY: z.string().trim().min(1).optional(),
  /** Spoken language (ISO 639-1): avoids detection, faster and more reliable on a short sentence. */
  STT_LANGUAGE: z.string().trim().regex(/^[a-z]{2}$/).default('fr'),
  /** Synthesis model for spoken answers; `tts-1` = VoiceStudio's active engine. */
  TTS_MODEL: z.string().trim().min(1).default('tts-1'),
  /** Voice: VoiceStudio profile, `default`, or the provider's voice name. */
  TTS_VOICE: z.string().trim().min(1).default('default'),
  /** VoiceStudio's runtime (`project` folder); default: the one the app records in `%APPDATA%`. */
  VOICESTUDIO_DIR: z.string().trim().min(1).optional(),
})
export type TranscriptionConfig = z.infer<typeof transcriptionConfigSchema>

/** 15 s of instruction as 16 kHz mono WAV = 480 KB, 640 KB in base64: some margin, no more. */
const BODY_LIMIT = 2 * 1024 * 1024
const MAX_HINTS = 100
/** Whisper only reads ~224 tokens of `prompt`: beyond that, nothing helps. */
const MAX_PROMPT = 800
const TIMEOUT_MS = 30_000
/** An assistant answer fits in one or two sentences; beyond that, we cut rather than wait. */
const MAX_SPOKEN = 1000
/** Synthesis is slower than transcription (OmniVoice on the 3060: to be measured). */
const SPEAK_TIMEOUT_MS = 60_000
/** VoiceStudio launched: `/health` answers 503 while loading (torch, models), 200 afterwards. */
const VOICESTUDIO_READY_MS = 180_000
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Settings of the plugin's sheet: the answers' voice. The house's (`.state/transcription.json`, set
 * from the local network) and, on top of it, that of a signed-in account (its state folder);
 * `null` = no choice, the voice of the level below applies (account → house → `TTS_VOICE`).
 */
const settingsFile = (user: string | null) => (user === null ? stateFile('transcription.json') : userStateFile(user, 'transcription.json'))
const settingsSchema = z.object({ voice: z.string().trim().min(1).max(100).nullable().default(null) })
type Settings = z.infer<typeof settingsSchema>

async function readSettings(user: string | null): Promise<Settings> {
  try { return settingsSchema.parse(JSON.parse(await readFile(settingsFile(user), 'utf8'))) } catch { return settingsSchema.parse({}) }
}

/** A voice offered by the provider (`GET /v1/audio/voices`, VoiceStudio's extension to the OpenAI API). */
const voicesSchema = z.object({
  voices: z.array(z.object({ voice_id: z.string(), name: z.string(), type: z.string().optional(), language: z.string().optional() })),
})

export interface TranscriptionPluginDeps {
  fetch?: typeof fetch
  spawnImpl?: SpawnFn
  /** Where to look for `VoiceStudio
untime-location.json` (default `%APPDATA%`). */
  appData?: string
  /** Polling interval while waiting for the launched VoiceStudio (default 2 s). */
  pollMs?: number
}

export function createTranscriptionPlugin(deps: TranscriptionPluginDeps = {}): DevicePlugin {
  const doFetch = deps.fetch ?? fetch
  const spawnImpl = deps.spawnImpl ?? (spawn as unknown as SpawnFn)
  let ctx: PluginContext | null = null
  let target: { provider: SttProvider; url: string | null; model: string; hints: 'prompt' | 'context_bias'; key?: string; language: string; ttsModel: string; ttsVoice: string } | null = null
  /** `speech` sub-item: answers to dictated instructions are said aloud. */
  let speech = false
  /** `autoSend` sub-item: listening stops on its own at the end of the sentence. */
  let autoSend = true
  let lastError: string | null = null
  /** `voicestudio` sub-item: launch VoiceStudio without its interface. */
  let autostart = false
  let studioDir: string | undefined
  /** VoiceStudio as seen by the launch: what health says about it. */
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

  /** `GET /v1/models`: all three expose it; we only read whether it answers. */
  async function probe(): Promise<void> {
    if (!target?.url || missing()) return
    try {
      const res = await doFetch(`${target.url}/v1/models`, { headers: headers(), signal: AbortSignal.timeout(5000) })
      lastError = res.ok ? null : `${target.provider} answered ${res.status} on /v1/models`
    } catch (err) {
      lastError = `${target.provider} unreachable at ${target.url} (${(err as Error).message})`
    }
  }

  /** Does something already answer at the address (the app open, a previous launch)? 503 included. */
  async function answers(url: string): Promise<boolean> {
    try { await doFetch(`${url}/health`, { signal: AbortSignal.timeout(2000) }); return true } catch { return false }
  }

  /** Launches VoiceStudio without its interface if nothing answers at `STT_URL`, then waits until it's ready, without blocking startup. */
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
        } catch { /* not listening yet */ }
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

  /** A call to the provider: unreachable → `DEVICE_UNAVAILABLE`, key refused → `NEEDS_PAIRING`, other refusal → `UPSTREAM_ERROR`. */
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

  /** The answer said aloud: the sound as the provider returns it (WAV requested). */
  async function speak(text: string, words: Record<string, string>, user: string | null): Promise<{ audio: Buffer; type: string }> {
    const t = ready()
    // the account's voice, otherwise the house's, otherwise `TTS_VOICE`
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
      // already validated by the host: validating it again would break a transformed field (doc/6_faq/6_1, re-validated config)
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
      // The app only shows the microphone if the plugin is running and knows where to send the audio.
      app.get('/status', async () => ({ ready: ctx !== null && target !== null && !missing(), provider: target?.provider ?? null, speech: ctx !== null && speech, autoSend: ctx !== null && autoSend }))

      app.post('/transcribe', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
        const body = z.object({
          /** WAV in base64 (the browser encodes it itself: 16 kHz mono). */
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

      // The provider's voices, for the plugin's sheet. At VoiceStudio, the OpenAI aliases (alloy,
      // nova…) all point to the engine's default voice: only the profiles (created voices) are offered.
      app.get('/voices', async () => {
        const res = await call('/v1/audio/voices', { method: 'GET' }, 10_000)
        const list = voicesSchema.parse(await res.json()).voices
        return { voices: list.filter((v) => v.type !== 'openai_alias').map((v) => ({ id: v.voice_id, name: v.name, ...(v.language ? { language: v.language } : {}) })) }
      })

      // The current account's voice: the session's (public address), the house's on the local
      // network. `houseVoice`: what applies to an account that chose nothing.
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

      // The assistant's answer said aloud, played by the browser that dictated the instruction.
      app.post('/speak', async (req, reply) => {
        if (!speech) return sendError(reply, 409, 'SPEECH_DISABLED', 'spoken answers are off (Settings → transcription)')
        const body = z.object({
          text: z.string().trim().min(1).max(4000),
          /** The house's words to say in full: a level's abbreviation → its name ("RDC" → "Rez-de-chaussée"). */
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
