import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { AssistantRun, AssistantUsage } from '../../assistant/engines'
import type { SpawnFn } from '../../music/proxy'

// `claude -p` for one assistant instruction, locked down:
// - no built-in tool (`--tools ""`), the Kasbah MCP only (`--strict-mcp-config`), reached with the
//   run token the core drew on behalf of the account;
// - no settings (`--setting-sources ""`), an empty working directory (no `CLAUDE.md`), and nothing
//   from the server environment starting with CLAUDE / ANTHROPIC (API key, plugins, config);
// - no kept session, except with `CLAUDE_KEEP_SESSIONS` (for debugging).
// `--safe-mode` is NOT an option: it also cuts the MCP servers (`mcp_servers: []`, seen 2026-10-07).

const TOOL_PREFIX = 'mcp__kasbah__'

/** claude's `result` carries the cost (list price, `costBasis: "list"`, even with a subscription) and the tokens. */
interface ClaudeResult {
  is_error?: boolean
  result?: string
  api_error_status?: number
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
}

function usageOf(r: ClaudeResult): AssistantUsage | null {
  if (typeof r.total_cost_usd !== 'number') return null
  return {
    costUsd: r.total_cost_usd,
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    cacheReadTokens: r.usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: r.usage?.cache_creation_input_tokens ?? 0,
  }
}

export interface ClaudeRunOptions {
  bin: string
  /** `CLAUDE_MODEL`: Haiku by default, the fastest, and a house command needs no more (decision 2026-10-07). */
  model: string
  /** Working directory: empty `cwd`, `config` isolated when a token is used, MCP files. */
  dir: string
  /** Token from `claude setup-token`; `null` = the server machine's `claude` sign-in. */
  oauthToken: string | null
  keepSessions: boolean
  spawnImpl?: SpawnFn
}

/** Runs `claude -p` and turns its `stream-json` output into assistant events. */
export async function runClaude(opts: ClaudeRunOptions, run: AssistantRun): Promise<void> {
  const cwd = join(opts.dir, 'cwd')
  const configDir = join(opts.dir, 'config')
  await mkdir(cwd, { recursive: true })
  await mkdir(configDir, { recursive: true })
  // The run token in a 0600 file, not on the command line (visible to other processes).
  const mcpFile = join(opts.dir, `mcp-${randomUUID()}.json`)
  await writeFile(mcpFile, JSON.stringify({
    mcpServers: { kasbah: { type: 'http', url: run.mcp.url, headers: { Authorization: `Bearer ${run.mcp.token}` } } },
  }), { mode: 0o600 })

  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ANTHROPIC)/i.test(k)))
  if (opts.oauthToken) {
    env.CLAUDE_CODE_OAUTH_TOKEN = opts.oauthToken
    env.CLAUDE_CONFIG_DIR = configDir
  }
  const args = [
    '-p', '--model', opts.model,
    '--tools', '', '--strict-mcp-config', '--mcp-config', mcpFile, '--allowedTools', 'mcp__kasbah',
    '--setting-sources', '', ...(opts.keepSessions ? [] : ['--no-session-persistence']),
    '--system-prompt', run.systemPrompt,
    '--output-format', 'stream-json', '--verbose',
  ]
  const started = Date.now()
  let finished = false
  const finish = (e: Parameters<AssistantRun['emit']>[0]) => { if (!finished) { finished = true; run.emit(e) } }

  try {
    await new Promise<void>((resolve) => {
      const child = (opts.spawnImpl ?? (spawn as unknown as SpawnFn))(opts.bin, args, { cwd, env, windowsHide: true })
      // aborted (client gone, timeout passed): we stop without a last word, the core says why
      const onAbort = () => { finished = true; child.kill() }
      run.signal.addEventListener('abort', onAbort, { once: true })
      // gone during preparation (files): the event has already fired
      if (run.signal.aborted) onAbort()
      const fail = (code: string, message: string) => { finish({ type: 'error', code, message }); child.kill() }
      let stderr = ''
      child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000) })

      createInterface({ input: child.stdout }).on('line', (line) => {
        if (finished) return
        let msg: Record<string, unknown>
        try { msg = JSON.parse(line) as Record<string, unknown> } catch { return }
        if (msg.type === 'system' && msg.subtype === 'init') {
          const kasbah = (msg.mcp_servers as { name: string; status: string }[] | undefined)?.find((s) => s.name === 'kasbah')
          if (kasbah?.status !== 'connected') fail('MCP_UNAVAILABLE', `Kasbah MCP ${kasbah?.status ?? 'missing'}`)
        } else if (msg.type === 'assistant') {
          // a "synthetic" message (authentication failure…) carries `error`: the `result` will say it
          const m = msg as { error?: unknown; message?: { content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[] } }
          if (m.error) return
          for (const block of m.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) run.emit({ type: 'text', text: block.text })
            else if (block.type === 'tool_use' && block.id && block.name) {
              run.emit({ type: 'tool', id: block.id, name: block.name.replace(TOOL_PREFIX, ''), input: block.input })
            }
          }
        } else if (msg.type === 'user') {
          const content = (msg as { message?: { content?: unknown } }).message?.content
          for (const block of Array.isArray(content) ? content as { type: string; tool_use_id?: string; is_error?: boolean }[] : []) {
            if (block.type === 'tool_result' && block.tool_use_id) run.emit({ type: 'tool_result', id: block.tool_use_id, ok: !block.is_error })
          }
        } else if (msg.type === 'result') {
          const r = msg as ClaudeResult
          const usage = usageOf(r)
          if (!r.is_error) finish({ type: 'done', ms: Date.now() - started, ...(usage ? { usage } : {}) })
          else {
            const code = r.api_error_status === 401 ? 'CLAUDE_AUTH' : r.api_error_status === 429 ? 'CLAUDE_LIMIT' : 'CLAUDE_ERROR'
            finish({ type: 'error', code, message: r.result ?? 'claude failed', ...(usage ? { usage } : {}) })
          }
        }
      })

      const end = () => { run.signal.removeEventListener('abort', onAbort); resolve() }
      child.on('error', (err: NodeJS.ErrnoException) => {
        finish(err.code === 'ENOENT'
          ? { type: 'error', code: 'CLAUDE_MISSING', message: `${opts.bin} not found on the server` }
          : { type: 'error', code: 'CLAUDE_ERROR', message: err.message })
        end()
      })
      child.on('close', (code) => {
        finish({ type: 'error', code: 'CLAUDE_ERROR', message: stderr.trim() || `claude exited with code ${code}` })
        end()
      })
      child.stdin.end(run.text)
    })
  } finally {
    await unlink(mcpFile).catch(() => undefined)
  }
}
