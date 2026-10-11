import { assertCommandAllowed, commandSchema, DEVICE_KINDS, findShoppingItem, pluginSettingsOf, indexHouse, sceneRecallSchema, SHOPPING_ADD_MAX, shoppingNameSchema, shoppingQuantitySchema, type ShoppingList, type AutomationEntry, type AutomationRun, type DeviceConsumption, type DeviceEntry, type DeviceJournal, type EnergyHistory, type StateFor, type WeatherForecast } from '@kasbah/shared'
import { hostHeaderValidation, originValidation } from '@modelcontextprotocol/fastify'
import { createMcpHandler, McpServer, type McpRequestContext } from '@modelcontextprotocol/server'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { LoadedHouse } from '../config/house'
import type { PluginHost } from '../core/plugin-host'
import type { DeviceRegistry } from '../core/registry'
import type { SchoolFile, SchoolHomework, SchoolJournal, SchoolMessage, SchoolPost } from '../plugins/toutemonannee/mapping'
import type { SceneRegistry } from '../core/scene-registry'
import type { AgendaEvent } from '../plugins/agenda/ics'
import { REPEAT_MODES, type RepeatMode } from '../music/queue'
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
// Le lecteur commun, tel que `/api/music/{queue,sessions,last}` le rend.
interface QueueTrack { source: string; id: string; title?: string; artist?: string; durationS?: number }
interface QueueView { items: QueueTrack[]; index: number; repeat: RepeatMode }
type QueueBrief = { length: number; index: number; repeat: RepeatMode } | null
interface MusicSession { deviceId: string; source: string; id: string; title: string | null; artist: string | null; durationS: number | null; queue: QueueBrief }
interface LastPlayed { deviceId: string; track: QueueTrack; positionS: number; durationS: number | null; queue: QueueBrief; at: number }
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

/**
 * Heures en clair (`2026-10-09 14:00`) : un agent convertit mal un epoch. `tz` absent = fuseau du
 * serveur, celui de la maison.
 */
function clockOf(tz?: string) {
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz, ...o })
  const day = part({ year: 'numeric', month: '2-digit', day: '2-digit' })
  const hour = part({ hour: '2-digit', minute: '2-digit' })
  return { day, hour, at: (ms: number) => `${day.format(ms)} ${hour.format(ms)}` }
}

/**
 * L'agenda pour un agent : agenda nommé, heures en clair, triés par début. Une journée entière garde
 * ses dates `YYYY-MM-DD` mais avec une fin INCLUSE (le flux iCal l'exclut, un agent la lirait mal).
 */
export function agendaDigest(events: AgendaEvent[], calendars: { id: string; name: string }[], tz?: string) {
  const { at } = clockOf(tz)
  const name = new Map(calendars.map((c) => [c.id, c.name]))
  const startOf = (e: AgendaEvent) => (e.allDay ? Date.parse(`${e.start}T00:00`) : e.start)
  const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00Z`) - 86_400_000).toISOString().slice(0, 10)
  return [...events].sort((a, b) => startOf(a) - startOf(b)).map((e) => ({
    calendar: name.get(e.calendarId), title: e.title,
    ...(e.allDay
      ? { allDay: true, date: e.start, ...(dayBefore(e.end) > e.start ? { until: dayBefore(e.end) } : {}) }
      : { start: at(e.start), end: at(e.end) }),
    ...optional({ location: e.location, description: e.description }),
  }))
}

interface Vigilance { area: string | null; warnings: NonNullable<StateFor<'weather'>['vigilance']> }

/**
 * La météo pour un agent : heures en clair dans le fuseau du lieu (un agent convertit mal un epoch),
 * champs absents omis. `tz` absent = fuseau du serveur, celui de la maison. `vigilance` : celle du
 * département, à venir comprise ; absente = inconnue.
 */
export function weatherDigest(state: StateFor<'weather'>, forecast: Pick<WeatherForecast, 'hourly' | 'daily'>, opts: { tz?: string; vigilance?: Vigilance | null | undefined }) {
  const { day, hour, at } = clockOf(opts.tz)
  const { kind: _k, available: _a, updatedAt: _u, observedAt, sunrise, sunset, vigilance: current, ...now } = state
  const vigilance = opts.vigilance === undefined
    ? (current ? { area: null, warnings: current } : undefined)
    : opts.vigilance
  return {
    now: { observedAt: at(observedAt), ...now, sunrise: hour.format(sunrise), sunset: hour.format(sunset) },
    hourly: forecast.hourly.map(({ t, isDay: _d, ...h }) => ({ at: at(t), ...h })),
    daily: forecast.daily.map(({ t, sunrise: up, sunset: down, ...d }) => ({ date: day.format(t), ...d, sunrise: hour.format(up), sunset: hour.format(down) })),
    ...(vigilance === undefined ? {} : {
      vigilance: vigilance && {
        ...(vigilance.area ? { area: vigilance.area } : {}),
        warnings: vigilance.warnings.map((w) => ({ type: w.type, level: w.level, from: at(w.onset), to: at(w.expires) })),
      },
    }),
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
  const call = async <T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object): Promise<T> => {
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

  server.registerTool('get_weather', {
    title: 'Lire la météo',
    description: "Météo actuelle, prévisions heure par heure (24 h) et jour par jour (7 jours), qualité de l'air, pollens (0 nul à 4 très élevé) et vigilance Météo-France (métropole seulement, à venir comprise ; vigilance null = hors métropole, warnings vide = vert). Sans place : la maison. place : un nom de lieu, le premier résultat du géocodage est retenu et rendu dans place pour vérification. Heures locales du lieu (timezone). Pourcentages sur 100, vent en km/h.",
    inputSchema: z.object({
      place: z.string().trim().min(2).max(100).optional().describe('Ville ou lieu, ex. « Pornic » ou « Lyon, France » ; absent = la maison'),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ place }) => {
    const alerts = (lat: number, lon: number) => call<Vigilance>('GET', `/api/plugins/open_meteo/alerts?lat=${lat}&lon=${lon}`)
      .then((r) => (r.area ? r : null))
    if (place) {
      const { places } = await call<{ places: { name: string; region?: string; lat: number; lon: number }[] }>('GET', `/api/plugins/open_meteo/places?q=${encodeURIComponent(place)}&lang=fr`)
      const p = places[0]
      if (!p) return fail(`lieu introuvable "${place}"`)
      const r = await call<{ state: StateFor<'weather'>; forecast: WeatherForecast; timezone?: string; attribution: string }>('GET', `/api/plugins/open_meteo/at?lat=${p.lat}&lon=${p.lon}`)
      const vigilance = await alerts(p.lat, p.lon).catch(() => undefined)
      return json({
        place: optional({ name: p.name, region: p.region }), timezone: r.timezone,
        ...weatherDigest(r.state, r.forecast, { ...(r.timezone ? { tz: r.timezone } : {}), vigilance }), attribution: r.attribution,
      })
    }
    const entry = deps.registry.list().find((e) => e.descriptor.kind === 'weather')
    if (!entry) return fail("aucun appareil météo : activer le plugin open meteo dans Réglages → Plugins de Kasbah")
    const state = entry.state as StateFor<'weather'>
    if (!state.available) return fail('météo de la maison pas encore lue ou indisponible : voir get_health')
    const forecast = await deps.host.forecast(entry.descriptor.id)
    // la vigilance à venir vient de la route du plugin ; sans elle, celle en cours que porte l'état
    const { lat, lon } = deps.house.house.origin
    const vigilance = await alerts(lat, lon).catch(() => undefined)
    return json({
      place: { name: deps.house.house.name, home: true }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...weatherDigest(state, forecast, { vigilance }), ...optional({ attribution: entry.descriptor.meta.weather?.attribution }),
    })
  })

  server.registerTool('get_agenda', {
    title: "Lire l'agenda",
    description: "Événements des agendas de la maison (flux iCal ajoutés dans la vue Agenda), triés par début, heures locales de la maison. Une journée entière rend date (et until, dernier jour INCLUS, si elle en couvre plusieurs). Lecture seule.",
    inputSchema: z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Premier jour, YYYY-MM-DD ; absent = aujourd'hui"),
      days: z.number().int().min(1).max(62).default(7).describe('Nombre de jours à couvrir'),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ from, days }) => {
    const [y, m, d] = (from ?? localDay(new Date())).split('-').map(Number) as [number, number, number]
    const start = new Date(y, m - 1, d).getTime()
    const end = new Date(y, m - 1, d + days).getTime()
    const { calendars } = await call<{ calendars: { id: string; name: string; error: string | null }[] }>('GET', '/api/plugins/agenda/calendars')
    if (!calendars.length) return fail("aucun agenda : en ajouter un dans la vue Agenda de Kasbah (adresse iCal secrète)")
    const { events } = await call<{ events: AgendaEvent[] }>('GET', `/api/plugins/agenda/events?from=${start}&to=${end}`)
    const failing = calendars.filter((c) => c.error).map((c) => ({ calendar: c.name, error: c.error }))
    return json({
      from: localDay(new Date(start)), to: localDay(new Date(end - 1)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calendars: calendars.map((c) => c.name), ...(failing.length ? { failing } : {}),
      events: agendaDigest(events, calendars),
    })
  })

  // Automatisations : lire, lancer, activer ou couper. Ni création ni suppression : une règle tourne
  // sans surveillance, elle s'écrit dans la vue Automatisations.
  server.registerTool('list_automations', {
    title: 'Lister les automatisations',
    description: "Automatisations de la maison : déclencheur (heure fixe, soleil, état d'un appareil), « sauf si » (unless), actions, et leur statut (santé, références manquantes, prochaine exécution nextRun, dernière lastRun). Heures locales de la maison. Les ids se passent à run_automation et set_automation_enabled. Elles se créent et se modifient dans la vue Automatisations de Kasbah, pas ici.",
    inputSchema: z.object({ query: z.string().optional().describe('Sous-chaîne sans casse du nom ou de l\'id') }),
    annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    const { at } = clockOf()
    const { automations } = await call<{ automations: AutomationEntry[] }>('GET', '/api/automations')
    const q = query?.toLowerCase()
    return json(automations.filter(({ automation: a }) => !q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
      .map(({ automation: a, status: s }) => ({
        id: a.id, name: a.name, enabled: a.enabled, trigger: a.trigger, ...(a.unless.length ? { unless: a.unless } : {}), actions: a.actions,
        status: {
          health: s.health,
          ...optional({
            missing: s.missing.length ? s.missing : null,
            unavailableDeviceIds: s.unavailableDeviceIds.length ? s.unavailableDeviceIds : null,
            nextRun: s.nextRunAt && at(s.nextRunAt),
            pendingSince: s.pendingSince && at(s.pendingSince),
            lastRun: s.lastRun && { at: at(s.lastRun.at), by: s.lastRun.by, outcome: s.lastRun.outcome, ...(s.lastRun.errors.length ? { errors: s.lastRun.errors } : {}) },
          }),
        },
      })))
  })

  server.registerTool('run_automation', {
    title: 'Lancer une automatisation',
    description: "Exécute TOUT DE SUITE les actions d'une automatisation (id venu de list_automations), sans attendre son déclencheur et SANS vérifier ses « sauf si ». Marche aussi sur une automatisation désactivée. Rend outcome (ok, partial, failed) et les erreurs action par action.",
    inputSchema: z.object({ id: z.string() }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ id }) => {
    const { run } = await call<{ run: AutomationRun }>('POST', `/api/automations/${encodeURIComponent(id)}/run`)
    return json({ outcome: run.outcome, ...(run.errors.length ? { errors: run.errors } : {}) })
  })

  server.registerTool('set_automation_enabled', {
    title: 'Activer ou couper une automatisation',
    description: "Active (enabled: true) ou coupe (enabled: false) une automatisation (id venu de list_automations) : coupée, son déclencheur ne la lance plus. Rien d'autre n'est modifié.",
    inputSchema: z.object({ id: z.string(), enabled: z.boolean() }),
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ id, enabled }) => {
    const { automation } = await call<{ automation: AutomationEntry }>('PATCH', `/api/automations/${encodeURIComponent(id)}`, { enabled })
    return json({ ok: true, id: automation.automation.id, enabled: automation.automation.enabled })
  })

  // Liste de courses de la maison, par les routes `/api/shopping` : même file d'écriture, même
  // diffusion aux écrans. Un agent désigne une ligne par son nom (« le lait ») autant que par son id.
  // Coupée dans les Réglages, ses outils ne sont pas proposés du tout (une instance par requête :
  // la bascule vaut dès la requête suivante).
  if (pluginSettingsOf(deps.house.house.plugins, 'shopping').enabled) registerShoppingTools()
  function registerShoppingTools() {
    const shoppingView = (l: ShoppingList) => ({
      items: l.items.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, checked: i.checked })),
      favorites: l.products.filter((p) => p.favorite).map((p) => p.name),
    })
    const shoppingItemId = async (item: string) => {
      const { shopping } = await call<{ shopping: ShoppingList }>('GET', '/api/shopping')
      return findShoppingItem(shopping, item)?.id
    }
    const notInList = (item: string) => fail(`« ${item} » n'est pas dans la liste de courses (voir get_shopping_list)`)

    server.registerTool('get_shopping_list', {
      title: 'Lire la liste de courses',
      description: "Liste de courses partagée de la maison : lignes dans l'ordre d'ajout (id, name, quantity, checked = déjà pris), et les produits habituels (favorites) qu'on peut remettre dans la liste avec add_shopping_items.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    }, async () => json(shoppingView((await call<{ shopping: ShoppingList }>('GET', '/api/shopping')).shopping)))

    server.registerTool('add_shopping_items', {
      title: 'Ajouter à la liste de courses',
      description: `Ajoute un ou plusieurs produits (jusqu'à ${SHOPPING_ADD_MAX}) à la liste de courses. Un produit déjà dans la liste et pas encore pris voit sa quantité augmenter ; déjà pris (coché), il redevient à acheter. Noms courts, au singulier ou tels qu'on les dit (« lait », « pommes »), quantité facultative (1 par défaut). Rend la liste.`,
      inputSchema: z.object({ items: z.array(z.object({ name: shoppingNameSchema, quantity: shoppingQuantitySchema.optional() })).min(1).max(SHOPPING_ADD_MAX) }),
      annotations: { readOnlyHint: false },
    }, async ({ items }) => json(shoppingView((await call<{ shopping: ShoppingList }>('POST', '/api/shopping/items', { items })).shopping)))

    server.registerTool('update_shopping_item', {
      title: 'Cocher ou changer une ligne',
      description: "Coche une ligne de la liste de courses (checked: true = pris), la décoche, ou change sa quantité. La ligne se désigne par son id ou son nom. Rend la liste.",
      inputSchema: z.object({
        item: z.string().describe("Id ou nom de la ligne (get_shopping_list)"),
        checked: z.boolean().optional(),
        quantity: shoppingQuantitySchema.optional(),
      }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    }, async ({ item, checked, quantity }) => {
      if (checked === undefined && quantity === undefined) return fail('checked ou quantity attendu')
      const id = await shoppingItemId(item)
      if (!id) return notInList(item)
      const patch = { ...(checked !== undefined ? { checked } : {}), ...(quantity !== undefined ? { quantity } : {}) }
      return json(shoppingView((await call<{ shopping: ShoppingList }>('PATCH', `/api/shopping/items/${encodeURIComponent(id)}`, patch)).shopping))
    })

    server.registerTool('remove_shopping_item', {
      title: 'Retirer une ligne',
      description: "Retire une ligne de la liste de courses sans l'acheter (id ou nom). Le produit reste connu pour la recherche et les habituels. Rend la liste.",
      inputSchema: z.object({ item: z.string().describe("Id ou nom de la ligne (get_shopping_list)") }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    }, async ({ item }) => {
      const id = await shoppingItemId(item)
      if (!id) return notInList(item)
      return json(shoppingView((await call<{ shopping: ShoppingList }>('DELETE', `/api/shopping/items/${encodeURIComponent(id)}`)).shopping))
    })

    server.registerTool('finish_shopping', {
      title: 'Terminer les courses',
      description: "Retire de la liste de courses toutes les lignes cochées (déjà prises) ; celles qui restent à acheter ne bougent pas. Rend la liste.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    }, async () => json(shoppingView((await call<{ shopping: ShoppingList }>('POST', '/api/shopping/finish')).shopping)))

    server.registerTool('set_shopping_favorite', {
      title: 'Marquer un produit habituel',
      description: "Ajoute (favorite: true) ou retire (favorite: false) un produit des habituels de la liste de courses, qu'il ait déjà été acheté ou non. Ne l'ajoute pas à la liste. Rend la liste.",
      inputSchema: z.object({ name: shoppingNameSchema, favorite: z.boolean() }),
      annotations: { readOnlyHint: false, idempotentHint: true },
    }, async ({ name, favorite }) => json(shoppingView((await call<{ shopping: ShoppingList }>('PUT', '/api/shopping/favorites', { name, favorite })).shopping)))
  }

  // La file musicale est celle de Kasbah (lecteur commun), pas celle de l'enceinte : `media_player.next`
  // de send_command n'y saute pas.
  const deviceName = (id: string) => {
    const entry = deps.registry.get(id)
    return entry ? describe(entry).name : undefined
  }
  const trackView = (t: { [K in keyof QueueTrack]: QueueTrack[K] | null }) => optional({ source: t.source, id: t.id, title: t.title, artist: t.artist, durationS: t.durationS })
  const queueSummary = (q: QueueView) => ({
    index: q.index, length: q.items.length, repeat: q.repeat, ...(q.items[q.index] ? { current: trackView(q.items[q.index]!) } : {}),
  })

  server.registerTool('get_music', {
    title: 'Lire ce qui joue',
    description: "La musique de Kasbah (lancée par play_music, play_radio ou l'app) : playing = ce que chaque lecteur joue en ce moment, avec sa file (index, length, repeat) ; paused = la dernière écoute interrompue des lecteurs silencieux, à reprendre par control_music resume. Avec deviceId : en plus la file complète de ce lecteur (index de chaque piste pour control_music jump / remove). Pause et volume se lisent par get_device.",
    inputSchema: z.object({ deviceId: z.string().optional() }),
    annotations: { readOnlyHint: true },
  }, async ({ deviceId }) => {
    const { at } = clockOf()
    const [{ sessions }, { last }] = await Promise.all([
      call<{ sessions: MusicSession[] }>('GET', '/api/music/sessions'),
      call<{ last: LastPlayed[] }>('GET', '/api/music/last'),
    ])
    const queue = deviceId
      ? await call<QueueView>('GET', `/api/music/queue?deviceId=${encodeURIComponent(deviceId)}`).catch(() => null)
      : undefined
    return json({
      playing: sessions.map((s) => optional({
        deviceId: s.deviceId, device: deviceName(s.deviceId), ...trackView(s), queue: s.queue,
      })),
      paused: last.map((e) => optional({
        deviceId: e.deviceId, device: deviceName(e.deviceId), ...trackView(e.track), positionS: e.positionS, durationS: e.durationS, queue: e.queue, at: at(e.at),
      })),
      ...(queue === undefined ? {} : { queue: queue && { index: queue.index, repeat: queue.repeat, items: queue.items.map((t, i) => ({ index: i, ...trackView(t) })) } }),
    })
  })

  server.registerTool('queue_music', {
    title: 'Ajouter à la file',
    description: "Ajoute des pistes (venues de search_music) à la file d'un lecteur SANS interrompre ce qui joue : where next = juste après la piste en cours, end = à la fin (défaut). Si rien ne joue, la lecture part tout de suite. Pour remplacer ce qui joue : play_music.",
    inputSchema: z.object({ deviceId: z.string(), tracks: z.array(playableTrackSchema).min(1).max(100), where: z.enum(['next', 'end']).default('end') }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ deviceId, tracks, where }) => {
    const r = await call<{ started: boolean; queue: QueueView }>('POST', '/api/music/queue/add', { deviceId, tracks: tracks.map((t: PlayableTrack) => optional(t)), where })
    return json({ ok: true, started: r.started, queued: tracks.length, queue: queueSummary(r.queue) })
  })

  server.registerTool('control_music', {
    title: 'Piloter la file musicale',
    description: "Pilote la file Kasbah d'un lecteur : next / previous (au début de la piste si elle joue depuis quelques secondes), jump (index), remove (index, pas la piste en cours), repeat (mode : off, once = la file une fois, loop = en boucle), clear (vide la file, la piste en cours finit seule), resume (relance la dernière écoute de paused, à sa position ou à positionS), transfer (déplace la lecture vers toDeviceId, à la même position, et arrête deviceId). Index et lecteurs : get_music.",
    inputSchema: z.object({
      deviceId: z.string(),
      action: z.enum(['next', 'previous', 'jump', 'remove', 'repeat', 'clear', 'resume', 'transfer']),
      index: z.number().int().min(0).optional().describe('jump, remove'),
      mode: z.enum(REPEAT_MODES).optional().describe('repeat'),
      positionS: z.number().min(0).optional().describe('resume (facultatif)'),
      toDeviceId: z.string().optional().describe('transfer'),
    }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ deviceId, action, index, mode, positionS, toDeviceId }) => {
    const done = (r: QueueView | { queue?: QueueView }) => {
      const q = 'items' in r ? r : r.queue
      return json({ ok: true, ...(q ? { queue: queueSummary(q) } : {}) })
    }
    switch (action) {
      case 'next': case 'previous':
        return done(await call<QueueView>('POST', `/api/music/queue/${action}`, { deviceId }))
      case 'jump': case 'remove':
        if (index === undefined) return fail(`${action} demande index`)
        return done(await call<QueueView>('POST', `/api/music/queue/${action}`, { deviceId, index }))
      case 'repeat':
        if (!mode) return fail('repeat demande mode')
        return done(await call<QueueView>('POST', '/api/music/queue/repeat', { deviceId, mode }))
      case 'clear':
        return done(await call<QueueView>('DELETE', `/api/music/queue?deviceId=${encodeURIComponent(deviceId)}`))
      case 'resume':
        return done(await call<{ queue: QueueView }>('POST', '/api/music/resume', { deviceId, ...(positionS !== undefined ? { positionS } : {}) }))
      case 'transfer':
        if (!toDeviceId) return fail('transfer demande toDeviceId')
        return done(await call<{ queue?: QueueView }>('POST', '/api/music/transfer', { fromDeviceId: deviceId, toDeviceId }))
    }
  })

  server.registerTool('get_device_history', {
    title: "Historique d'un appareil",
    description: "Ce qu'un appareil a enregistré, à la demande (get_device ne donne que l'instant) : energy = puissances moyennes heure par heure (appareils energy, 48 h au plus, en mémoire depuis le démarrage du serveur) ; journal = erreurs et avertissements consignés par le fabricant (capacité journal, ex. tondeuse), du plus récent au plus ancien ; water = litres consommés par heure, jour et mois (capacité water_usage, ex. traitement d'eau, fontaine). Rend les séries que l'appareil a. Heures locales de la maison.",
    inputSchema: z.object({ id: z.string(), hours: z.number().int().min(1).max(48).default(24).describe('Profondeur des séries horaires') }),
    annotations: { readOnlyHint: true },
  }, async ({ id, hours }) => {
    const entry = deps.registry.get(id)
    if (!entry) return fail(`appareil inconnu "${id}"`)
    const { day, at } = clockOf()
    const caps = entry.descriptor.capabilities as readonly string[]
    const path = `/api/devices/${encodeURIComponent(entry.descriptor.id)}`
    const out: Record<string, unknown> = { id: entry.descriptor.id, name: describe(entry).name }
    if (entry.descriptor.kind === 'energy') {
      const { points } = await call<EnergyHistory>('GET', `${path}/history?hours=${hours}`)
      out.energy = points.map((p) => ({ at: at(p.t), productionW: p.productionW, consumptionW: p.consumptionW, gridW: p.gridW }))
    }
    if (caps.includes('journal')) {
      const { entries } = await call<DeviceJournal>('GET', `${path}/journal`)
      out.journal = entries.slice(0, 50).map((e) => ({ at: at(e.at), severity: e.severity, ...optional({ code: e.code, message: e.message, location: e.location }) }))
    }
    if (caps.includes('water_usage')) {
      const c = await call<DeviceConsumption>('GET', `${path}/consumption`)
      out.water = {
        hourly: c.hourly.slice(-hours).map((p) => ({ at: at(p.t), litres: p.litres })),
        daily: c.daily.slice(-31).map((p) => ({ date: day.format(p.t), litres: p.litres })),
        monthly: c.monthly.map((p) => ({ month: day.format(p.t).slice(0, 7), litres: p.litres })),
      }
    }
    if (Object.keys(out).length === 2) return fail(`"${id}" ne garde ni historique d'énergie, ni journal, ni consommation`)
    return json(out)
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
