import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Command, PluginHealth } from '@kasbah/shared'
import { PluginError, type DevicePlugin, type PluginContext } from '../../core/plugin'
import { stateFile } from '../../core/paths'
import { getPlaybackBridge } from '../../core/playbackBridge'
import { sendError } from '../../http/errors'
import { createRadioDirectory, stationSchema, type RadioDirectory, type Station } from './directory'
import { createFavoritesFile, type FavoritesStore } from './favorites'

// Plugin Radios : l'annuaire libre radio-browser.info (toutes les webradios, dont Radio France) et
// les favoris de la maison. Aucun appareil publié : comme YouTube Music, c'est une SOURCE, qui lance
// `media_player.play_url` sur un lecteur Cast / Sonos. Le flux va de la radio à l'enceinte, sans
// passer par le serveur — il n'y a rien à découper ni à mettre en file dans un direct.

export const radioConfigSchema = z.object({
  RADIO_BROWSER_URL: z.string().trim().url().default('https://de1.api.radio-browser.info'),
  RADIO_FAVORITES_FILE: z.string().trim().default(stateFile('radio-favorites.json')),
  /** Le pays des « plus écoutées » quand l'UI n'en demande pas. */
  RADIO_COUNTRY: z.string().trim().length(2).default('FR'),
})
export type RadioConfig = z.infer<typeof radioConfigSchema>

export interface RadioPluginDeps {
  directory?: RadioDirectory
  favorites?: FavoritesStore
  /** Commande à un lecteur d'un autre plugin (tests) ; sinon le pont `app.ts`. */
  execute?: (deviceId: string, command: Command) => Promise<void>
  getDevice?: (deviceId: string) => { descriptor: { kind: string; capabilities: string[] } } | undefined
}

export function createRadioPlugin(deps: RadioPluginDeps = {}): DevicePlugin {
  let ctx: PluginContext | null = null
  let config: RadioConfig | null = null
  let directory: RadioDirectory | null = null
  let store: FavoritesStore | null = null
  let favorites: Station[] = []
  let lastError: string | null = null
  /**
   * La station lancée sur chaque lecteur : le flux va de la radio à l'enceinte, qui ne dit ni codec
   * ni débit — l'UI tient la qualité de l'annuaire. Pas d'effacement : l'UI ne s'en sert que tant
   * que le lecteur publie un direct au nom de la station (il a pu passer à autre chose depuis).
   */
  const playing = new Map<string, Station>()

  const dir = () => {
    if (!directory) throw new PluginError('DEVICE_UNAVAILABLE', 'radio plugin is not started')
    return directory
  }
  /** Un appel à l'annuaire : l'échec est retenu pour la santé, puis relevé tel quel. */
  async function ask<T>(call: (d: RadioDirectory) => Promise<T>): Promise<T> {
    try {
      const out = await call(dir())
      lastError = null
      return out
    } catch (err) {
      lastError = (err as Error).message
      throw err
    }
  }
  async function saveFavorites(next: Station[]) {
    favorites = next
    await store?.save(next)
  }

  return {
    id: 'radio',
    configSchema: radioConfigSchema,

    async init(context) {
      ctx = context
      config = radioConfigSchema.parse(context.config)
      directory = deps.directory ?? createRadioDirectory(config.RADIO_BROWSER_URL, fetch, context.signal)
      store = deps.favorites ?? createFavoritesFile(config.RADIO_FAVORITES_FILE, context.logger)
      favorites = await store.load()
    },
    async discover() { return [] },
    async start() {},
    async execute(_externalId, command) {
      throw new PluginError('UNSUPPORTED_COMMAND', `radio publishes no device (${command.type})`)
    },
    async stop() { ctx = null },

    registerRoutes(app: FastifyInstance) {
      app.get('/status', async () => ({ favorites: favorites.length, country: config?.RADIO_COUNTRY ?? 'FR', lastError }))

      app.get<{ Querystring: { q?: string } }>('/search', async (req, reply) => {
        const q = (req.query.q ?? '').trim()
        if (q.length < 2) return sendError(reply, 400, 'INVALID_QUERY', 'q must be at least 2 characters')
        return { stations: await ask((d) => d.search(q)) }
      })

      app.get<{ Querystring: { country?: string } }>('/top', async (req, reply) => {
        const country = (req.query.country ?? config?.RADIO_COUNTRY ?? 'FR').trim()
        if (!/^[a-z]{2}$/i.test(country)) return sendError(reply, 400, 'INVALID_QUERY', 'country is a two-letter ISO code')
        return { stations: await ask((d) => d.top(country)) }
      })

      app.get('/favorites', async () => ({ stations: favorites }))

      app.get('/playing', async () => ({ playing: [...playing].map(([deviceId, station]) => ({ deviceId, station })) }))

      app.put<{ Params: { id: string }; Body: unknown }>('/favorites/:id', async (req, reply) => {
        const body = stationSchema.safeParse(req.body)
        if (!body.success || body.data.id !== req.params.id) return sendError(reply, 400, 'INVALID_BODY', 'a station whose id matches the path is required')
        if (!favorites.some((s) => s.id === body.data.id)) await saveFavorites([...favorites, body.data])
        return { stations: favorites }
      })

      // Une radio absente de l'annuaire, ou qu'il connaît sous une adresse morte : ajoutée à la main
      // par son flux. L'id vient de l'URL — l'ajouter deux fois ne fait pas de doublon.
      app.post<{ Body: unknown }>('/favorites/custom', async (req, reply) => {
        const body = z.object({
          name: z.string().trim().min(1).max(200),
          url: z.string().trim().url().max(2048).refine((u) => /^https?:\/\//i.test(u), 'http or https only'),
        }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'a name and an http(s) stream url are required')
        const id = `custom-${createHash('sha1').update(body.data.url).digest('hex').slice(0, 12)}`
        const station: Station = { id, name: body.data.name, url: body.data.url, tags: [] }
        await saveFavorites([...favorites.filter((s) => s.id !== id), station])
        return { stations: favorites }
      })

      app.delete<{ Params: { id: string } }>('/favorites/:id', async (req) => {
        await saveFavorites(favorites.filter((s) => s.id !== req.params.id))
        return { stations: favorites }
      })

      app.post<{ Body: unknown }>('/play', async (req, reply) => {
        const body = z.object({ deviceId: z.string().trim().min(1), stationId: z.string().trim().min(1) }).safeParse(req.body)
        if (!body.success) return sendError(reply, 400, 'INVALID_BODY', 'deviceId and stationId are required')
        const { deviceId, stationId } = body.data
        const get = deps.getDevice ?? ((id: string) => getPlaybackBridge()?.getDevice(id))
        const entry = get(deviceId)
        if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${deviceId}"`)
        if (entry.descriptor.kind !== 'media_player' || !entry.descriptor.capabilities.includes('play_url')) {
          return sendError(reply, 400, 'UNSUPPORTED_COMMAND', 'device does not support play_url')
        }
        // un favori se lance même si l'annuaire est tombé
        const station = favorites.find((s) => s.id === stationId) ?? await ask((d) => d.byId(stationId))
        if (!station) return sendError(reply, 404, 'NOT_FOUND', `unknown station "${stationId}"`)
        const execute = deps.execute ?? ((id: string, command: Command) => {
          const b = getPlaybackBridge()
          if (!b) return Promise.reject(new PluginError('DEVICE_UNAVAILABLE', 'playback bridge not ready'))
          return b.execute(id, command)
        })
        await execute(deviceId, {
          type: 'media_player.play_url',
          url: station.url,
          title: station.name,
          ...(station.country ? { artist: station.country } : {}),
          ...(station.favicon ? { artUrl: station.favicon } : {}),
          live: true,
        })
        playing.set(deviceId, station)
        // une station ajoutée à la main n'existe pas dans l'annuaire : rien à lui signaler
        if (!station.id.startsWith('custom-')) void directory?.click(station.id)
        ctx?.logger.info({ deviceId, station: station.name }, 'radio play')
        return { ok: true as const, station }
      })
    },

    health(): PluginHealth {
      const keys = Object.keys(radioConfigSchema.shape)
      const detail = `${favorites.length} favorite station${favorites.length === 1 ? '' : 's'}`
      return lastError ? { status: 'degraded', detail: `${detail} — directory: ${lastError}`, keys } : { status: 'ok', detail, keys }
    },
  }
}
