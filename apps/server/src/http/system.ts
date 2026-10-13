import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { writeFileAtomic } from '../core/atomic-file'
import { REPO_ROOT } from '../core/paths'
import { sendError } from './errors'

// Version en service et mise à jour depuis Réglages. Le serveur ne se met pas à jour lui-même : il
// transmet la demande au superviseur qui l'a lancé (`scripts/supervisor.mjs`, canal IPC), qui fait
// pull, `npm ci`, build et redémarrage, et écrit l'avancement dans `statusFile`. Sans superviseur
// (`npm start`, `npm run dev`), la version se lit mais la mise à jour est refusée.
// Réservé au réseau local (`LAN_ONLY` de `session.ts`), comme la gestion des comptes.

export interface Commit { sha: string; subject: string; date: string }

export type UpdateStep = 'fetch' | 'deps' | 'build' | 'restart' | 'rollback'

/** Écrit par le superviseur, relu par Réglages pendant la mise à jour. */
export interface UpdateStatus {
  state: 'running' | 'done' | 'failed'
  step: UpdateStep | null
  /** Les étapes prévues, connues une fois les commits récupérés (`deps` seulement si le lock change). */
  steps: UpdateStep[]
  failedStep: UpdateStep | null
  from: string | null
  to: string | null
  startedAt: number
  finishedAt: number | null
  error: string | null
  rolledBack: boolean
  /** Le superviseur lui-même a changé : pris en compte à son prochain démarrage. */
  supervisorChanged: boolean
  log: string[]
}

export interface UpdateRequest { type: 'update'; statusFile: string; running: string | null }

export interface SystemRoutesDeps {
  /** Canal vers le superviseur ; absent quand le serveur a été lancé sans lui. */
  supervisor?: ((msg: UpdateRequest) => void) | undefined
  statusFile: string
  git?: (args: string[]) => Promise<string>
  now?: () => number
}

/** Une mise à jour « en cours » plus vieille que ça a été interrompue (superviseur arrêté en route). */
const STALE_MS = 30 * 60_000
/** `git fetch` au plus une fois par minute, sauf demande explicite. */
const FETCH_TTL_MS = 60_000
const MAX_COMMITS = 50
const FORMAT = '--format=%H%x1f%s%x1f%cI'

const runGit = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile('git', args, { cwd: REPO_ROOT, timeout: 60_000, windowsHide: true }, (err, stdout) => {
    if (err) reject(err)
    else resolve(stdout.trim())
  })
})

const parseCommits = (out: string): Commit[] => out.split('\n').filter(Boolean).map((line) => {
  const [sha = '', subject = '', date = ''] = line.split('\x1f')
  return { sha, subject, date }
})

export function registerSystemRoutes(app: FastifyInstance, deps: SystemRoutesDeps): void {
  const git = deps.git ?? runGit
  const now = deps.now ?? Date.now
  // le commit chargé : HEAD au démarrage, pas celui d'un `git pull` fait depuis
  const running = git(['log', '-1', FORMAT]).then((out) => parseCommits(out)[0] ?? null, () => null)
  let fetched: { at: number; available: Commit[] } | null = null
  let lastStatus: UpdateStatus | null = null

  async function readStatus(): Promise<UpdateStatus | null> {
    try {
      const s = JSON.parse(await readFile(deps.statusFile, 'utf8')) as UpdateStatus
      lastStatus = s.state === 'running' && now() - s.startedAt > STALE_MS
        ? { ...s, state: 'failed', failedStep: s.step, step: null, error: 'interrupted' }
        : s
    } catch (err) {
      // absent : jamais de mise à jour ; illisible (écrit à l'instant) : la dernière lecture tient
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') lastStatus = null
    }
    return lastStatus
  }

  app.get<{ Querystring: { refresh?: string } }>('/api/system/version', async (req) => {
    const current = await running
    let available: Commit[] | null = null
    let error: string | null = null
    if (current) {
      try {
        if (!fetched || req.query.refresh === '1' || now() - fetched.at > FETCH_TTL_MS) {
          await git(['fetch', '--quiet', 'origin', 'main'])
          fetched = { at: now(), available: parseCommits(await git(['log', FORMAT, '-n', String(MAX_COMMITS), `${current.sha}..origin/main`])) }
        }
        available = fetched.available
      } catch (err) { error = (err as Error).message.split('\n')[0] ?? 'git fetch failed' }
    } else error = 'not a git checkout'
    return { supervised: !!deps.supervisor, running: current, available, error }
  })

  app.get('/api/system/update', async () => ({ status: await readStatus() }))

  app.post('/api/system/update', async (_req, reply) => {
    if (!deps.supervisor) return sendError(reply, 409, 'NOT_SUPERVISED', 'the server was not started by scripts/supervisor.mjs')
    if ((await readStatus())?.state === 'running') return sendError(reply, 409, 'UPDATE_RUNNING', 'an update is already running')
    const current = await running
    // écrit tout de suite : Réglages relit l'état dès la réponse, avant que le superviseur l'ait repris
    const status: UpdateStatus = {
      state: 'running', step: 'fetch', steps: ['fetch'], failedStep: null,
      from: current?.sha ?? null, to: null, startedAt: now(), finishedAt: null,
      error: null, rolledBack: false, supervisorChanged: false, log: [],
    }
    await writeFileAtomic(deps.statusFile, JSON.stringify(status, null, 2))
    lastStatus = status
    fetched = null
    deps.supervisor({ type: 'update', statusFile: deps.statusFile, running: current?.sha ?? null })
    return reply.code(202).send({ status })
  })
}
