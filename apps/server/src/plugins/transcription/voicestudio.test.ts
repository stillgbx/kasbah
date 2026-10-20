import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import pino from 'pino'
import { beforeEach, expect, it, vi } from 'vitest'
import { systemClock } from '../../core/clock'
import type { PluginContext } from '../../core/plugin'
import type { SpawnFn } from '../../music/proxy'
import { createTranscriptionPlugin, transcriptionConfigSchema } from '.'

// VoiceStudio without its interface: launched with the plugin when nothing answers at `STT_URL` (local),
// stopped with it; never launched or stopped when it's already running (the app open).

class FakeProc extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
  pid = 4242
  exitCode: number | null = null
  signalCode: string | null = null
  kill() { this.exit(null) }
  exit(code: number | null) { this.exitCode = code ?? 1; this.emit('exit', code) }
}

let spawned: { cmd: string; args: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv; proc: FakeProc }[]
/** What VoiceStudio's address answers: nothing, loading (503), ready. */
let studio: 'down' | 'loading' | 'up'
let appData: string

const spawnImpl = ((cmd: string, args: readonly string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
  const proc = new FakeProc()
  // `taskkill /T` stops the tree of the launched engine
  if (cmd === 'taskkill') setTimeout(() => spawned.find((s) => s.cmd !== 'taskkill')?.proc.exit(1), 1)
  spawned.push({ cmd, args, cwd: opts?.cwd, env: opts?.env, proc })
  return proc
}) as unknown as SpawnFn

const fetchImpl = (async () => {
  if (studio === 'down') throw new Error('ECONNREFUSED')
  return studio === 'loading' ? new Response('', { status: 503 }) : Response.json({ data: [] })
}) as unknown as typeof fetch

/** A runtime like the one the app sets up, and its record in `%APPDATA%\VoiceStudio`. */
function runtime(): string {
  const root = mkdtempSync(join(tmpdir(), 'kasbah-vs-'))
  const project = join(root, 'project')
  const python = process.platform === 'win32' ? join(project, '.venv', 'Scripts', 'python.exe') : join(project, '.venv', 'bin', 'python')
  mkdirSync(join(python, '..'), { recursive: true })
  writeFileSync(python, '')
  mkdirSync(join(project, 'backend'))
  writeFileSync(join(project, 'backend', 'main.py'), '')
  mkdirSync(join(appData, 'VoiceStudio'), { recursive: true })
  writeFileSync(join(appData, 'VoiceStudio', 'runtime-location.json'), JSON.stringify({ root, owned: true }))
  return project
}

async function started(env: Record<string, string> = {}, autostart = true) {
  const plugin = createTranscriptionPlugin({ fetch: fetchImpl, spawnImpl, appData, pollMs: 5 })
  const ctx: PluginContext = {
    pluginId: 'transcription', config: transcriptionConfigSchema.parse({ STT_URL: 'http://127.0.0.1:3900', ...env }), logger: pino({ level: 'silent' }),
    clock: systemClock, signal: new AbortController().signal, emitState() {}, setAvailable() {}, emitDevices() {}, emitScenes() {},
    emitSceneState() {}, emitEvent() {}, parts: { voicestudio: autostart }, site: { lat: 0, lon: 0, alt: 0 },
  }
  await plugin.init(ctx)
  await plugin.start()
  return plugin
}

beforeEach(() => {
  spawned = []
  studio = 'down'
  appData = mkdtempSync(join(tmpdir(), 'kasbah-vs-appdata-'))
})

it('launches VoiceStudio on the STT_URL port, waits until it is ready, stops it with the plugin', async () => {
  const project = runtime()
  const plugin = await started()
  expect(spawned).toHaveLength(1)
  expect(spawned[0]!.args).toEqual(['main.py'])
  expect(spawned[0]!.cwd).toBe(join(project, 'backend'))
  expect(spawned[0]!.env?.OMNIVOICE_PORT).toBe('3900')
  expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: expect.stringContaining('VoiceStudio starting (launched by Kasbah)') })

  studio = 'loading'
  await new Promise((r) => setTimeout(r, 30))
  expect(plugin.health!().status).toBe('degraded')
  studio = 'up'
  await vi.waitFor(() => expect(plugin.health!()).toMatchObject({ status: 'ok', detail: expect.stringContaining('VoiceStudio launched by Kasbah') }))

  await plugin.stop()
  expect(spawned[0]!.proc.exitCode).not.toBeNull()
  if (process.platform === 'win32') expect(spawned[1]).toMatchObject({ cmd: 'taskkill', args: ['/PID', '4242', '/T', '/F'] })
})

it('launches nothing and stops nothing when VoiceStudio already answers (the app open)', async () => {
  runtime()
  studio = 'up'
  const plugin = await started()
  expect(spawned).toHaveLength(0)
  expect(plugin.health!()).toMatchObject({ status: 'ok', detail: expect.stringContaining('already running, not launched by Kasbah') })
  await plugin.stop()
  expect(spawned).toHaveLength(0)
})

it('launches nothing when the switch is off', async () => {
  runtime()
  const plugin = await started({}, false)
  expect(spawned).toHaveLength(0)
  expect(plugin.health!()).toMatchObject({ status: 'degraded', detail: expect.stringContaining('unreachable') })
  await plugin.stop()
})

it('says why it does not launch: runtime not found, address on another machine', async () => {
  const missing = await started()
  expect(missing.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('VoiceStudio runtime not found') })
  await missing.stop()

  runtime()
  const remote = await started({ STT_URL: 'http://192.168.1.90:3900' })
  expect(remote.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('is not on this machine') })
  await remote.stop()
  expect(spawned).toHaveLength(0)
})

it('takes VOICESTUDIO_DIR before the app record', async () => {
  const project = runtime()
  writeFileSync(join(appData, 'VoiceStudio', 'runtime-location.json'), JSON.stringify({ root: join(appData, 'ailleurs') }))
  const plugin = await started({ VOICESTUDIO_DIR: project })
  expect(spawned[0]!.cwd).toBe(join(project, 'backend'))
  await plugin.stop()
})

it('reports the tail of its output when VoiceStudio stops on its own', async () => {
  runtime()
  const plugin = await started()
  spawned[0]!.proc.stderr.write('FATAL: port 3900 is already in use\n')
  await new Promise((r) => setTimeout(r, 5))
  spawned[0]!.proc.exit(3)
  expect(plugin.health!()).toMatchObject({ status: 'error', detail: expect.stringContaining('exited with code 3: FATAL: port 3900 is already in use') })
  await plugin.stop()
})
