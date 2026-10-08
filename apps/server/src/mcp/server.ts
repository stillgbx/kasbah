import { assertCommandAllowed, commandSchema, DEVICE_KINDS, indexHouse, sceneRecallSchema, type DeviceEntry } from '@kasbah/shared'
import { hostHeaderValidation, originValidation } from '@modelcontextprotocol/fastify'
import { createMcpHandler, McpServer, type McpRequestContext } from '@modelcontextprotocol/server'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { LoadedHouse } from '../config/house'
import type { PluginHost } from '../core/plugin-host'
import type { DeviceRegistry } from '../core/registry'
import type { SchoolFile, SchoolHomework, SchoolJournal, SchoolMessage, SchoolPost } from '../plugins/toutemonannee/mapping'
import type { SceneRegistry } from '../core/scene-registry'
import type { McpAuth } from './auth'
import { actAsHeaders } from '../http/session'

export interface McpDeps {
  registry: DeviceRegistry
  scenes: SceneRegistry
  host: PluginHost
  house: LoadedHouse
  auth: McpAuth
}

// Serveur MCP sur `/mcp` (Streamable HTTP, SDK v2) : les mêmes lectures et commandes que le REST,
// pour un agent. Jeton OAuth exigé partout (`auth.ts`). Le Host et l'Origin doivent en plus être
// localhost, le nom du poste sur le DNS local ou celui de `MCP_PUBLIC_URL` (protection contre le DNS
// rebinding). Sans état : une instance par requête, clients 2025 servis aussi.
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'kasbah', 'kasbah.home.internal']

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

// Pistes prêtes à jouer, dans la forme du lecteur commun (`/api/music`) — mêmes champs que l'app.
const playableTrackSchema = z.object({
  source: z.enum(['ytmusic', 'mixcloud']),
  id: z.string().min(1),
  title: z.string().optional(),
  artist: z.string().optional(),
  artUrl: z.string().optional(),
  durationS: z.number().positive().optional(),
  explicit: z.boolean().optional(),
})
type PlayableTrack = z.infer<typeof playableTrackSchema>

interface YtmTrack { videoId: string; title: string; artists: string[]; album?: string | null; artUrl: string | null; durationS: number | null; explicit?: boolean }
interface MixcloudMix { key: string; name: string; user: { name: string }; artUrl: string | null; durationS: number | null }
interface RadioStation { id: string; name: string; country?: string; tags: string[]; codec?: string; bitrateKbps?: number }

// L'école, telle que `GET /api/plugins/toutemonannee/school` la rend.
interface SchoolData {
  linked: boolean
  sessionLost: boolean
  fetchedAt: number | null
  error: string | null
  journals: SchoolJournal[]
  homework: SchoolHomework[]
  messages: SchoolMessage[]
  posts: SchoolPost[]
  filters: { hiddenJournals: string[]; hiddenLevels: string[] }
  postsSeen: number
}
export type SchoolSection = 'all' | 'homework' | 'messages' | 'posts'

/**
 * Devoirs, cahier de liaison et publications pour un agent : filtres de la vue École appliqués (même
 * règle que `isVisible` côté web), classe nommée plutôt que son uuid, pièces jointes réduites à nom + url.
 */
export function schoolDigest(data: SchoolData, opts: { today: string; section: SchoolSection; includePast: boolean; includeHidden: boolean }) {
  const f = data.filters
  const visible = (e: { journalId: string; levels: string[] }) => opts.includeHidden || (!f.hiddenJournals.includes(e.journalId)
    && (e.levels.length === 0 || e.levels.some((l) => !f.hiddenLevels.includes(l))))
  const className = new Map(data.journals.map((j) => [j.id, j.name]))
  type Common = { class?: string; title?: string; author?: string; text?: string; levels?: string[]; files?: { name: string; url: string }[] }
  const common = (e: { journalId: string; title: string | null; author: string | null; text: string; levels: string[]; files: SchoolFile[] }): Common => optional({
    class: className.get(e.journalId), title: e.title, author: e.author, text: e.text,
    levels: e.levels.length ? e.levels : null, files: e.files.length ? e.files.map((x) => ({ name: x.name, url: x.url })) : null,
  })
  const want = (s: SchoolSection) => opts.section === 'all' || opts.section === s
  const error = data.sessionLost ? 'session TouteMonAnnée perdue : dernière lecture gardée, relier le compte dans Kasbah' : data.error
  return {
    today: opts.today,
    fetchedAt: data.fetchedAt ? new Date(data.fetchedAt).toISOString() : null,
    ...(error ? { error } : {}),
    classes: data.journals.map((j) => optional({ name: j.name, years: j.years, students: j.students })),
    ...(want('homework') ? { homework: data.homework
      .filter((h) => visible(h) && (opts.includePast || h.date >= opts.today))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      .map((h) => ({ date: h.date, ...optional({ subject: h.subject }), ...common(h), done: h.done })) } : {}),
    ...(want('messages') ? { messages: data.messages.filter(visible).map((m) => ({ at: m.at, ...common(m), read: m.read })) } : {}),
    ...(want('posts') ? { posts: data.posts.filter(visible).map((p) => ({ at: p.at, ...common(p), new: p.id > data.postsSeen })) } : {}),
  }
}

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const optional = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''))

function buildServer(deps: McpDeps, app: FastifyInstance, user: string | null): McpServer {
  const server = new McpServer({ name: 'kasbah', version: '0.1.0' })

  // La musique passe par les routes de l'app (recherche des sources, lecteur commun) : mêmes
  // validations, mêmes erreurs lisibles (source coupée, cookie expiré), même adresse publiée aux
  // enceintes. Une réponse d'erreur devient une exception, que le SDK rend en `isError`. Au nom du
  // compte du jeton : ce sont ses comptes musicaux qui cherchent et qui jouent.
  const call = async <T>(method: 'GET' | 'POST', url: string, payload?: object): Promise<T> => {
    const res = await app.inject({ method, url, ...(user ? { headers: actAsHeaders(user) } : {}), ...(payload ? { payload } : {}) })
    const body = res.json() as T & { error?: { message?: string } }
    if (res.statusCode >= 400) throw new Error(body.error?.message ?? `HTTP ${res.statusCode}`)
    return body
  }

  // Nom et pièce tels que la maison les donne (renommage, placement), sinon ceux du fabricant.
  const describe = (e: DeviceEntry) => {
    const index = indexHouse(deps.house.house)
    const placed = index.devicesByBinding.get(e.descriptor.id)
    const room = placed?.roomId ? index.roomsById.get(placed.roomId)?.name : e.descriptor.meta.room
    return { id: e.descriptor.id, name: placed?.name ?? e.descriptor.name, kind: e.descriptor.kind, room, state: e.state }
  }

  server.registerTool('list_devices', {
    title: 'Lister les appareils',
    description: "Appareils de la maison avec leur état courant (instantané au moment de l'appel). Nom et pièce sont ceux de la maison (renommage, placement), sinon ceux du fabricant. Filtres facultatifs et cumulables. Point de départ pour trouver l'id à passer à get_device, send_command ou play_music.",
    inputSchema: z.object({
      kind: z.enum(DEVICE_KINDS).optional(),
      room: z.string().optional().describe('Nom de pièce, sous-chaîne sans casse'),
      query: z.string().optional().describe("Sous-chaîne sans casse du nom ou de l'id"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ kind, room, query }) => {
    const has = (s: string | undefined, part: string) => (s ?? '').toLowerCase().includes(part.toLowerCase())
    const devices = deps.registry.list().map(describe).filter((d) =>
      (!kind || d.kind === kind) && (!room || has(d.room, room)) && (!query || has(d.name, query) || has(d.id, query)))
    return json(devices)
  })

  server.registerTool('get_device', {
    title: 'Lire un appareil',
    description: "Descripteur complet d'un appareil (capacités, meta) et son état courant. À lire avant send_command pour savoir quelles commandes ses capacités permettent, et après pour relire l'état obtenu. Un id inconnu rend une erreur ; les ids viennent de list_devices.",
    inputSchema: z.object({ id: z.string() }),
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    const entry = deps.registry.get(id)
    return entry ? json(entry) : fail(`appareil inconnu "${id}"`)
  })

  server.registerTool('send_command', {
    title: 'Commander un appareil',
    description: "Envoie une commande à un vrai appareil. Réussit à l'accusé du fabricant ; le nouvel état se relit avec get_device. La commande doit être permise par les capacités de l'appareil.",
    inputSchema: z.object({ deviceId: z.string(), command: commandSchema }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ deviceId, command }) => {
    const entry = deps.registry.get(deviceId)
    if (!entry) return fail(`appareil inconnu "${deviceId}"`)
    assertCommandAllowed(entry.descriptor, command)
    await deps.host.execute(entry.descriptor.id, command)
    return json({ ok: true })
  })

  server.registerTool('list_scenes', {
    title: 'Lister les scènes',
    description: "Scènes enregistrées chez les fabricants (scènes Hue d'une pièce ou d'une zone) et leur état : active vaut inactive, static ou dynamic. dynamic: true signale une palette animée. Les scènes maison de house.json n'y figurent pas.",
    annotations: { readOnlyHint: true },
  }, async () => json(deps.scenes.list()))

  server.registerTool('recall_scene', {
    title: 'Rappeler une scène',
    description: "Rappelle une scène de fabricant (sceneId venu de list_scenes). recall.mode : static (défaut) applique les valeurs fixes, dynamic lance la palette animée (refusé si la scène n'en a pas), off éteint la pièce ou la zone de la scène — il n'existe pas de « désactiver une scène ». recall.brightness (0-100) rappelle la scène atténuée ; transitionMs règle le fondu. Réussit à l'accusé du fabricant.",
    inputSchema: z.object({ sceneId: z.string(), recall: sceneRecallSchema.optional() }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ sceneId, recall }) => {
    const entry = deps.scenes.get(sceneId)
    if (!entry) return fail(`scène inconnue "${sceneId}"`)
    const r = recall ?? sceneRecallSchema.parse({})
    if (r.mode === 'dynamic' && !entry.scene.dynamic) return fail(`la scène "${entry.scene.name}" n'a pas de palette animée`)
    await deps.host.recallScene(entry.scene.id, r)
    return json({ ok: true })
  })

  server.registerTool('get_health', {
    title: 'Santé des plugins',
    description: "État de chaque plugin, par id : statut, détail lisible, nombre d'appareils, quota consommé quand l'API du fabricant est bornée. keys liste les noms des variables d'environnement lues, jamais leurs valeurs. À consulter quand un appareil manque ou ne répond pas.",
    annotations: { readOnlyHint: true },
  }, async () => json(await deps.host.health(user)))

  server.registerTool('search_music', {
    title: 'Chercher de la musique',
    description: "Cherche dans une source musicale de Kasbah : YouTube Music (titres, par défaut), Mixcloud (mixes) ou Radios (stations). Il n'y a ni Spotify ni Apple Music. Les résultats ytmusic et mixcloud se passent TELS QUELS à play_music, ceux de radio (stationId) à play_radio.",
    inputSchema: z.object({
      query: z.string().trim().min(2),
      source: z.enum(['ytmusic', 'mixcloud', 'radio']).default('ytmusic'),
      limit: z.number().int().min(1).max(25).default(10),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query, source, limit }) => {
    const q = encodeURIComponent(query)
    if (source === 'ytmusic') {
      const r = await call<{ tracks: YtmTrack[] }>('GET', `/api/plugins/ytmusic/search?q=${q}`)
      return json(r.tracks.slice(0, limit).map((t) => optional({
        source: 'ytmusic', id: t.videoId, title: t.title, artist: t.artists.join(', '), album: t.album,
        artUrl: t.artUrl, durationS: t.durationS || null, explicit: t.explicit || null,
      })))
    }
    if (source === 'mixcloud') {
      const r = await call<{ items: MixcloudMix[] }>('GET', `/api/plugins/mixcloud/search?q=${q}`)
      return json(r.items.slice(0, limit).map((m) => optional({
        source: 'mixcloud', id: m.key, title: m.name, artist: m.user.name, artUrl: m.artUrl, durationS: m.durationS || null,
      })))
    }
    const r = await call<{ stations: RadioStation[] }>('GET', `/api/plugins/radio/search?q=${q}`)
    return json(r.stations.slice(0, limit).map((s) => optional({
      stationId: s.id, name: s.name, country: s.country, tags: s.tags.slice(0, 5), codec: s.codec, bitrateKbps: s.bitrateKbps,
    })))
  })

  server.registerTool('play_music', {
    title: 'Jouer de la musique',
    description: "Joue une piste, ou une file de pistes dans l'ordre, sur une enceinte ou un écran (appareil media_player qui a la capacité play_url, cf. list_devices). Les pistes viennent de search_music. Remplace ce que l'appareil jouait. Pause et volume : send_command.",
    inputSchema: z.object({ deviceId: z.string(), tracks: z.array(playableTrackSchema).min(1).max(100) }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ deviceId, tracks }) => {
    await call('POST', '/api/music/queue', { deviceId, tracks: tracks.map((t: PlayableTrack) => optional(t)) })
    return json({ ok: true, queued: tracks.length })
  })

  server.registerTool('play_radio', {
    title: 'Jouer une radio',
    description: 'Joue une station en direct (stationId venu de search_music avec source radio) sur un appareil media_player qui a la capacité play_url.',
    inputSchema: z.object({ deviceId: z.string(), stationId: z.string() }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ deviceId, stationId }) => {
    await call('POST', '/api/plugins/radio/play', { deviceId, stationId })
    return json({ ok: true })
  })

  server.registerTool('get_school', {
    title: "Lire l'école",
    description: "Cahier de texte (devoirs), cahier de liaison et publications de l'école (TouteMonAnnée), en lecture seule, tels que la vue École de Kasbah les montre : les classes et niveaux masqués dans ses filtres sont écartés sauf includeHidden. Devoirs triés par date à rendre (YYYY-MM-DD), à venir seulement sauf includePast (le site n'en garde que quelques jours) ; done = case « fait ». Messages de liaison avec read, publications avec new. La lecture date de fetchedAt (relue toutes les 30 min).",
    inputSchema: z.object({
      section: z.enum(['all', 'homework', 'messages', 'posts']).default('all'),
      includePast: z.boolean().default(false).describe('Inclure les devoirs dont la date est passée'),
      includeHidden: z.boolean().default(false).describe('Ignorer les filtres classes / niveaux de la vue École'),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ section, includePast, includeHidden }) => {
    const data = await call<SchoolData>('GET', '/api/plugins/toutemonannee/school')
    if (!data.linked) return fail("TouteMonAnnée n'est pas relié : le relier dans la vue École de Kasbah")
    return json(schoolDigest(data, { today: localDay(new Date()), section, includePast, includeHidden }))
  })

  server.registerResource('house', 'kasbah://house', {
    title: 'Maison',
    description: 'house.json validé : niveaux, pièces, ouvertures, placement des appareils.',
    mimeType: 'application/json',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(deps.house.house) }] }))

  return server
}

export async function registerMcp(app: FastifyInstance, deps: McpDeps): Promise<void> {
  const userOf = (ctx: McpRequestContext) => (typeof ctx.authInfo?.extra?.user === 'string' ? ctx.authInfo.extra.user : null)
  const handler = createMcpHandler((ctx) => buildServer(deps, app, userOf(ctx)))
  app.addHook('onClose', () => handler.close())
  await app.register(async (sub) => {
    const hosts = [...ALLOWED_HOSTS, ...deps.auth.publicHosts]
    sub.addHook('onRequest', hostHeaderValidation(hosts))
    deps.auth.routes(sub)
    // Fastify a déjà lu le corps JSON : on reconstruit la requête web que le SDK attend.
    // Pas de compression : la réponse peut être un flux SSE.
    sub.route({
      method: ['GET', 'POST', 'DELETE'], url: '/mcp', compress: false,
      onRequest: [originValidation(hosts), deps.auth.requireToken],
      handler: async (req, reply) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) {
          if (v !== undefined && k !== 'content-length') headers.set(k, Array.isArray(v) ? v.join(', ') : v)
        }
        const body = req.method === 'POST' ? JSON.stringify(req.body) : undefined
        // `requireToken` a posé le compte du jeton : le serveur de cette requête agit en son nom
        const authInfo = { token: '', clientId: '', scopes: [], extra: { user: req.sessionUser } }
        return reply.send(await handler.fetch(new Request(`http://${req.host}${req.url}`, { method: req.method, headers, body }), { authInfo }))
      },
    })
  })
}
