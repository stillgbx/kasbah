import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// `import.meta.url` is `apps/server/src/…` in development but `apps/server/dist/main.js` once
// bundled by esbuild: a hard-coded depth is right in one case and wrong in the other (it pointed
// to a folder OUTSIDE the repo in production). So we climb up to `apps/server` depending on the
// shape, and everything else derives from there — a single place to re-read if the tree moves.
const here = dirname(fileURLToPath(import.meta.url))
export const SERVER_ROOT = here.endsWith(`${sep}dist`) ? resolve(here, '..') : resolve(here, '../..')
export const REPO_ROOT = resolve(SERVER_ROOT, '../..')

/**
 * Path of a persistent state file (tokens, histories, known devices). The folder moves with
 * `KASBAH_STATE_DIR`: that is what the tests do (`test/state-isolation.ts`), which would otherwise
 * load and rewrite the REAL state — a plugin built with its default configuration points at those
 * very files, including under vitest.
 */
export const stateFile = (name: string): string =>
  resolve(process.env.KASBAH_STATE_DIR ?? resolve(SERVER_ROOT, '.state'), name)

/**
 * State folder of an account (`mcp-users.json`): its music accounts, its alone. An allowed name can
 * be `.` or `..` (`userNameSchema`): encoded, and never a leading dot. Capitals are marked with a
 * `+` (which the encoding never lets through): a Windows disk does not tell `Alice` from `alice`,
 * which are two accounts.
 */
export const userStateDir = (user: string): string =>
  stateFile(`users/${encodeURIComponent(user).replace(/^\./, '%2E').replace(/[A-Z]/g, (c) => `+${c.toLowerCase()}`)}`)

export const userStateFile = (user: string, name: string): string => resolve(userStateDir(user), name)
