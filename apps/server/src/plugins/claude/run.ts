import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { AssistantRun } from '../../assistant/engines'
import type { SpawnFn } from '../../music/proxy'

// `claude -p` pour une instruction de l'assistant, verrouillé :
// - aucun outil intégré (`--tools ""`), le seul MCP Kasbah (`--strict-mcp-config`), joint par le
//   jeton de course que le cœur a tiré au nom du compte ;
// - aucun réglage (`--setting-sources ""`), un dossier courant vide (pas de `CLAUDE.md`), et rien de
//   l'environnement du serveur qui commence par CLAUDE / ANTHROPIC (clé d'API, plugins, config) ;
// - pas de session gardée, sauf `CLAUDE_KEEP_SESSIONS` (pour déboguer).
// `--safe-mode` n'est PAS une option : il coupe aussi les serveurs MCP (`mcp_servers: []`, vu le 2026-10-07).

const TOOL_PREFIX = 'mcp__kasbah__'

export interface ClaudeRunOptions {
  bin: string
  /** `CLAUDE_MODEL` : Haiku par défaut, le plus rapide, et une commande de maison n'a pas besoin de plus (décision 2026-10-07). */
  model: string
  /** Dossier de travail : `cwd` vide, `config` isolée quand un jeton est employé, fichiers MCP. */
  dir: string
  /** Jeton de `claude setup-token` ; `null` = la connexion `claude` de la machine serveur. */
  oauthToken: string | null
  keepSessions: boolean
  spawnImpl?: SpawnFn
}

/** Lance `claude -p` et traduit sa sortie `stream-json` en événements de l'assistant. */
export async function runClaude(opts: ClaudeRunOptions, run: AssistantRun): Promise<void> {
  const cwd = join(opts.dir, 'cwd')
  const configDir = join(opts.dir, 'config')
  await mkdir(cwd, { recursive: true })
  await mkdir(configDir, { recursive: true })
  // Le jeton de course dans un fichier 0600, pas sur la ligne de commande (visible des autres processus).
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
      // annulé (client parti, délai passé) : on arrête sans dernier mot, le cœur dit pourquoi
      const onAbort = () => { finished = true; child.kill() }
      run.signal.addEventListener('abort', onAbort, { once: true })
      // parti pendant la préparation (fichiers) : l'événement est déjà passé
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
          // un message « synthétique » (échec d'authentification…) porte `error` : le `result` le dira
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
          const r = msg as { is_error?: boolean; result?: string; api_error_status?: number }
          if (!r.is_error) finish({ type: 'done', ms: Date.now() - started })
          else {
            const code = r.api_error_status === 401 ? 'CLAUDE_AUTH' : r.api_error_status === 429 ? 'CLAUDE_LIMIT' : 'CLAUDE_ERROR'
            finish({ type: 'error', code, message: r.result ?? 'claude failed' })
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
