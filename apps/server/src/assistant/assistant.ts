import { readFile } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../core/atomic-file'
import { stateFile } from '../core/paths'
import { sendError } from '../http/errors'
import type { McpAuth } from '../mcp/auth'
import { currentAssistantEngine, type AssistantEvent } from './engines'

// L'assistant : une instruction en texte, passée au moteur d'un plugin (Claude aujourd'hui), qui
// agit par les outils du MCP de Kasbah et répond en une phrase. Ce qui est commun à tous les moteurs
// vit ici (voir `engines.ts`) :
//
// - la route `/ask`, en flux NDJSON, une instruction à la fois par compte ;
// - le jeton de course MCP au nom du compte qui demande (ses comptes musicaux), révoqué à la fin ;
// - le prompt système, le délai ;
// - le journal (`.state/assistant-log.json`, les 200 dernières), lu dans Réglages depuis le réseau
//   local seulement : on y voit les instructions de chacun.
// Une instruction = un appel, sans mémoire de la précédente.

const TIMEOUT_MS = 60_000
const MAX_TEXT = 2000

/** Une instruction du journal : qui, quoi, les outils appelés, la réponse ou l'erreur. */
export interface AssistantLogEntry {
  at: number
  user: string | null
  text: string
  tools: { id: string; name: string; input: unknown; ok?: boolean }[]
  answer: string
  error: { code: string; message: string } | null
  ms: number
}

const LOG_MAX = 200
/** Une entrée d'outil plus grosse (une liste de 100 titres…) est gardée sans ses arguments. */
const LOG_INPUT_MAX = 2000
const logFile = () => stateFile('assistant-log.json')

async function readLog(file = logFile()): Promise<AssistantLogEntry[]> {
  try {
    const j = JSON.parse(await readFile(file, 'utf8')) as { entries?: unknown }
    return Array.isArray(j.entries) ? j.entries as AssistantLogEntry[] : []
  } catch { return [] }
}

// Deux comptes peuvent finir en même temps : les ajouts passent l'un après l'autre (lire puis écrire).
let logQueue: Promise<void> = Promise.resolve()
function appendLog(entry: AssistantLogEntry, logger: Logger): Promise<void> {
  const file = logFile()
  logQueue = logQueue
    .then(async () => {
      const entries = [entry, ...await readLog(file)].slice(0, LOG_MAX)
      await writeFileAtomic(file, `${JSON.stringify({ entries })}\n`, { mode: 0o600 })
    })
    .catch((err: unknown) => { logger.warn({ err }, 'assistant log not saved') })
  return logQueue
}

/** Ajoute un événement à l'entrée du journal en cours. */
function record(entry: AssistantLogEntry, e: AssistantEvent): void {
  if (e.type === 'text') entry.answer = entry.answer ? `${entry.answer}\n${e.text}` : e.text
  else if (e.type === 'tool') entry.tools.push({ id: e.id, name: e.name, input: JSON.stringify(e.input ?? null).length <= LOG_INPUT_MAX ? e.input : null })
  else if (e.type === 'tool_result') {
    const t = entry.tools.find((x) => x.id === e.id)
    if (t) t.ok = e.ok
  } else if (e.type === 'error') entry.error = { code: e.code, message: e.message }
}

export interface AssistantDeps {
  auth: Pick<McpAuth, 'runToken'>
  /** `/mcp` de CE serveur, joint en local par le moteur. */
  mcpUrl: string
  logger: Logger
  now?: () => Date
  /** Délai d'une instruction (tests). */
  timeoutMs?: number
}

function systemPrompt(user: string | null, now: Date): string {
  const when = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' })
  return [
    "Tu es l'assistant de Kasbah, l'application de la maison connectée. Tu agis uniquement par les outils kasbah.",
    'Exécute la demande sans demander de confirmation, sauf si elle est ambiguë.',
    'Réponds en une ou deux phrases courtes, sans markdown, dans la langue de la demande.',
    `Nous sommes le ${when}.`,
    user ? `La demande vient du compte « ${user} ».` : "La demande vient d'un écran de la maison.",
  ].join(' ')
}

/**
 * Passe l'instruction au moteur et rend ses événements, terminés par UN dernier mot (`done` ou
 * `error`) : celui du moteur, ou celui du cœur quand le client est parti, que le délai a passé ou
 * que le moteur s'est tu.
 */
export async function runAssistant(deps: AssistantDeps, user: string | null, text: string, emit: (e: AssistantEvent) => void, signal: AbortSignal): Promise<void> {
  const engine = currentAssistantEngine()
  if (!engine) { emit({ type: 'error', code: 'NO_ENGINE', message: 'no assistant plugin is enabled' }); return }
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS
  const run = deps.auth.runToken(user, timeoutMs + 10_000)
  const stop = new AbortController()
  let why: AssistantEvent | null = null
  const cancel = (e: AssistantEvent) => { why ??= e; stop.abort() }
  const onAbort = () => cancel({ type: 'error', code: 'ABORTED', message: 'request closed' })
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  const timer = setTimeout(() => cancel({ type: 'error', code: 'TIMEOUT', message: `no answer within ${timeoutMs / 1000} s` }), timeoutMs)

  let last = false
  const forward = (e: AssistantEvent) => {
    if (last || stop.signal.aborted) return
    if (e.type === 'done' || e.type === 'error') last = true
    emit(e)
  }
  try {
    await engine.run({
      user, text, emit: forward, signal: stop.signal,
      systemPrompt: systemPrompt(user, (deps.now ?? (() => new Date()))()),
      mcp: { url: deps.mcpUrl, token: run.token },
    })
  } catch (err) {
    deps.logger.warn({ err, engine: engine.id }, 'assistant engine failed')
    forward({ type: 'error', code: 'ENGINE_ERROR', message: (err as Error).message })
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    run.revoke()
  }
  if (!last) emit(why ?? { type: 'error', code: 'ENGINE_ERROR', message: `${engine.label} ended without an answer` })
}

export function registerAssistantRoutes(app: FastifyInstance, deps: AssistantDeps): void {
  const running = new Set<string>()

  void app.register(async (sub) => {
    // Réponse en flux, une ligne JSON par événement : pas de compression (elle retiendrait les lignes).
    sub.post('/ask', { compress: false }, async (req, reply) => {
      const { text } = z.object({ text: z.string().trim().min(1).max(MAX_TEXT) }).parse(req.body)
      const user = req.sessionUser
      const key = user ?? ''
      if (running.has(key)) return sendError(reply, 409, 'BUSY', 'an instruction is already running for this account')
      running.add(key)
      const out = new PassThrough()
      const abort = new AbortController()
      reply.raw.on('close', () => { if (!reply.raw.writableFinished) abort.abort() })
      const entry: AssistantLogEntry = { at: Date.now(), user, text, tools: [], answer: '', error: null, ms: 0 }
      const emit = (e: AssistantEvent) => { record(entry, e); out.write(`${JSON.stringify(e)}\n`) }
      void runAssistant(deps, user, text, emit, abort.signal)
        .catch((err: Error) => {
          deps.logger.warn({ err }, 'assistant run failed')
          emit({ type: 'error', code: 'INTERNAL', message: err.message })
        })
        .finally(() => {
          running.delete(key)
          out.end()
          entry.ms = Date.now() - entry.at
          void appendLog(entry, deps.logger)
        })
      return reply.header('cache-control', 'no-store').type('application/x-ndjson; charset=utf-8').send(out)
    })

    // Les instructions de TOUS les comptes : depuis le réseau local seulement, comme les comptes.
    sub.get('/log', async (req, reply) => {
      if (req.sessionUser !== null) return sendError(reply, 403, 'LAN_ONLY', 'the assistant log is read from the local network only')
      return { entries: await readLog() }
    })
  }, { prefix: '/api/assistant' })
}
