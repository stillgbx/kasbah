import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { PluginHealth } from '@kasbah/shared'
import { registerAssistantEngine } from '../../assistant/engines'
import { writeFileAtomic } from '../../core/atomic-file'
import { stateFile, userStateFile } from '../../core/paths'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import type { SpawnFn } from '../../music/proxy'
import { runClaude } from './run'

// Claude plugin: the assistant's engine ("Ask Kasbah") through Claude Code as `claude -p` on the
// server. No device: like a music source, it registers with a shared core (`assistant/engines.ts`)
// when it starts.
//
// The Claude subscription of the asking account, no API key: everyone pastes the token from
// `claude setup-token` (1 year) into the plugin's card; without it, the house's one; without that,
// the server machine's `claude` sign-in. The token never travels back to the browser.

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

export const claudeConfigSchema = z.object({
  /** The `claude` binary (in the server's PATH by default). */
  CLAUDE_BIN: z.string().trim().min(1).default('claude'),
  /**
   * The model passed to `--model`: a full ID (pinned version) or a CLI alias (`haiku`, `sonnet`),
   * which follows CLI updates but with a lag: in CLI 2.1.288, `haiku` still gave Haiku 4.5 while
   * Haiku 5.5 was out (observed 2026-10-07).
   */
  CLAUDE_MODEL: z.string().trim().min(1).default('claude-haiku-5-5'),
  /**
   * Keep the `claude -p` sessions (JSONL transcripts, thinking included), for debugging: under
   * `.state/claude/config/projects/` with a token, in the server's `~/.claude` otherwise.
   */
  CLAUDE_KEEP_SESSIONS: bool.default(false),
})
export type ClaudeConfig = z.infer<typeof claudeConfigSchema>

const tokenFileSchema = z.object({ token: z.string(), savedAt: z.number() })
/** `claude setup-token` returns `sk-ant-oat01-…`: we check the shape, not the version. */
const tokenSchema = z.string().trim().regex(/^sk-ant-[\w-]{20,500}$/, 'expected the token printed by `claude setup-token` (sk-ant-…)')

const tokenFile = (user: string | null) => (user === null ? stateFile('claude.json') : userStateFile(user, 'claude.json'))

async function readToken(user: string | null): Promise<z.infer<typeof tokenFileSchema> | null> {
  try { return tokenFileSchema.parse(JSON.parse(await readFile(tokenFile(user), 'utf8'))) } catch { return null }
}

export interface ClaudePluginDeps {
  spawnImpl?: SpawnFn
  /** Working directory (default `.state/claude`). */
  workDir?: string
}

export function createClaudePlugin(deps: ClaudePluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: ClaudeConfig | null = null
  let unregister: (() => void) | null = null
  /** `claude --version` at startup: a missing binary shows in Settings, not at the first instruction. */
  let version: string | null = null
  let versionError: string | null = null
  let houseToken = false

  const spawnImpl = deps.spawnImpl ?? (spawn as unknown as SpawnFn)
  const cfg = () => {
    if (!config) throw new PluginError('DEVICE_UNAVAILABLE', 'claude plugin is not started')
    return config
  }

  function probeVersion(bin: string): Promise<void> {
    return new Promise((resolve) => {
      let out = ''
      const child = spawnImpl(bin, ['--version'], { windowsHide: true })
      const timer = setTimeout(() => { child.kill(); versionError = 'claude --version did not answer'; resolve() }, 15_000)
      child.stdout.on('data', (d: Buffer) => { out += d.toString() })
      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer)
        versionError = err.code === 'ENOENT' ? `${bin} not found (CLAUDE_BIN, or the server PATH)` : err.message
        resolve()
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) { version = out.trim().split(/\s/)[0] ?? null; versionError = null }
        else versionError ??= `claude --version exited with code ${code}`
        resolve()
      })
      child.stdin.end()
    })
  }

  return {
    id: 'claude',
    configSchema: claudeConfigSchema,

    async init(context) {
      ctx = context
      // already validated by the host: validating it again would reject `CLAUDE_KEEP_SESSIONS`, now a boolean
      config = context.config as ClaudeConfig
      houseToken = (await readToken(null)) !== null
    },
    async discover() { return [] },
    async start() {
      const c = cfg()
      await probeVersion(c.CLAUDE_BIN)
      unregister = registerAssistantEngine({
        id: 'claude',
        label: 'Claude',
        run: async (run) => {
          const token = (run.user !== null ? await readToken(run.user) : null) ?? await readToken(null)
          await runClaude({
            bin: c.CLAUDE_BIN, model: c.CLAUDE_MODEL, dir: deps.workDir ?? stateFile('claude'), oauthToken: token?.token ?? null,
            keepSessions: c.CLAUDE_KEEP_SESSIONS, spawnImpl,
          }, run)
        },
      })
    },
    async execute(_externalId, command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `claude publishes no device (${command.type})`)
    },
    async stop() {
      unregister?.()
      unregister = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      // The current account's Claude subscription: the session's one (public address), the house's on
      // the local network. `house`: whether the house has a token, as a fallback.
      app.get('/account', async (req) => {
        const own = await readToken(req.sessionUser)
        const house = req.sessionUser === null ? own : await readToken(null)
        return { user: req.sessionUser, savedAt: own?.savedAt ?? null, house: house !== null }
      })

      app.put('/account', async (req) => {
        const { token } = z.object({ token: tokenSchema }).parse(req.body)
        const file = tokenFile(req.sessionUser)
        await mkdir(dirname(file), { recursive: true })
        await writeFileAtomic(file, `${JSON.stringify({ token, savedAt: Date.now() })}\n`, { mode: 0o600 })
        if (req.sessionUser === null) houseToken = true
        ctx?.logger.info({ user: req.sessionUser }, 'Claude token saved')
        return { user: req.sessionUser, savedAt: (await readToken(req.sessionUser))?.savedAt ?? null, house: (await readToken(null)) !== null }
      })

      app.delete('/account', async (req) => {
        await unlink(tokenFile(req.sessionUser)).catch(() => undefined)
        if (req.sessionUser === null) houseToken = false
        ctx?.logger.info({ user: req.sessionUser }, 'Claude token removed')
        return { user: req.sessionUser, savedAt: null, house: (await readToken(null)) !== null }
      })
    },

    health(): PluginHealth {
      const keys = Object.keys(claudeConfigSchema.shape)
      if (versionError) return { status: 'error', detail: versionError, keys }
      const account = houseToken ? 'house token set' : "no house token: the server's claude sign-in is used"
      return { status: 'ok', detail: `claude ${version ?? '?'} — ${config?.CLAUDE_MODEL ?? '?'} — ${account}`, keys }
    },
  }
}
