import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import type { FastifyInstance } from 'fastify'
import { writeFileAtomic } from '../core/atomic-file'
import { REPO_ROOT } from '../core/paths'
import { sendError } from './errors'

// Running version and update from Settings. The server does not update itself: it forwards the
// request to the supervisor that started it (`scripts/supervisor.mjs`, IPC channel), which does the
// pull, `npm ci`, build and restart, and writes the progress into `statusFile`. Without a supervisor
// (`npm start`, `npm run dev`), the version can be read but the update is refused.
// Restricted to the local network (`LAN_ONLY` in `session.ts`), like account management.

export interface Commit { sha: string; subject: string; date: string }

export type UpdateStep = 'fetch' | 'deps' | 'build' | 'restart' | 'rollback'

/** Written by the supervisor, re-read by Settings during the update. */
export interface UpdateStatus {
  state: 'running' | 'done' | 'failed'
  step: UpdateStep | null
  /** The planned steps, known once the commits are fetched (`deps` only if the lock changes). */
  steps: UpdateStep[]
  failedStep: UpdateStep | null
  from: string | null
  to: string | null
  startedAt: number
  finishedAt: number | null
  error: string | null
  rolledBack: boolean
  /** The supervisor itself changed: taken into account at its next start. */
  supervisorChanged: boolean
  log: string[]
}

export interface UpdateRequest { type: 'update'; statusFile: string; running: string | null }

export interface SystemRoutesDeps {
  /** Channel to the supervisor; absent when the server was started without it. */
  supervisor?: ((msg: UpdateRequest) => void) | undefined
  statusFile: string
  git?: (args: string[]) => Promise<string>
  now?: () => number
}

/** A "running" update older than this was interrupted (supervisor stopped midway). */
const STALE_MS = 30 * 60_000
/** `git fetch` at most once a minute, unless explicitly requested. */
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
  // the loaded commit: HEAD at startup, not that of a `git pull` done since
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
      // absent: never any update; unreadable (being written right now): the last reading holds
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
    // written right away: Settings re-reads the status upon the response, before the supervisor has taken it over
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
