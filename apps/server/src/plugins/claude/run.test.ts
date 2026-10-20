import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AssistantEvent, AssistantRun } from '../../assistant/engines'
import type { SpawnFn } from '../../music/proxy'
import { runClaude, type ClaudeRunOptions } from './run'
import { FakeChild, fakeClaude, happy, init } from './test-claude'

// `claude -p` for one instruction: what we pass it (lockdown, run token, Claude account) and how its
// output becomes assistant events.

let script: (child: FakeChild) => void
let fake: ReturnType<typeof fakeClaude>
let dir: string

beforeEach(() => {
  script = happy
  fake = fakeClaude(() => script)
  dir = mkdtempSync(join(tmpdir(), 'kasbah-claude-run-'))
})

async function go(over: Partial<ClaudeRunOptions> = {}, signal = new AbortController().signal) {
  const events: AssistantEvent[] = []
  const run: AssistantRun = {
    user: null, text: 'Allume le salon', systemPrompt: 'Tu es l’assistant.',
    mcp: { url: 'http://127.0.0.1:8787/mcp', token: 'run-1' },
    emit: (e) => events.push(e), signal,
  }
  await runClaude({ bin: 'claude', model: 'claude-haiku-5-5', dir, oauthToken: null, keepSessions: false, spawnImpl: fake.spawnImpl, ...over }, run)
  return events
}

it('turns the claude output into events: tool, result, text, end', async () => {
  const events = await go()
  expect(events.map((e) => e.type)).toEqual(['tool', 'tool_result', 'text', 'done'])
  expect(events[0]).toEqual({ type: 'tool', id: 't1', name: 'send_command', input: { deviceId: 'mock:light-living' } })
  expect(events[1]).toEqual({ type: 'tool_result', id: 't1', ok: true })
  expect(events[2]).toEqual({ type: 'text', text: 'Le plafonnier du salon est allumé.' })
  expect(fake.calls[0]!.stdin).toBe('Allume le salon')
})

it('returns what the instruction consumed: cost at API price and tokens, read from the result', async () => {
  const done = (await go()).at(-1)
  expect(done).toMatchObject({ type: 'done', usage: { costUsd: 0.0031, inputTokens: 12, outputTokens: 40, cacheReadTokens: 9000, cacheWriteTokens: 1500 } })
})

it('with no cost in the result (another claude version), the end carries none', async () => {
  script = (child) => { child.line(init()); child.line({ type: 'result', subtype: 'success', is_error: false, result: 'Fait.' }); child.exit() }
  const done = (await go()).at(-1)
  expect(done).toEqual({ type: 'done', ms: expect.any(Number) as number })
})

it('locks claude down: no built-in tool, the Kasbah MCP only, no settings, no kept session', async () => {
  await go()
  const { args } = fake.calls[0]!
  expect(args[args.indexOf('--tools') + 1]).toBe('')
  expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
  expect(args).toContain('--strict-mcp-config')
  expect(args).toContain('--no-session-persistence')
  expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__kasbah')
  expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-5-5')
  expect(args[args.indexOf('--system-prompt') + 1]).toBe('Tu es l’assistant.')
})

it('keeps sessions only on request (CLAUDE_KEEP_SESSIONS)', async () => {
  await go({ keepSessions: true })
  expect(fake.calls[0]!.args).not.toContain('--no-session-persistence')
})

it('reaches the MCP with the run token in a file, deleted at the end, never as an argument', async () => {
  await go()
  const { args, mcp } = fake.calls[0]!
  expect(mcp!.mcpServers.kasbah).toEqual({ type: 'http', url: 'http://127.0.0.1:8787/mcp', headers: { Authorization: 'Bearer run-1' } })
  expect(args.join(' ')).not.toContain('run-1')
  expect(existsSync(args[args.indexOf('--mcp-config') + 1]!)).toBe(false)
})

it("sets the account's Claude subscription, inheriting nothing from the server environment", async () => {
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-herite'
  process.env.ANTHROPIC_API_KEY = 'sk-ant-api-herite'
  try {
    await go()
    expect(fake.calls[0]!.env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(fake.calls[0]!.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(fake.calls[0]!.env.CLAUDE_CONFIG_DIR).toBeUndefined()
    await go({ oauthToken: 'sk-ant-oat01-lou' })
    expect(fake.calls[1]!.env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat01-lou')
    expect(fake.calls[1]!.env.CLAUDE_CONFIG_DIR).toBe(join(dir, 'config'))
  } finally {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.ANTHROPIC_API_KEY
  }
})

it('stops everything if the Kasbah MCP does not answer', async () => {
  script = (child) => { child.line(init('failed')) }
  expect(await go()).toEqual([{ type: 'error', code: 'MCP_UNAVAILABLE', message: 'Kasbah MCP failed' }])
  expect(fake.calls[0]!.killed).toBe(true)
})

it('reports a rejected subscription (401) without showing the synthetic message as an answer', async () => {
  script = (child) => {
    child.line(init())
    child.line({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Failed to authenticate.' }] } })
    child.line({ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, result: 'Failed to authenticate. API Error: 401' })
    child.exit()
  }
  expect(await go()).toEqual([{ type: 'error', code: 'CLAUDE_AUTH', message: 'Failed to authenticate. API Error: 401' }])
})

it('reports that claude is missing on the server', async () => {
  const missing = (() => {
    const child = new FakeChild({ args: [], env: {}, mcp: null, stdin: '', killed: false })
    setTimeout(() => child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })), 5)
    return child
  }) as unknown as SpawnFn
  expect(await go({ spawnImpl: missing })).toEqual([{ type: 'error', code: 'CLAUDE_MISSING', message: 'claude not found on the server' }])
})

it('turns an interrupted output into an error, with the tail of stderr', async () => {
  script = (child) => { child.line(init()); child.stderr.write('boom'); child.exit(1) }
  expect(await go()).toEqual([{ type: 'error', code: 'CLAUDE_ERROR', message: 'boom' }])
})

it('when aborted, kills claude and stays silent: the core says why', async () => {
  script = (child) => { child.line(init()) }
  const abort = new AbortController()
  const done = go({}, abort.signal)
  await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
  abort.abort()
  expect(await done).toEqual([])
  expect(fake.calls[0]!.killed).toBe(true)
})

it('when aborted during preparation, kills claude as soon as it is spawned', async () => {
  script = (child) => { child.line(init()) }
  const abort = new AbortController()
  abort.abort()
  expect(await go({}, abort.signal)).toEqual([])
  expect(fake.calls[0]!.killed).toBe(true)
})
