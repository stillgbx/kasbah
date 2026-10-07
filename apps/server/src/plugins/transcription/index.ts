import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { sendError } from '../../http/errors'

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
})
export type TranscriptionConfig = z.infer<typeof transcriptionConfigSchema>

/** 15 s d'instruction en WAV 16 kHz mono = 480 Ko, 640 Ko en base64 : de la marge, pas plus. */
const BODY_LIMIT = 2 * 1024 * 1024
const MAX_HINTS = 100
/** Whisper ne lit que ~224 jetons de `prompt` : au-delà, rien ne sert. */
const MAX_PROMPT = 800
const TIMEOUT_MS = 30_000

export interface TranscriptionPluginDeps {
  fetch?: typeof fetch
}

export function createTranscriptionPlugin(deps: TranscriptionPluginDeps = {}): DevicePlugin {
  const doFetch = deps.fetch ?? fetch
  let ctx: PluginContext | null = null
  let target: { provider: SttProvider; url: string | null; model: string; hints: 'prompt' | 'context_bias'; key?: string; language: string } | null = null
  let lastError: string | null = null

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

  async function transcribe(audio: Buffer, hints: string[]): Promise<string> {
    const t = target
    if (!t) throw new PluginError('DEVICE_UNAVAILABLE', 'transcription plugin is not started')
    const problem = missing()
    if (problem) throw new PluginError('NEEDS_PAIRING', problem)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'instruction.wav')
    form.append('model', t.model)
    form.append('language', t.language)
    const names = [...new Set(hints.map((h) => h.trim()).filter(Boolean))].slice(0, MAX_HINTS)
    if (names.length && t.hints === 'context_bias') for (const n of names) form.append('context_bias', n)
    else if (names.length) form.append('prompt', names.join(', ').slice(0, MAX_PROMPT))

    let res: Response
    try {
      res = await doFetch(`${t.url}/v1/audio/transcriptions`, { method: 'POST', headers: headers(), body: form, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch (err) {
      lastError = `${t.provider} unreachable at ${t.url} (${(err as Error).message})`
      throw new PluginError('DEVICE_UNAVAILABLE', lastError, { cause: err })
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300)
      lastError = `${t.provider} answered ${res.status}${body ? `: ${body}` : ''}`
      throw new PluginError(res.status === 401 || res.status === 403 ? 'NEEDS_PAIRING' : 'UPSTREAM_ERROR', lastError)
    }
    const text = z.object({ text: z.string() }).parse(await res.json()).text.trim()
    lastError = null
    return text
  }

  return {
    id: 'transcription',
    configSchema: transcriptionConfigSchema,

    async init(context) {
      ctx = context
      // déjà validée par l'hôte : la revalider casserait un champ transformé (doc/6_faq/6_1, config re-validée)
      const c = context.config as TranscriptionConfig
      const preset = PRESETS[c.STT_PROVIDER]
      target = {
        provider: c.STT_PROVIDER,
        url: (c.STT_URL ?? preset.url)?.replace(/\/+$/, '').replace(/\/v1$/, '') ?? null,
        model: c.STT_MODEL ?? preset.model,
        hints: preset.hints,
        language: c.STT_LANGUAGE,
        ...(c.STT_API_KEY ? { key: c.STT_API_KEY } : {}),
      }
    },
    async discover() { return [] },
    async start() { await probe() },
    async execute(_externalId, command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `transcription publishes no device (${command.type})`)
    },
    async stop() { ctx = null; target = null },

    registerRoutes(app: FastifyInstance) {
      // L'app ne montre le micro que si le plugin tourne et sait où envoyer l'audio.
      app.get('/status', async () => ({ ready: ctx !== null && target !== null && !missing(), provider: target?.provider ?? null }))

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
    },

    health(): PluginHealth {
      const keys = Object.keys(transcriptionConfigSchema.shape)
      const problem = missing()
      if (problem) return { status: 'needs_pairing', detail: problem, keys }
      if (!target) return { status: 'ok', keys }
      const where = `${target.provider} · ${target.model} at ${target.url}`
      return lastError ? { status: 'degraded', detail: `${where} — ${lastError}`, keys } : { status: 'ok', detail: where, keys }
    },
  }
}
