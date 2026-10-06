import { apiErrorSchema, automationResponseSchema, automationRunResponseSchema, automationsResponseSchema, devicesResponseSchema, energyHistorySchema, healthResponseSchema, houseSchema, pluginsResponseSchema, scenesResponseSchema, serverMessageSchema, weatherForecastSchema, deviceJournalSchema, deviceConsumptionSchema, deviceReleaseNotesSchema, type AutomationBody, type AutomationEntry, type AutomationRun, type CommandInput, type DeviceConsumption, type DeviceJournal, type DeviceEntry, type DevicePlacement, type EnergyHistory, type HealthResponse, type House, type PluginInfo, type PluginSceneEntry, type PluginSettingsPatch, type SceneRecallInput, type SceneUpdate, type WeatherForecast } from '@kasbah/shared'
import { parseDeviceId } from '@kasbah/shared'
import { ApiRequestError, type AgendaCalendar, type AgendaEvent, type ConnectionStatus, type EnphasePairing, type EnphaseTokenStatus, type HeatingPoint, type IrobotStatus, type LightHistory, type McpUser, type MelcloudStatus, type MelcloudUnit, type MixcloudHomeSection, type MixcloudPage, type MixcloudStatus, type MixcloudUser, type PetkitStatus, type RadioStation, type RenaultStatus, type SchoolData, type TeslaStatus, type Transport, type TransportHandlers, type WeatherAlerts, type WeatherElsewhere, type WeatherPlace, type YtmusicExplore, type YtmusicExploreShelf, type YtmusicPlaylist, type MusicLastPlayed, type MusicQueue, type YtmusicSearchResult, type MusicSession, type YtmusicStatus, type YtmusicTrack } from './transport'

// URLs relatives : même origine en prod (Fastify sert le build) et via le proxy Vite en dev.

const STALE_AFTER_MS = 45_000       // aucune trame depuis 45 s → on considère le lien mort et on reconnecte
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30_000

/**
 * Sous l'adresse publique, une session finie (expirée, mot de passe changé, compte retiré) : retour à
 * la page de connexion du serveur, qui ramènera ici. Le code seul compte : d'autres routes rendent 401
 * pour leur propre compte chez un fabricant.
 */
function signInAgain() {
  location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`)
}

async function request<T>(url: string, init: RequestInit | undefined, parse: (json: unknown) => T): Promise<T> {
  let res: Response
  try { res = await fetch(url, init) }
  catch (err) { throw new ApiRequestError(0, 'NETWORK', (err as Error).message) }
  if (!res.ok) {
    let code = 'HTTP_ERROR', message = `HTTP ${res.status}`
    try {
      const body = apiErrorSchema.safeParse(await res.json())
      if (body.success) ({ code, message } = body.data.error)
    } catch { /* corps non JSON */ }
    if (res.status === 401 && code === 'AUTH_REQUIRED') signInAgain()
    throw new ApiRequestError(res.status, code, message)
  }
  return parse(await res.json())
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export function createHttpTransport(base = ''): Transport {
  /** Un geste sur la file d'un lecteur (`/queue/<step>`) : le serveur rend la file telle qu'elle est après. */
  const queueStep = (step: string, body: object) => request(
    `${base}/api/music/queue/${step}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    (j) => j as MusicQueue,
  )
  return {
    getHouse: () => request(`${base}/api/house`, undefined, (j) => houseSchema.parse(j) as House),
    getDevices: () => request(`${base}/api/devices`, undefined, (j) => devicesResponseSchema.parse(j).devices as DeviceEntry[]),
    getHealth: () => request(`${base}/api/health`, undefined, (j) => healthResponseSchema.parse(j) as HealthResponse),
    getHistory: (deviceId, hours = 24) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/history?hours=${hours}`, undefined, (j) => energyHistorySchema.parse(j) as EnergyHistory),
    getForecast: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/forecast`, undefined, (j) => weatherForecastSchema.parse(j) as WeatherForecast),
    searchPlaces: (query, lang) => request(
      `${base}/api/plugins/open_meteo/places?q=${encodeURIComponent(query)}&lang=${encodeURIComponent(lang)}`, undefined,
      (j) => (j as { places: WeatherPlace[] }).places,
    ),
    getWeatherAt: (lat, lon) => request(`${base}/api/plugins/open_meteo/at?lat=${lat}&lon=${lon}`, undefined, (j) => j as WeatherElsewhere),
    getWeatherAlerts: (lat, lon) => request(`${base}/api/plugins/open_meteo/alerts?lat=${lat}&lon=${lon}`, undefined, (j) => j as WeatherAlerts),
    getJournal: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/journal`, undefined, (j) => deviceJournalSchema.parse(j) as DeviceJournal),
    getReleaseNotes: (deviceId, lang) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/release-notes?lang=${encodeURIComponent(lang)}`, undefined, (j) => deviceReleaseNotesSchema.parse(j)),
    getConsumption: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/consumption`, undefined, (j) => deviceConsumptionSchema.parse(j) as DeviceConsumption),
    sendCommand: (deviceId, command: CommandInput) => request(
      `${base}/api/devices/${encodeURIComponent(deviceId)}/command`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) },
      () => undefined,
    ),
    getScenes: () => request(`${base}/api/scenes`, undefined, (j) => scenesResponseSchema.parse(j).scenes as PluginSceneEntry[]),
    recallScene: (sceneId, recall: SceneRecallInput) => request(
      `${base}/api/scenes/${encodeURIComponent(sceneId)}/recall`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(recall) },
      () => undefined,
    ),
    updateScene: (sceneId, update: SceneUpdate) => request(
      `${base}/api/scenes/${encodeURIComponent(sceneId)}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(update) },
      () => undefined,
    ),
    createScene: (fromSceneId, groupName) => request(
      `${base}/api/scenes`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromSceneId, groupName }) },
      () => undefined,
    ),
    deleteScene: (sceneId) => request(
      `${base}/api/scenes/${encodeURIComponent(sceneId)}`,
      { method: 'DELETE' },
      () => undefined,
    ),
    getAutomations: () => request(`${base}/api/automations`, undefined, (j) => automationsResponseSchema.parse(j).automations as AutomationEntry[]),
    putAutomation: (id, body: AutomationBody) => request(
      `${base}/api/automations/${encodeURIComponent(id)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => automationResponseSchema.parse(j).automation as AutomationEntry,
    ),
    setAutomationEnabled: (id, enabled) => request(
      `${base}/api/automations/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) },
      (j) => automationResponseSchema.parse(j).automation as AutomationEntry,
    ),
    deleteAutomation: (id) => request(`${base}/api/automations/${encodeURIComponent(id)}`, { method: 'DELETE' }, () => undefined),
    runAutomation: (id) => request(
      `${base}/api/automations/${encodeURIComponent(id)}/run`,
      { method: 'POST' },
      (j) => automationRunResponseSchema.parse(j).run as AutomationRun,
    ),
    getPlugins: () => request(`${base}/api/plugins`, undefined, (j) => pluginsResponseSchema.parse(j).plugins as PluginInfo[]),
    setPluginSettings: (pluginId, patch: PluginSettingsPatch) => request(
      `${base}/api/plugins/${encodeURIComponent(pluginId)}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => pluginsResponseSchema.parse(j).plugins as PluginInfo[],
    ),
    placeDevice: (id, placement: DevicePlacement) => request(
      `${base}/api/house/devices/${encodeURIComponent(id)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(placement) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    removeDevice: (id) => request(
      `${base}/api/house/devices/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveArray: (id, patch) => request(
      `${base}/api/house/arrays/${encodeURIComponent(id)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    removeArray: (id) => request(
      `${base}/api/house/arrays/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveEdit: (patch) => request(
      `${base}/api/house/edit`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveOpening: (roomId, openingId, patch) => request(
      `${base}/api/house/rooms/${encodeURIComponent(roomId)}/openings/${encodeURIComponent(openingId)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    addOpening: (roomId, opening) => request(
      `${base}/api/house/rooms/${encodeURIComponent(roomId)}/openings`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(opening) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    removeOpening: (roomId, openingId) => request(
      `${base}/api/house/rooms/${encodeURIComponent(roomId)}/openings/${encodeURIComponent(openingId)}`,
      { method: 'DELETE' },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    addParking: (parking) => request(
      `${base}/api/house/parkings`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parking) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveParking: (id, patch) => request(
      `${base}/api/house/parkings/${encodeURIComponent(id)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    removeParking: (id) => request(
      `${base}/api/house/parkings/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    addGardenItem: (item) => request(
      `${base}/api/house/garden`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveGardenItem: (id, patch) => request(
      `${base}/api/house/garden/${encodeURIComponent(id)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    removeGardenItem: (id) => request(
      `${base}/api/house/garden/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    setRoomOrder: (levelId, roomIds) => request(
      `${base}/api/house/levels/${encodeURIComponent(levelId)}/room-order`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomIds }) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveRenderTuning: (tuning) => request(
      `${base}/api/house/render`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(tuning) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveRelief: (relief) => request(
      `${base}/api/house/relief`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(relief) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    saveTerrain: (polygon) => request(
      `${base}/api/house/terrain`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(polygon) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    pairHue: () => request(`${base}/api/plugins/hue/pair`, { method: 'POST' }, (j) => j as { appKey: string; hint: string }),
    nestAuthUrl: () => request(`${base}/api/plugins/nest/auth/url`, undefined, (j) => j as { url: string; redirectUri: string }),
    enphaseTokenStatus: () => request(`${base}/api/plugins/enphase/token`, undefined, (j) => j as EnphaseTokenStatus),
    // le corps peut porter un mot de passe : POST, jamais en query (il finirait dans les journaux)
    pairEnphase: (body: EnphasePairing) => request(
      `${base}/api/plugins/enphase/token`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as EnphaseTokenStatus,
    ),
    teslaStatus: () => request(`${base}/api/plugins/tesla/status`, undefined, (j) => j as TeslaStatus),
    teslaRegister: () => request(`${base}/api/plugins/tesla/register`, { method: 'POST' }, (j) => j as TeslaStatus),
    teslaAuthUrl: () => request(`${base}/api/plugins/tesla/auth/url`, undefined, (j) => j as { url: string; redirectUri: string }),
    teslaRotateKey: () => request(`${base}/api/plugins/tesla/public-key/rotate`, { method: 'POST' }, (j) => j as TeslaStatus),
    renaultStatus: () => request(`${base}/api/plugins/renault/status`, undefined, (j) => j as RenaultStatus),
    renaultLogin: (body) => request(
      `${base}/api/plugins/renault/login`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as RenaultStatus,
    ),
    renaultLogout: () => request(`${base}/api/plugins/renault/logout`, { method: 'POST' }, (j) => j as RenaultStatus),
    melcloudStatus: () => request(`${base}/api/plugins/melcloud/status`, undefined, (j) => j as MelcloudStatus),
    melcloudLogin: (body) => request(
      `${base}/api/plugins/melcloud/login`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as MelcloudStatus,
    ),
    melcloudLogout: () => request(`${base}/api/plugins/melcloud/logout`, { method: 'POST' }, (j) => j as MelcloudStatus),
    melcloudSystem: () => request(`${base}/api/plugins/melcloud/system`, undefined, (j) => j as { units: MelcloudUnit[]; pollMs: number }),
    melcloudHistory: () => request(`${base}/api/plugins/melcloud/history`, undefined, (j) => j as { hourly: HeatingPoint[]; pollMs: number }),
    lightHistory: (deviceId) => {
      const [pluginId, externalId] = [deviceId.slice(0, deviceId.indexOf(':')), deviceId.slice(deviceId.indexOf(':') + 1)]
      if (pluginId !== 'tahoma') return Promise.reject(new ApiRequestError(501, 'NOT_IMPLEMENTED', `no light history for ${deviceId}`))
      return request(`${base}/api/plugins/tahoma/light/${encodeURIComponent(externalId)}`, undefined, (j) => j as LightHistory)
    },
    petkitStatus: () => request(`${base}/api/plugins/petkit/status`, undefined, (j) => j as PetkitStatus),
    petkitRequestCode: (body) => request(
      `${base}/api/plugins/petkit/login/code`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { sent: boolean },
    ),
    petkitLogin: (body) => request(
      `${base}/api/plugins/petkit/login`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as PetkitStatus,
    ),
    petkitLogout: () => request(`${base}/api/plugins/petkit/logout`, { method: 'POST' }, (j) => j as PetkitStatus),
    irobotStatus: () => request(`${base}/api/plugins/irobot/status`, undefined, (j) => j as IrobotStatus),
    irobotLogin: (body) => request(
      `${base}/api/plugins/irobot/login`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as IrobotStatus,
    ),
    irobotLogout: () => request(`${base}/api/plugins/irobot/logout`, { method: 'POST' }, (j) => j as IrobotStatus),
    ytmusicStatus: () => request(`${base}/api/plugins/ytmusic/status`, undefined, (j) => j as YtmusicStatus),
    ytmusicPutCookie: (cookie) => request(
      `${base}/api/plugins/ytmusic/cookie`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cookie }) },
      (j) => j as YtmusicStatus,
    ),
    ytmusicImportCookieFromBrowser: (browser) => request(
      `${base}/api/plugins/ytmusic/cookie/from-browser`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browser }) },
      (j) => j as YtmusicStatus,
    ),
    ytmusicClearCookie: () => request(`${base}/api/plugins/ytmusic/cookie`, { method: 'DELETE' }, (j) => j as YtmusicStatus),
    ytmusicSearch: (q) => request(
      `${base}/api/plugins/ytmusic/search?q=${encodeURIComponent(q)}`, undefined,
      (j) => j as YtmusicSearchResult,
    ),
    ytmusicLiked: () => request(`${base}/api/plugins/ytmusic/library/liked`, undefined, (j) => j as { tracks: YtmusicTrack[] }),
    ytmusicPlaylists: () => request(`${base}/api/plugins/ytmusic/library/playlists`, undefined, (j) => j as { playlists: YtmusicPlaylist[] }),
    ytmusicPlaylist: (id) => request(
      `${base}/api/plugins/ytmusic/playlists/${encodeURIComponent(id)}`, undefined,
      (j) => j as { tracks: YtmusicTrack[] },
    ),
    ytmusicAlbum: (id, hl) => request(
      `${base}/api/plugins/ytmusic/albums/${encodeURIComponent(id)}${hl ? `?hl=${encodeURIComponent(hl)}` : ''}`, undefined,
      (j) => j as { tracks: YtmusicTrack[]; description?: string | null },
    ),
    ytmusicArtist: (id, hl) => request(
      `${base}/api/plugins/ytmusic/artists/${encodeURIComponent(id)}${hl ? `?hl=${encodeURIComponent(hl)}` : ''}`, undefined,
      (j) => j as { tracks: YtmusicTrack[]; description?: string | null },
    ),
    ytmusicExplore: (hl) => request(
      `${base}/api/plugins/ytmusic/explore${hl ? `?hl=${encodeURIComponent(hl)}` : ''}`, undefined, (j) => j as YtmusicExplore,
    ),
    ytmusicExploreCategory: (params, hl) => request(
      `${base}/api/plugins/ytmusic/explore/category?params=${encodeURIComponent(params)}${hl ? `&hl=${encodeURIComponent(hl)}` : ''}`,
      undefined, (j) => j as { shelves: YtmusicExploreShelf[] },
    ),
    ytmusicExploreNew: (hl) => request(
      `${base}/api/plugins/ytmusic/explore/new${hl ? `?hl=${encodeURIComponent(hl)}` : ''}`, undefined,
      (j) => j as { shelves: YtmusicExploreShelf[] },
    ),
    ytmusicExploreCovers: (hl) => request(
      `${base}/api/plugins/ytmusic/explore/covers${hl ? `?hl=${encodeURIComponent(hl)}` : ''}`, undefined,
      (j) => j as { covers: Record<string, string[]> },
    ),
    musicPlay: (body) => request(
      `${base}/api/music/play`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { ok: true; streamUrl: string; sid: string },
    ),
    musicSessions: () => request(`${base}/api/music/sessions`, undefined, (j) => j as { sessions: MusicSession[] }),
    musicLast: () => request(`${base}/api/music/last`, undefined, (j) => j as { last: MusicLastPlayed[] }),
    musicResume: (deviceId, positionS) => request(
      `${base}/api/music/resume`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId, ...(positionS !== undefined ? { positionS } : {}) }) },
      (j) => j as { ok: true; streamUrl: string; sid: string; queue: MusicQueue },
    ),
    musicTransfer: (body) => request(
      `${base}/api/music/transfer`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => {
        const r = j as Awaited<ReturnType<Transport['musicTransfer']>>
        // cible = ce navigateur : le chemin rendu est relatif au serveur
        return r.session ? { ...r, streamUrl: `${base}${r.streamUrl}` } : r
      },
    ),
    musicLocalPlay: (body) => request(
      `${base}/api/music/local`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => {
        const r = j as { ok: true; streamUrl: string; session: MusicSession }
        return { ...r, streamUrl: `${base}${r.streamUrl}` }
      },
    ),
    musicQueuePlay: (body) => request(
      `${base}/api/music/queue`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { ok: true; streamUrl: string; sid: string; queue: MusicQueue },
    ),
    musicQueue: (deviceId) => request(`${base}/api/music/queue?deviceId=${encodeURIComponent(deviceId)}`, undefined, (j) => j as MusicQueue),
    musicQueueAdd: (body) => request(
      `${base}/api/music/queue/add`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { ok: true; started: boolean; queue: MusicQueue },
    ),
    musicQueueNext: (deviceId) => queueStep('next', { deviceId }),
    musicQueuePrevious: (deviceId) => queueStep('previous', { deviceId }),
    musicQueueJump: (deviceId, index) => queueStep('jump', { deviceId, index }),
    musicQueueRepeat: (deviceId, mode) => queueStep('repeat', { deviceId, mode }),
    musicQueueRemove: (deviceId, index) => queueStep('remove', { deviceId, index }),
    musicProgress: async (body) => {
      await request(`${base}/api/music/progress`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, () => undefined)
    },
    musicQueueClear: (deviceId) => request(
      `${base}/api/music/queue?deviceId=${encodeURIComponent(deviceId)}`, { method: 'DELETE' }, (j) => j as MusicQueue,
    ),
    session: () => request(`${base}/api/session`, undefined, (j) => j as { user: string | null }),
    mcpUsers: () => request(`${base}/api/mcp/users`, undefined, (j) => j as { users: McpUser[] }),
    mcpSetUser: (name, password) => request(`${base}/api/mcp/users/${encodeURIComponent(name)}`, json('PUT', { password }), (j) => j as { users: McpUser[] }),
    mcpRemoveUser: (name) => request(`${base}/api/mcp/users/${encodeURIComponent(name)}`, { method: 'DELETE' }, (j) => j as { users: McpUser[] }),
    agendaCalendars: () => request(`${base}/api/plugins/agenda/calendars`, undefined, (j) => j as { calendars: AgendaCalendar[] }),
    agendaAddCalendar: (body) => request(
      `${base}/api/plugins/agenda/calendars`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { calendars: AgendaCalendar[] },
    ),
    agendaUpdateCalendar: (id, patch) => request(
      `${base}/api/plugins/agenda/calendars/${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => j as { calendars: AgendaCalendar[] },
    ),
    agendaRemoveCalendar: (id) => request(`${base}/api/plugins/agenda/calendars/${encodeURIComponent(id)}`, { method: 'DELETE' }, (j) => j as { calendars: AgendaCalendar[] }),
    agendaReorderCalendars: (ids) => request(
      `${base}/api/plugins/agenda/calendars/order`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) },
      (j) => j as { calendars: AgendaCalendar[] },
    ),
    agendaEvents: (from, to) => request(`${base}/api/plugins/agenda/events?from=${from}&to=${to}`, undefined, (j) => j as { events: AgendaEvent[] }),
    schoolData: () => request(`${base}/api/plugins/toutemonannee/school`, undefined, (j) => j as SchoolData),
    schoolLogin: (body) => request(`${base}/api/plugins/toutemonannee/login`, json('POST', body), (j) => j as SchoolData),
    schoolLogout: () => request(`${base}/api/plugins/toutemonannee/logout`, { method: 'POST' }, (j) => j as SchoolData),
    schoolRefresh: () => request(`${base}/api/plugins/toutemonannee/refresh`, { method: 'POST' }, (j) => j as SchoolData),
    schoolSetDone: (journalId, id, done) => request(
      `${base}/api/plugins/toutemonannee/homework/${encodeURIComponent(journalId)}/${id}/done`,
      json('PUT', { done }),
      (j) => j as SchoolData,
    ),
    schoolSetFilters: (filters) => request(`${base}/api/plugins/toutemonannee/filters`, json('PUT', filters), (j) => j as SchoolData),
    schoolSeenPosts: (id) => request(`${base}/api/plugins/toutemonannee/posts/seen`, json('PUT', { id }), (j) => j as SchoolData),
    mixcloudStatus: () => request(`${base}/api/plugins/mixcloud/status`, undefined, (j) => j as MixcloudStatus),
    mixcloudSetAccount: (username) => request(
      `${base}/api/plugins/mixcloud/account`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username }) },
      (j) => j as MixcloudStatus,
    ),
    mixcloudClearAccount: () => request(`${base}/api/plugins/mixcloud/account`, { method: 'DELETE' }, (j) => j as MixcloudStatus),
    mixcloudList: (list, next) => request(`${base}/api/plugins/mixcloud/library/${list}${next ? `?next=${encodeURIComponent(next)}` : ''}`, undefined, (j) => j as MixcloudPage),
    mixcloudHome: () => request(`${base}/api/plugins/mixcloud/home`, undefined, (j) => j as { sections: MixcloudHomeSection[] }),
    mixcloudPlaylists: () => request(`${base}/api/plugins/mixcloud/playlists`, undefined, (j) => j as { playlists: { key: string; name: string }[] }),
    mixcloudPlaylist: (key, next) => request(`${base}/api/plugins/mixcloud/playlist?key=${encodeURIComponent(key)}${next ? `&next=${encodeURIComponent(next)}` : ''}`, undefined, (j) => j as MixcloudPage),
    mixcloudFollowing: () => request(`${base}/api/plugins/mixcloud/following`, undefined, (j) => j as { users: MixcloudUser[] }),
    mixcloudUserMixes: (username, next) => request(`${base}/api/plugins/mixcloud/users/${encodeURIComponent(username)}/cloudcasts${next ? `?next=${encodeURIComponent(next)}` : ''}`, undefined, (j) => j as MixcloudPage),
    mixcloudSearch: (q, next) => request(`${base}/api/plugins/mixcloud/search?q=${encodeURIComponent(q)}${next ? `&next=${encodeURIComponent(next)}` : ''}`, undefined, (j) => j as MixcloudPage),
    mixcloudForgetResume: async (key) => {
      await request(`${base}/api/plugins/mixcloud/resume?key=${encodeURIComponent(key)}`, { method: 'DELETE' }, () => undefined)
    },
    radioSearch: (q) => request(`${base}/api/plugins/radio/search?q=${encodeURIComponent(q)}`, undefined, (j) => j as { stations: RadioStation[] }),
    radioTop: (country) => request(`${base}/api/plugins/radio/top${country ? `?country=${encodeURIComponent(country)}` : ''}`, undefined, (j) => j as { stations: RadioStation[] }),
    radioFavorites: () => request(`${base}/api/plugins/radio/favorites`, undefined, (j) => j as { stations: RadioStation[] }),
    radioAddFavorite: (station) => request(
      `${base}/api/plugins/radio/favorites/${encodeURIComponent(station.id)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(station) },
      (j) => j as { stations: RadioStation[] },
    ),
    radioAddCustom: (body) => request(
      `${base}/api/plugins/radio/favorites/custom`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { stations: RadioStation[] },
    ),
    radioRemoveFavorite: (id) => request(`${base}/api/plugins/radio/favorites/${encodeURIComponent(id)}`, { method: 'DELETE' }, (j) => j as { stations: RadioStation[] }),
    radioPlay: (body) => request(
      `${base}/api/plugins/radio/play`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { ok: true; station: RadioStation },
    ),
    radioPlaying: () => request(`${base}/api/plugins/radio/playing`, undefined, (j) => j as { playing: { deviceId: string; station: RadioStation }[] }),
    forgetDevice: (deviceId) => {
      const { pluginId, externalId } = parseDeviceId(deviceId)
      return request(
        `${base}/api/plugins/${encodeURIComponent(pluginId)}/devices/${encodeURIComponent(externalId)}`,
        { method: 'DELETE' },
        () => undefined,
      )
    },
    cameraStreamUrl: (deviceId) => {
      const { pluginId, externalId } = parseDeviceId(deviceId)
      return `${wsBase(base)}/api/plugins/${pluginId}/cameras/${encodeURIComponent(externalId)}/stream`
    },
    cameraSnapshots: (pluginId, watch) => request(
      `${base}/api/plugins/${encodeURIComponent(pluginId)}/cameras/snapshots${watch ? '?watch=1' : ''}`, undefined,
      (j) => (j as { snapshots: Record<string, { at?: number; live: boolean; inactive?: boolean; paused?: boolean }> }).snapshots,
    ),
    setCameraSnapshots: (deviceId, enabled) => {
      const { pluginId, externalId } = parseDeviceId(deviceId)
      return request(
        `${base}/api/plugins/${encodeURIComponent(pluginId)}/cameras/${encodeURIComponent(externalId)}/snapshots`,
        { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) },
        () => undefined,
      )
    },
    cameraSnapshotUrl: (deviceId, at) => {
      const { pluginId, externalId } = parseDeviceId(deviceId)
      return `${base}/api/plugins/${pluginId}/cameras/${encodeURIComponent(externalId)}/snapshot.jpg?t=${at}`
    },
    connect: (handlers) => connectWebSocket(base, handlers),
  }
}

/** Origine WebSocket : celle de `base` si elle est donnée, sinon la page elle-même (proxy Vite en dev). */
function wsBase(base: string): string {
  if (base) return base.replace(/^http/, 'ws')
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
}

/** WebSocket avec reconnexion exponentielle et détection de lien silencieux. */
function connectWebSocket(base: string, handlers: TransportHandlers): () => void {
  let ws: WebSocket | null = null
  let closed = false
  let attempts = 0
  let staleTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let status: ConnectionStatus = 'connecting'

  const setStatus = (s: ConnectionStatus) => { if (s !== status) { status = s; handlers.onStatus(s) } }
  const url = () => `${wsBase(base)}/ws`
  const armStale = () => {
    if (staleTimer) clearTimeout(staleTimer)
    staleTimer = setTimeout(() => { setStatus('stale'); ws?.close() }, STALE_AFTER_MS)
  }
  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(attempts, 5)) * (0.8 + Math.random() * 0.4)
    attempts++
    reconnectTimer = setTimeout(() => { reconnectTimer = null; open() }, delay)
  }
  const open = () => {
    if (closed) return
    if (attempts > 0) setStatus(attempts > 2 ? 'offline' : 'connecting')
    ws = new WebSocket(url())
    // IMPORTANT : traiter chaque trame dans onmessage, jamais via un watch sur une ref haute fréquence
    // (un watcher coalesce et perdrait des messages intermédiaires).
    ws.onmessage = (ev) => {
      armStale()
      let msg
      try { msg = serverMessageSchema.parse(JSON.parse(String(ev.data))) } catch { return }
      if (msg.type === 'snapshot') { attempts = 0; setStatus('online') }
      handlers.onMessage(msg)
    }
    ws.onopen = () => { armStale() }
    ws.onclose = () => {
      if (staleTimer) clearTimeout(staleTimer)
      if (closed) return
      if (status === 'online') setStatus('connecting')
      // Un refus de session ne se lit pas sur un WebSocket : on le demande à l'API, qui renvoie à
      // la connexion s'il le faut (`request`).
      request(`${base}/api/session`, undefined, () => null).catch(() => {})
      scheduleReconnect()
    }
    ws.onerror = () => { ws?.close() }
  }
  handlers.onStatus('connecting')
  open()
  return () => {
    closed = true
    if (staleTimer) clearTimeout(staleTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
  }
}
