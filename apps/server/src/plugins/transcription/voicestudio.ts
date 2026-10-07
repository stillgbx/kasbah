import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { SpawnFn } from '../../music/proxy'

// VoiceStudio sans son interface (sous-item `voicestudio`, décision de l'utilisateur 2026-10-07) : son
// moteur est un programme Python (`backend/main.py`) qui sert la même API sur le même port que l'app,
// avec les mêmes données (`%APPDATA%\OmniVoice` : voix, moteur choisi). Il vit avec Kasbah : lancé au
// démarrage du plugin, arrêté à son arrêt. Rien à installer : l'app apporte son propre Python
// (`<runtime>/.python`, relié par `<runtime>/project/.venv`), posé à son premier lancement.

export interface VoiceStudioRuntime {
  python: string
  /** `backend/` : `main.py` y lit ses modules. */
  backend: string
}

/**
 * Le runtime posé par l'app : `VOICESTUDIO_DIR` (le dossier `project`, celui qui porte `.venv` et
 * `backend`), sinon celui que l'app note dans `%APPDATA%\VoiceStudio\runtime-location.json`. Rend
 * la raison en clair quand il manque.
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

/** `python main.py` sur le port de `STT_URL`, sans fenêtre ; ses sorties sont lues (un tuyau plein le bloquerait), la fin gardée. */
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

/** Arrête le moteur et ce qu'il a lancé : sous Windows, `kill` ne touche que `python.exe`, ses moteurs resteraient. */
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
