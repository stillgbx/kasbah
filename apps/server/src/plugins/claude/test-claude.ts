import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import type { SpawnFn } from '../../music/proxy'

// Un faux `claude` pour les tests : on relève ce qu'il reçoit (arguments, environnement, fichier MCP,
// instruction) et on rejoue des lignes `stream-json` relevées sur le vrai (2026-10-07).

export interface ClaudeCall {
  args: string[]
  env: NodeJS.ProcessEnv
  mcp: { mcpServers: { kasbah: { url: string; headers: { Authorization: string } } } } | null
  stdin: string
  killed: boolean
}

export class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  constructor(readonly call: ClaudeCall) { super() }
  line(o: unknown) { this.stdout.write(`${JSON.stringify(o)}\n`) }
  exit(code = 0) { setTimeout(() => { this.stdout.end(); this.emit('close', code) }, 5) }
  kill() { this.call.killed = true; this.exit(143); return true }
}

export const init = (status = 'connected') => ({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'kasbah', status, source: 'dynamic' }] })

/** Une instruction qui allume le salon : un outil, son résultat, la réponse. */
export const happy = (child: FakeChild) => {
  child.line(init())
  child.line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } })
  child.line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__kasbah__send_command', input: { deviceId: 'mock:light-living' } }] } })
  child.line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } })
  child.line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Le plafonnier du salon est allumé.' }] } })
  child.line({
    type: 'result', subtype: 'success', is_error: false, result: 'Le plafonnier du salon est allumé.', total_cost_usd: 0.0031,
    usage: { input_tokens: 12, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 1500 },
  })
  child.exit()
}

/** `claude --version` répond, une instruction suit `script` (une fois l'entrée fermée). */
export function fakeClaude(script: () => (child: FakeChild) => void) {
  const calls: ClaudeCall[] = []
  const spawnImpl = ((_cmd: string, args: readonly string[], opts?: { env?: NodeJS.ProcessEnv }) => {
    const i = args.indexOf('--mcp-config')
    const call: ClaudeCall = {
      args: [...args], env: opts?.env ?? {}, stdin: '', killed: false,
      mcp: i >= 0 ? JSON.parse(readFileSync(args[i + 1]!, 'utf8')) as ClaudeCall['mcp'] : null,
    }
    const child = new FakeChild(call)
    if (args[0] === '--version') {
      setTimeout(() => { child.stdout.write('2.1.288 (Claude Code)\n'); child.exit(0) }, 1)
      return child
    }
    calls.push(call)
    child.stdin.on('data', (d: Buffer) => { call.stdin += d.toString() })
    child.stdin.on('finish', () => script()(child))
    return child
  }) as unknown as SpawnFn
  return { calls, spawnImpl }
}
