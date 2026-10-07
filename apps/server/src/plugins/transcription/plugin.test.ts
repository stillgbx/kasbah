import Fastify, { type FastifyInstance } from 'fastify'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { systemClock } from '../../core/clock'
import type { PluginContext } from '../../core/plugin'
import { describeError, sendError } from '../../http/errors'
import { createTranscriptionPlugin, transcriptionConfigSchema } from '.'

// Les trois fournisseurs par la même route compatible OpenAI : ce qui part (adresse, modèle, langue,
// clé, vocabulaire en `prompt` ou en `context_bias`) et ce qui revient (texte, erreurs dites).

interface Sent { url: string; auth: string | null; fields: Record<string, string[]>; file: { name: string; type: string; size: number } | null }

/** Un faux serveur de transcription : relève la requête, répond `answer`. */
function fakeStt(answer: (url: string) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    const fields: Record<string, string[]> = {}
    let file: Sent['file'] = null
    if (init?.body instanceof FormData) {
      init.body.forEach((v, k) => {
        if (typeof v === 'string') (fields[k] ??= []).push(v)
        else file = { name: (v as File).name, type: v.type, size: v.size }
      })
    }
    sent.push({ url, auth: headers.get('authorization'), fields, file })
    return answer(url)
  }) as typeof fetch
  return { sent, fetchImpl }
}

const ok = (url: string) => (url.endsWith('/v1/models') ? Response.json({ data: [] }) : Response.json({ text: '  Allume la cuisine. ' }))
/** Un WAV minimal : l'en-tête RIFF suffit au contrôle de la route. */
const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(40)]).toString('base64')

let app: FastifyInstance | null = null
afterEach(async () => { await app?.close(); app = null })

async function started(env: Record<string, string>, answer: (url: string) => Response | Promise<Response> = ok) {
  const stt = fakeStt(answer)
  const plugin = createTranscriptionPlugin({ fetch: stt.fetchImpl })
  const ctx: PluginContext = {
    // la config telle que l'hôte la donne : DÉJÀ validée
    pluginId: 'transcription', config: transcriptionConfigSchema.parse(env), logger: pino({ level: 'silent' }), clock: systemClock,
    signal: new AbortController().signal, emitState() {}, setAvailable() {}, emitDevices() {}, emitScenes() {}, emitSceneState() {},
    emitEvent() {}, parts: {}, site: { lat: 0, lon: 0, alt: 0 },
  }
  await plugin.init(ctx)
  await plugin.start()
  app = Fastify()
  app.setErrorHandler((err, _req, reply) => { const d = describeError(err); return sendError(reply, d.status, d.code, d.message) })
  await app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/transcription' })
  await app.ready()
  return { plugin, stt, app }
}

const transcribe = (hints: string[] = []) => app!.inject({ method: 'POST', url: '/api/plugins/transcription/transcribe', payload: { audio: wav, hints } })
const lastPost = (sent: Sent[]) => sent.filter((s) => s.url.endsWith('/audio/transcriptions')).at(-1)!

describe('VoiceStudio', () => {
  it('envoie le WAV, whisper-1, la langue et les noms de la maison en `prompt`, sans clé', async () => {
    const { stt } = await started({ STT_URL: 'http://localhost:7860/' })
    const res = await transcribe(['Cuisine', 'Spots cuisine', 'Cuisine', ' '])
    expect(res.json()).toMatchObject({ text: 'Allume la cuisine.' })
    const post = lastPost(stt.sent)
    expect(post.url).toBe('http://localhost:7860/v1/audio/transcriptions')
    expect(post.auth).toBeNull()
    expect(post.fields).toEqual({ model: ['whisper-1'], language: ['fr'], prompt: ['Cuisine, Spots cuisine'] })
    expect(post.file).toMatchObject({ name: 'instruction.wav', type: 'audio/wav' })
  })

  it('sans adresse, dit quoi régler et cache le micro', async () => {
    const { plugin } = await started({})
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing', detail: 'STT_URL is required for voicestudio (the address of its local API)' })
    expect((await app!.inject({ method: 'GET', url: '/api/plugins/transcription/status' })).json()).toEqual({ ready: false, provider: 'voicestudio' })
    expect((await transcribe()).statusCode).toBe(409)
  })
})

describe('vLLM (Voxtral Realtime)', () => {
  it('prend localhost:8000 et le modèle Voxtral par défaut, et retire un `/v1` final de l’adresse', async () => {
    const def = await started({ STT_PROVIDER: 'vllm' })
    await transcribe()
    expect(lastPost(def.stt.sent)).toMatchObject({ url: 'http://localhost:8000/v1/audio/transcriptions', fields: { model: ['mistralai/Voxtral-Mini-4B-Realtime-2602'] } })
    await app!.close(); app = null
    const other = await started({ STT_PROVIDER: 'vllm', STT_URL: 'http://192.168.1.90:8000/v1' })
    await transcribe()
    expect(lastPost(other.stt.sent).url).toBe('http://192.168.1.90:8000/v1/audio/transcriptions')
  })
})

describe('API Mistral', () => {
  it('envoie la clé, voxtral-mini-latest et le vocabulaire en `context_bias` (100 au plus)', async () => {
    const { stt } = await started({ STT_PROVIDER: 'mistral', STT_API_KEY: 'k-test' })
    const names = Array.from({ length: 120 }, (_, i) => `Nom ${i}`)
    await transcribe(names)
    const post = lastPost(stt.sent)
    expect(post.url).toBe('https://api.mistral.ai/v1/audio/transcriptions')
    expect(post.auth).toBe('Bearer k-test')
    expect(post.fields.model).toEqual(['voxtral-mini-latest'])
    expect(post.fields.context_bias).toHaveLength(100)
    expect(post.fields.prompt).toBeUndefined()
  })

  it('sans clé, dit quoi régler', async () => {
    const { plugin } = await started({ STT_PROVIDER: 'mistral' })
    expect(plugin.health!()).toMatchObject({ status: 'needs_pairing', detail: 'STT_API_KEY is required for mistral' })
  })

  it('une clé refusée devient une erreur de réglage, pas une panne', async () => {
    await started({ STT_PROVIDER: 'mistral', STT_API_KEY: 'k-test' }, (url) => (url.endsWith('/v1/models') ? Response.json({}) : new Response('Unauthorized', { status: 401 })))
    const res = await transcribe()
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: 'NEEDS_PAIRING', message: 'mistral answered 401: Unauthorized' })
  })
})

describe('pannes', () => {
  it('un moteur éteint se voit dans la santé dès le démarrage, et la transcription dit 503', async () => {
    const { plugin } = await started({ STT_URL: 'http://localhost:7860' }, () => { throw new Error('ECONNREFUSED') })
    expect(plugin.health!()).toMatchObject({ status: 'degraded' })
    expect(plugin.health!().detail).toContain('voicestudio unreachable at http://localhost:7860 (ECONNREFUSED)')
    expect((await transcribe()).json().error.code).toBe('DEVICE_UNAVAILABLE')
  })

  it('refuse ce qui n’est pas un WAV', async () => {
    await started({ STT_URL: 'http://localhost:7860' })
    const res = await app!.inject({ method: 'POST', url: '/api/plugins/transcription/transcribe', payload: { audio: Buffer.from('OggS0000000000000000000000000000000000000000000').toString('base64') } })
    expect(res.statusCode).toBe(400)
  })
})

