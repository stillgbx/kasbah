import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { currentAssistantEngine, type AssistantEvent } from '../../assistant/engines'
import { systemClock } from '../../core/clock'
import { stateFile, userStateFile } from '../../core/paths'
import type { PluginContext } from '../../core/plugin'
import { describeError, sendError } from '../../http/errors'
import type { SpawnFn } from '../../music/proxy'
import { claudeConfigSchema, createClaudePlugin } from '.'
import { FakeChild, fakeClaude, happy } from './test-claude'

// The plugin: each account's Claude subscription (never returned to the browser), health (`claude`
// version, missing binary), and the engine registered while it runs.

const stateDir = process.env.KASBAH_STATE_DIR
let fake: ReturnType<typeof fakeClaude>

const ctx = (env: Record<string, string> = {}): PluginContext => ({
  // the config as the host hands it over: ALREADY validated (booleans included)
  pluginId: 'claude', config: claudeConfigSchema.parse(env), logger: pino({ level: 'silent' }), clock: systemClock, signal: new AbortController().signal,
  emitState() {}, setAvailable() {}, emitDevices() {}, emitScenes() {}, emitSceneState() {}, emitEvent() {}, parts: {}, site: { lat: 0, lon: 0, alt: 0 },
})

const saveToken = (user: string | null, token: string) => {
  const file = user === null ? stateFile('claude.json') : userStateFile(user, 'claude.json')
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify({ token, savedAt: 1 }))
}

async function started(spawnImpl: SpawnFn = fake.spawnImpl, env: Record<string, string> = {}) {
  const plugin = createClaudePlugin({ spawnImpl, workDir: mkdtempSync(join(tmpdir(), 'kasbah-claude-')) })
  await plugin.init(ctx(env))
  await plugin.start()
  return plugin
}

/** An instruction through the registered engine, the way the core runs it. */
async function ask(user: string | null) {
  const events: AssistantEvent[] = []
  await currentAssistantEngine()!.run({
    user, text: 'Allume le salon', systemPrompt: 'p', mcp: { url: 'http://127.0.0.1:8787/mcp', token: 'run' },
    emit: (e) => events.push(e), signal: new AbortController().signal,
  })
  return events
}

beforeEach(() => {
  fake = fakeClaude(() => happy)
  process.env.KASBAH_STATE_DIR = mkdtempSync(join(tmpdir(), 'kasbah-claude-state-'))
})
afterEach(() => { process.env.KASBAH_STATE_DIR = stateDir })

it('registers the engine on start and removes it on stop',async () => {
  const plugin = await started()
  expect(currentAssistantEngine()?.id).toBe('claude')
  expect((await ask(null)).at(-1)?.type).toBe('done')
  await plugin.stop()
  expect(currentAssistantEngine()).toBeUndefined()
})

it('runs Haiku 5.5 by default, or the CLAUDE_MODEL model',async () => {
  const model = (i: number) => fake.calls[i]!.args[fake.calls[i]!.args.indexOf('--model') + 1]
  const plugin = await started()
  await ask(null)
  expect(model(0)).toBe('claude-haiku-5-5')
  await plugin.stop()
  const other = await started(fake.spawnImpl, { CLAUDE_MODEL: 'sonnet' })
  await ask(null)
  expect(model(1)).toBe('sonnet')
  expect(other.health!()).toMatchObject({ detail: expect.stringContaining('— sonnet —') })
  await other.stop()
})

it("uses the account's subscription, else the house's, else the machine's sign-in",async () => {
  const plugin = await started()
  await ask('lou')
  expect(fake.calls[0]!.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
  saveToken(null, 'sk-ant-oat01-maison')
  await ask('lou')
  expect(fake.calls[1]!.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-maison')
  saveToken('lou', 'sk-ant-oat01-lou')
  await ask('lou')
  expect(fake.calls[2]!.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-lou')
  await ask(null)
  expect(fake.calls[3]!.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-maison')
  await plugin.stop()
})

it('reports its health: the claude version, or the missing binary',async () => {
  const ok = await started()
  expect(ok.health!()).toMatchObject({ status: 'ok', detail: "claude 2.1.288 — claude-haiku-5-5 — no house token: the server's claude sign-in is used" })
  await ok.stop()
  const missing = (() => {
    const child = new FakeChild({ args: [], env: {}, mcp: null, stdin: '', killed: false })
    setTimeout(() => child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })), 1)
    return child
  }) as unknown as SpawnFn
  const ko = await started(missing)
  expect(ko.health!()).toMatchObject({ status: 'error', detail: 'claude not found (CLAUDE_BIN, or the server PATH)', keys: ['CLAUDE_BIN', 'CLAUDE_MODEL', 'CLAUDE_KEEP_SESSIONS'] })
  await ko.stop()
})

describe('account routes', () => {
  let app: FastifyInstance
  beforeEach(async () => {
    const plugin = createClaudePlugin({ spawnImpl: fake.spawnImpl })
    await plugin.init(ctx())
    app = Fastify()
    app.setErrorHandler((err, _req, reply) => { const d = describeError(err); return sendError(reply, d.status, d.code, d.message) })
    // the request's account, as the session gate sets it
    app.decorateRequest('sessionUser', null)
    app.addHook('onRequest', async (req) => { const u = req.headers['x-test-user']; req.sessionUser = typeof u === 'string' ? u : null })
    await app.register(async (sub) => plugin.registerRoutes!(sub), { prefix: '/api/plugins/claude' })
    await app.ready()
  })
  afterEach(() => app.close())

  it("stores the current account's token and never sends it back",async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/plugins/claude/account', headers: { 'x-test-user': 'lou' }, payload: { token: 'sk-ant-oat01-abcdefghijklmnopqrstuvwxyz' } })
    expect(put.statusCode).toBe(200)
    expect(put.body).not.toContain('sk-ant')
    expect(put.json()).toMatchObject({ user: 'lou', house: false })
    expect(JSON.parse(readFileSync(userStateFile('lou', 'claude.json'), 'utf8')).token).toBe('sk-ant-oat01-abcdefghijklmnopqrstuvwxyz')
    // the house has nothing
    expect((await app.inject({ method: 'GET', url: '/api/plugins/claude/account' })).json()).toEqual({ user: null, savedAt: null, house: false })
    const del = await app.inject({ method: 'DELETE', url: '/api/plugins/claude/account', headers: { 'x-test-user': 'lou' } })
    expect(del.json()).toEqual({ user: 'lou', savedAt: null, house: false })
  })

  it('rejects anything not shaped like a `claude setup-token` token',async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/plugins/claude/account', payload: { token: 'mot de passe' } })
    expect(res.statusCode).toBe(400)
  })
})
