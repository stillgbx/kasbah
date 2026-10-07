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

// Plugin Claude : le moteur de l'assistant (« Demander à Kasbah ») par Claude Code en `claude -p`
// sur le serveur. Aucun appareil : comme une source musicale, il s'inscrit auprès d'un cœur commun
// (`assistant/engines.ts`) à son démarrage.
//
// Forfait Claude du compte qui demande, pas de clé d'API : chacun colle le jeton de
// `claude setup-token` (1 an) dans la carte du plugin ; sans lui, celui de la maison ; sans lui, la
// connexion `claude` de la machine serveur. Le jeton ne repart jamais vers le navigateur.

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

export const claudeConfigSchema = z.object({
  /** Le binaire `claude` (dans le PATH du serveur par défaut). */
  CLAUDE_BIN: z.string().trim().min(1).default('claude'),
  /**
   * Garder les sessions de `claude -p` (transcriptions JSONL, réflexion comprise), pour déboguer :
   * sous `.state/claude/config/projects/` avec un jeton, dans le `~/.claude` du serveur sinon.
   */
  CLAUDE_KEEP_SESSIONS: bool.default(false),
})
export type ClaudeConfig = z.infer<typeof claudeConfigSchema>

const tokenFileSchema = z.object({ token: z.string(), savedAt: z.number() })
/** `claude setup-token` rend `sk-ant-oat01-…` : on vérifie la forme, pas la version. */
const tokenSchema = z.string().trim().regex(/^sk-ant-[\w-]{20,500}$/, 'expected the token printed by `claude setup-token` (sk-ant-…)')

const tokenFile = (user: string | null) => (user === null ? stateFile('claude.json') : userStateFile(user, 'claude.json'))

async function readToken(user: string | null): Promise<z.infer<typeof tokenFileSchema> | null> {
  try { return tokenFileSchema.parse(JSON.parse(await readFile(tokenFile(user), 'utf8'))) } catch { return null }
}

export interface ClaudePluginDeps {
  spawnImpl?: SpawnFn
  /** Dossier de travail (défaut `.state/claude`). */
  workDir?: string
}

export function createClaudePlugin(deps: ClaudePluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: ClaudeConfig | null = null
  let unregister: (() => void) | null = null
  /** `claude --version` au démarrage : un binaire introuvable se voit dans Réglages, pas à la première instruction. */
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
      // déjà validée par l'hôte : la revalider refuserait `CLAUDE_KEEP_SESSIONS`, devenu un booléen
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
            bin: c.CLAUDE_BIN, dir: deps.workDir ?? stateFile('claude'), oauthToken: token?.token ?? null,
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
      // Le forfait Claude du compte courant : celui de la session (adresse publique), la maison sur le
      // réseau local. `house` : la maison a-t-elle un jeton, en repli.
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
      return { status: 'ok', detail: `claude ${version ?? '?'} — ${account}`, keys }
    },
  }
}
