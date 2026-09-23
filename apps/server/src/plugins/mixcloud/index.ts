import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { sendError } from '../../http/errors'
import type { ResolvedStream, SpawnFn } from '../../music/proxy'
import { registerMusicSource, type MusicSource } from '../../music/sources'
import { createMixcloudApi, followingUploads, KEY_RE, USERNAME_RE, type MixcloudApi, type MixcloudMix } from './api'
import { resolveMixcloud } from './resolve'
import { createMixcloudFile, noteProgress, resumePoint, type MixcloudState, type MixcloudStore } from './store'

// Plugin Mixcloud (NON OFFICIEL pour la lecture) : catalogue par l'API publique (un nom d'utilisateur
// suffit, aucun mot de passe), flux par yt-dlp. Aucun appareil publié : c'est une SOURCE du lecteur
// commun (`music/player.ts`), qui sert le m4a aux enceintes, tient la file et le transfert. Ce que ce
// plugin ajoute : la REPRISE — la position atteinte dans chaque mix écouté d'ici est retenue.

export const mixcloudConfigSchema = z.object({
  MIXCLOUD_API_URL: z.string().trim().url().default('https://api.mixcloud.com'),
  MIXCLOUD_STATE_FILE: z.string().trim().default(stateFile('mixcloud.json')),
  /** yt-dlp : le même binaire que YouTube Music, sauf s'il est donné ici. */
  MIXCLOUD_YTDLP_PATH: z.string().trim().min(1).optional(),
  YTM_YTDLP_PATH: z.string().trim().min(1).optional(),
})
export type MixcloudConfig = z.infer<typeof mixcloudConfigSchema>

export interface MixcloudPluginDeps {
  api?: MixcloudApi
  store?: MixcloudStore
  spawnImpl?: SpawnFn
  fetchImpl?: typeof fetch
  /** Résolution du flux (tests) ; sinon yt-dlp. */
  resolve?: (key: string) => Promise<ResolvedStream>
}

/** Le fil « nouveautés des suivis » coûte une requête par compte suivi : gardé une demi-heure. */
const FEED_TTL_MS = 30 * 60_000
/** La position d'un mix n'est écrite sur disque qu'au plus toutes les 15 s. */
const SAVE_EVERY_MS = 15_000

export function createMixcloudPlugin(deps: MixcloudPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: MixcloudConfig | null = null
  let api: MixcloudApi | null = null
  let store: MixcloudStore | null = null
  let state: MixcloudState = { username: null, resume: {} }
  let lastError: string | null = null
  let feed: { username: string; at: number; items: MixcloudMix[] } | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let unregister: (() => void) | null = null

  const now = () => ctx?.clock.now() ?? Date.now()
  const needApi = () => {
    if (!api) throw new PluginError('DEVICE_UNAVAILABLE', 'Mixcloud plugin is not started')
    return api
  }
  const needUser = () => {
    if (!state.username) throw new PluginError('NEEDS_PAIRING', 'no Mixcloud username set')
    return state.username
  }
  /** Un appel à Mixcloud : l'échec est retenu pour la santé, puis relevé tel quel. */
  async function ask<T>(call: (a: MixcloudApi) => Promise<T>): Promise<T> {
    try {
      const out = await call(needApi())
      lastError = null
      return out
    } catch (err) {
      lastError = (err as Error).message
      throw err
    }
  }
  function persistSoon() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void store?.save(state).catch((err) => ctx?.logger.warn({ err }, 'could not write the Mixcloud state file'))
    }, SAVE_EVERY_MS)
  }
  async function persistNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    await store?.save(state)
  }
  /** Chaque mix rendu à l'UI porte sa position de reprise, s'il en a une. */
  const withResume = (items: MixcloudMix[]) => items.map((m) => {
    const r = resumePoint(state.resume[m.key])
    return r === null ? m : { ...m, resumeS: r }
  })

  const source: MusicSource = {
    id: 'mixcloud',
    label: 'Mixcloud',
    async resolve(key) {
      if (!KEY_RE.test(key)) throw new PluginError('UNSUPPORTED_COMMAND', 'invalid Mixcloud mix key')
      try {
        const cfg = config ?? mixcloudConfigSchema.parse({})
        const resolved = deps.resolve
          ? await deps.resolve(key)
          : await resolveMixcloud({
            key,
            ytdlpPath: cfg.MIXCLOUD_YTDLP_PATH ?? cfg.YTM_YTDLP_PATH ?? 'yt-dlp',
            ...(deps.spawnImpl ? { spawnImpl: deps.spawnImpl } : {}),
            ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
          })
        lastError = null
        return resolved
      } catch (err) {
        lastError = (err as Error).message
        if (err instanceof PluginError) throw err
        throw new PluginError('UPSTREAM_ERROR', lastError, { cause: err })
      }
    },
    onProgress(key, positionS, durationS, ended) {
      const before = resumePoint(state.resume[key])
      state = { ...state, resume: noteProgress(state.resume, key, positionS, durationS ?? null, ended, now()) }
      // fin ou oubli : tout de suite (l'UI relira) ; une progression : sans presse
      if (ended || (before !== null && resumePoint(state.resume[key]) === null)) void persistNow().catch(() => {})
      else persistSoon()
    },
  }

  return {
    id: 'mixcloud',
    configSchema: mixcloudConfigSchema,

    async init(context) {
      ctx = context
      config = mixcloudConfigSchema.parse(context.config)
      api = deps.api ?? createMixcloudApi(config.MIXCLOUD_API_URL, deps.fetchImpl ?? fetch, context.signal)
      store = deps.store ?? createMixcloudFile(config.MIXCLOUD_STATE_FILE, context.logger)
      state = await store.load()
      unregister?.()
      unregister = registerMusicSource(source)
    },
    async discover() { return [] },
    async start() {},
    async execute(_externalId, command: Command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `mixcloud publishes no device (${command.type})`)
    },
    async stop() {
      unregister?.()
      unregister = null
      if (saveTimer) await persistNow().catch(() => {})
      feed = null
      ctx = null
    },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => {
        const user = state.username ? await ask((a) => a.user(state.username!)).catch(() => null) : null
        return { username: state.username, user, lastError }
      })

      // Relier = donner son nom d'utilisateur (celui de l'URL du profil) ; il doit exister chez Mixcloud.
      app.put<{ Body: unknown }>('/account', async (req, reply) => {
        const body = z.object({ username: z.string().trim().regex(USERNAME_RE) }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'a Mixcloud username (letters, digits, - and _) is required')
        const user = await ask((a) => a.user(body.data.username))
        if (!user) return sendError(reply, 404, 'NOT_FOUND', `no Mixcloud account named "${body.data.username}"`)
        state = { ...state, username: user.username }
        feed = null
        await persistNow()
        ctx?.logger.info({ username: user.username }, 'Mixcloud account set')
        return { username: user.username, user, lastError }
      })

      app.delete('/account', async () => {
        state = { ...state, username: null }
        feed = null
        await persistNow()
        return { username: null, user: null, lastError }
      })

      // Les listes du compte. `feed` : les nouveautés des comptes suivis (recomposées, en cache) ;
      // les autres se lisent page par page (`next` = curseur rendu par la page précédente).
      app.get<{ Params: { list: string }; Querystring: { next?: string } }>('/library/:list', async (req, reply) => {
        const username = needUser()
        const { list } = req.params
        const next = req.query.next
        if (list === 'feed') {
          if (!feed || feed.username !== username || now() - feed.at > FEED_TTL_MS) {
            feed = { username, at: now(), items: await ask((a) => followingUploads(a, username)) }
          }
          return { items: withResume(feed.items), next: null }
        }
        const call = list === 'favorites' ? (a: MixcloudApi) => a.favorites(username, next)
          : list === 'listens' ? (a: MixcloudApi) => a.listens(username, next)
            : list === 'uploads' ? (a: MixcloudApi) => a.cloudcasts(username, next)
              : null
        if (!call) return sendError(reply, 404, 'NOT_FOUND', `unknown Mixcloud list "${list}"`)
        const page = await ask(call)
        return { items: withResume(page.items), next: page.next }
      })

      app.get('/playlists', async () => ({ playlists: await ask((a) => a.playlists(needUser())) }))

      app.get<{ Querystring: { key?: string; next?: string } }>('/playlist', async (req, reply) => {
        const key = req.query.key ?? ''
        if (!KEY_RE.test(key)) return sendError(reply, 400, 'INVALID_QUERY', 'a playlist key is required')
        const page = await ask((a) => a.playlist(key, req.query.next))
        return { items: withResume(page.items), next: page.next }
      })

      app.get('/following', async () => ({ users: await ask((a) => a.following(needUser())) }))

      app.get<{ Params: { username: string }; Querystring: { next?: string } }>('/users/:username/cloudcasts', async (req, reply) => {
        if (!USERNAME_RE.test(req.params.username)) return sendError(reply, 400, 'INVALID_QUERY', 'invalid Mixcloud username')
        const page = await ask((a) => a.cloudcasts(req.params.username, req.query.next))
        return { items: withResume(page.items), next: page.next }
      })

      app.get<{ Querystring: { q?: string; next?: string } }>('/search', async (req, reply) => {
        const q = (req.query.q ?? '').trim()
        if (q.length < 2) return sendError(reply, 400, 'INVALID_QUERY', 'q must be at least 2 characters')
        const page = await ask((a) => a.search(q, req.query.next))
        return { items: withResume(page.items), next: page.next }
      })

      /** Repartir du début : oublier la position retenue d'un mix. */
      app.delete<{ Querystring: { key?: string } }>('/resume', async (req, reply) => {
        const key = req.query.key ?? ''
        if (!KEY_RE.test(key)) return sendError(reply, 400, 'INVALID_QUERY', 'a mix key is required')
        const resume = { ...state.resume }
        delete resume[key]
        state = { ...state, resume }
        await persistNow()
        return { ok: true as const }
      })
    },

    health(): PluginHealth {
      const keys = Object.keys(mixcloudConfigSchema.shape)
      if (!state.username) return { status: 'needs_pairing', detail: 'Mixcloud: set your username on the Music page', keys }
      const detail = `Mixcloud: ${state.username}, ${Object.keys(state.resume).length} mix(es) to resume`
      return lastError ? { status: 'degraded', detail: `${detail} — ${lastError}`, keys } : { status: 'ok', detail, keys }
    },
  }
}
