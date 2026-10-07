import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeError, sendError } from '../http/errors'
import { registerAssistantRoutes, runAssistant, type AssistantDeps } from './assistant'
import { registerAssistantEngine, type AssistantEvent, type AssistantRun } from './engines'

// Le cœur de l'assistant, éprouvé avec un moteur factice : le jeton de course, UN dernier mot quoi
// qu'il arrive (client parti, délai, moteur muet ou en panne), une instruction à la fois par compte,
// le journal et sa lecture réservée au réseau local.

const stateDir = process.env.KASBAH_STATE_DIR
let runs: AssistantRun[]
let revoked: string[]
/** Ce que fait le moteur factice d'une instruction. */
let behave: (run: AssistantRun) => Promise<void>
let unregister: (() => void) | null

const answer = async (run: AssistantRun) => {
  run.emit({ type: 'tool', id: 't1', name: 'send_command', input: { deviceId: 'mock:light-living' } })
  run.emit({ type: 'tool_result', id: 't1', ok: true })
  run.emit({ type: 'text', text: 'Le plafonnier du salon est allumé.' })
  run.emit({ type: 'done', ms: 5 })
}
/** Attend d'être annulé, sans rien dire (le contrat d'un moteur). */
const waitAbort = (run: AssistantRun) => new Promise<void>((resolve) => { run.signal.addEventListener('abort', () => resolve()) })

function deps(over: Partial<AssistantDeps> = {}): AssistantDeps {
  return {
    auth: { runToken: (user) => ({ token: `run-${user ?? 'maison'}`, revoke: () => { revoked.push(`run-${user ?? 'maison'}`) } }) },
    mcpUrl: 'http://127.0.0.1:8787/mcp',
    logger: pino({ level: 'silent' }),
    now: () => new Date('2026-10-07T09:00:00Z'),
    ...over,
  }
}

async function ask(user: string | null, d = deps(), signal = new AbortController().signal) {
  const events: AssistantEvent[] = []
  await runAssistant(d, user, 'Allume le salon', (e) => events.push(e), signal)
  return events
}

beforeEach(() => {
  runs = []; revoked = []; behave = answer
  unregister = registerAssistantEngine({ id: 'fake', label: 'Faux', run: async (run) => { runs.push(run); await behave(run) } })
  process.env.KASBAH_STATE_DIR = mkdtempSync(join(tmpdir(), 'kasbah-assistant-state-'))
})
afterEach(() => { unregister?.(); process.env.KASBAH_STATE_DIR = stateDir })

it('passe au moteur l’instruction, le prompt et le MCP par un jeton de course au nom du compte, révoqué à la fin', async () => {
  const events = await ask('lou')
  expect(events.map((e) => e.type)).toEqual(['tool', 'tool_result', 'text', 'done'])
  expect(runs[0]).toMatchObject({ user: 'lou', text: 'Allume le salon', mcp: { url: 'http://127.0.0.1:8787/mcp', token: 'run-lou' } })
  expect(runs[0]!.systemPrompt).toContain('« lou »')
  expect(revoked).toEqual(['run-lou'])
})

it('dit qu’aucun moteur n’est là quand aucun plugin d’assistant ne tourne', async () => {
  unregister!(); unregister = null
  expect(await ask(null)).toEqual([{ type: 'error', code: 'NO_ENGINE', message: 'no assistant plugin is enabled' }])
})

it('arrête le moteur au délai et le dit', async () => {
  behave = waitAbort
  const events = await ask(null, deps({ timeoutMs: 30 }))
  expect(events).toEqual([{ type: 'error', code: 'TIMEOUT', message: 'no answer within 0.03 s' }])
  expect(runs[0]!.signal.aborted).toBe(true)
  expect(revoked).toEqual(['run-maison'])
})

it('arrête le moteur quand le client s’en va, et n’écoute plus ce qu’il dit après', async () => {
  behave = async (run) => { await waitAbort(run); run.emit({ type: 'text', text: 'trop tard' }) }
  const abort = new AbortController()
  const done = ask(null, deps(), abort.signal)
  await vi.waitFor(() => expect(runs).toHaveLength(1))
  abort.abort()
  expect(await done).toEqual([{ type: 'error', code: 'ABORTED', message: 'request closed' }])
})

it('donne un dernier mot à un moteur muet ou en panne, et un seul', async () => {
  behave = async () => {}
  expect(await ask(null)).toEqual([{ type: 'error', code: 'ENGINE_ERROR', message: 'Faux ended without an answer' }])
  behave = async () => { throw new Error('boom') }
  expect(await ask(null)).toEqual([{ type: 'error', code: 'ENGINE_ERROR', message: 'boom' }])
  behave = async (run) => { run.emit({ type: 'done', ms: 1 }); run.emit({ type: 'error', code: 'X', message: 'x' }) }
  expect(await ask(null)).toEqual([{ type: 'done', ms: 1 }])
})

describe('routes', () => {
  let app: FastifyInstance
  beforeEach(async () => {
    app = Fastify()
    app.setErrorHandler((err, _req, reply) => { const d = describeError(err); return sendError(reply, d.status, d.code, d.message) })
    // le compte de la requête, comme le pose la porte à session
    app.decorateRequest('sessionUser', null)
    app.addHook('onRequest', async (req) => { const u = req.headers['x-test-user']; req.sessionUser = typeof u === 'string' ? u : null })
    registerAssistantRoutes(app, deps())
    await app.ready()
  })
  afterEach(() => app.close())

  it('répond en NDJSON, une instruction à la fois par compte', async () => {
    const releases: (() => void)[] = []
    behave = async (run) => { await new Promise<void>((r) => { releases.push(r) }); await answer(run) }
    const first = app.inject({ method: 'POST', url: '/api/assistant/ask', payload: { text: 'Allume le salon' } })
    await vi.waitFor(() => expect(runs).toHaveLength(1))
    const busy = await app.inject({ method: 'POST', url: '/api/assistant/ask', payload: { text: 'Éteins' } })
    expect(busy.statusCode).toBe(409)
    // un autre compte n'attend pas
    const other = app.inject({ method: 'POST', url: '/api/assistant/ask', headers: { 'x-test-user': 'lou' }, payload: { text: 'Éteins' } })
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    releases[0]!()
    const res = await first
    expect(res.headers['content-type']).toContain('application/x-ndjson')
    expect(res.body.trim().split('\n').map((l) => (JSON.parse(l) as AssistantEvent).type)).toEqual(['tool', 'tool_result', 'text', 'done'])
    releases[1]!()
    await other
  })

  it('tient le journal des instructions : compte, outils, réponse, erreur, la plus récente d’abord', async () => {
    await app.inject({ method: 'POST', url: '/api/assistant/ask', headers: { 'x-test-user': 'lou' }, payload: { text: 'Allume le salon' } })
    behave = async (run) => { run.emit({ type: 'error', code: 'MCP_UNAVAILABLE', message: 'Kasbah MCP failed' }) }
    await app.inject({ method: 'POST', url: '/api/assistant/ask', payload: { text: 'Éteins tout' } })
    const log = async () => (await app.inject({ method: 'GET', url: '/api/assistant/log' })).json() as { entries: unknown[] }
    // l'ajout au journal suit la fin de la réponse : sous la charge de la suite complète, il traîne
    await vi.waitFor(async () => expect((await log()).entries).toHaveLength(2), { timeout: 5000 })
    const [last, first] = (await log()).entries
    expect(first).toMatchObject({
      user: 'lou', text: 'Allume le salon', answer: 'Le plafonnier du salon est allumé.', error: null,
      tools: [{ id: 't1', name: 'send_command', input: { deviceId: 'mock:light-living' }, ok: true }],
    })
    expect(last).toMatchObject({ user: null, text: 'Éteins tout', tools: [], answer: '', error: { code: 'MCP_UNAVAILABLE' } })
  })

  it('ne montre le journal qu’au réseau local', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/assistant/log', headers: { 'x-test-user': 'lou' } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('LAN_ONLY')
  })
})
