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

// Radio plugin: the free radio-browser.info directory (every web radio, Radio France included) and
// the house's favorites. No device published: like YouTube Music, it is a SOURCE, which starts
// `media_player.play_url` on a Cast / Sonos player. The stream goes from the radio to the speaker,
// without going through the server — there is nothing to cut or queue in a live stream.

export const radioConfigSchema = z.object({
  RADIO_BROWSER_URL: z.string().trim().url().default('https://de1.api.radio-browser.info'),
  RADIO_FAVORITES_FILE: z.string().trim().default(stateFile('radio-favorites.json')),
  /** The country of the "most listened" when the UI does not ask for one. */
  RADIO_COUNTRY: z.string().trim().length(2).default('FR'),
})
export type RadioConfig = z.infer<typeof radioConfigSchema>

export interface RadioPluginDeps {
  directory?: RadioDirectory
  favorites?: FavoritesStore
  /** Command to a player from another plugin (tests); otherwise the `app.ts` bridge. */
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
   * The station started on each player: the stream goes from the radio to the speaker, which reports
   * neither codec nor bitrate — the UI gets the quality from the directory. No clearing: the UI only
   * uses it while the player publishes a live stream named after the station (it may have moved on
   * to something else since).
   */
  const playing = new Map<string, Station>()

  const dir = () => {
    if (!directory) throw new PluginError('DEVICE_UNAVAILABLE', 'radio plugin is not started')
    return directory
  }
  /** A call to the directory: the failure is kept for the health, then rethrown as is. */
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

      // A radio missing from the directory, or that it knows under a dead address: added by hand
      // through its stream. The id comes from the URL — adding it twice makes no duplicate.
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
        // a favorite plays even if the directory is down
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
        // a station added by hand does not exist in the directory: nothing to report to it
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
