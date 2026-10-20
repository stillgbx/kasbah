import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { SpawnFn } from '../../music/proxy'

// VoiceStudio without its interface (`voicestudio` sub-item, the user's decision of 2026-10-07): its
// engine is a Python program (`backend/main.py`) that serves the same API on the same port as the
// app, with the same data (`%APPDATA%\OmniVoice`: voices, chosen engine). It lives with Kasbah:
// launched when the plugin starts, stopped when it stops. Nothing to install: the app brings its own
// Python (`<runtime>/.python`, linked through `<runtime>/project/.venv`), set up at its first launch.

export interface VoiceStudioRuntime {
  python: string
  /** `backend/`: `main.py` reads its modules there. */
  backend: string
}

/**
 * The runtime set up by the app: `VOICESTUDIO_DIR` (the `project` folder, the one holding `.venv` and
 * `backend`), otherwise the one the app records in `%APPDATA%\VoiceStudio\runtime-location.json`.
 * Returns the reason in plain text when it's missing.
 */
export async function findVoiceStudio(dir: string | undefined, appData = process.env.APPDATA): Promise<VoiceStudioRuntime | string> {
  let project = dir
  if (!project) {
    if (!appData) return 'VoiceStudio runtime not found: set VOICESTUDIO_DIR'
    try {
      const { root } = JSON.parse(await readFile(join(appData, 'VoiceStudio', 'runtime-location.json'), 'utf8')) as { root?: unknown }
      if (typeof root !== 'string') throw new Error('no root')
      project = join(root, 'project')
    } catch {
      return 'VoiceStudio runtime not found (install VoiceStudio and open it once, or set VOICESTUDIO_DIR)'
    }
  }
  const python = process.platform === 'win32' ? join(project, '.venv', 'Scripts', 'python.exe') : join(project, '.venv', 'bin', 'python')
  const backend = join(project, 'backend')
  if (!existsSync(python) || !existsSync(join(backend, 'main.py'))) return `VoiceStudio runtime incomplete at ${project} (open the app once to finish its setup)`
  return { python, backend }
}

/** `python main.py` on the port of `STT_URL`, without a window; its output is read (a full pipe would block it), the tail kept. */
export function spawnVoiceStudio(spawnImpl: SpawnFn, runtime: VoiceStudioRuntime, port: number): { child: ChildProcessWithoutNullStreams; tail: () => string } {
  const child = spawnImpl(runtime.python, ['main.py'], {
    cwd: runtime.backend, env: { ...process.env, OMNIVOICE_PORT: String(port) }, windowsHide: true,
  })
  let out = ''
  const keep = (d: Buffer) => { out = (out + d.toString()).slice(-2000) }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  return { child, tail: () => out.trim().split(/\r?\n/).slice(-3).join(' | ') }
}

/** Stops the engine and what it launched: on Windows, `kill` only reaches `python.exe`, its engines would remain. */
export function killVoiceStudio(spawnImpl: SpawnFn, child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
    if (process.platform === 'win32' && child.pid !== undefined) {
      spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill())
    } else child.kill()
  })
}
