import { shoppingResponseSchema, type ShoppingList, apiErrorSchema, automationResponseSchema, automationRunResponseSchema, automationsResponseSchema, devicesResponseSchema, energyHistorySchema, healthResponseSchema, houseSchema, pluginsResponseSchema, propertiesResponseSchema, propertyCreatedSchema, scenesResponseSchema, serverMessageSchema, weatherForecastSchema, deviceJournalSchema, deviceConsumptionSchema, deviceEnergyDaysSchema, deviceReleaseNotesSchema, siteMapSchema, type SiteMap, type AutomationBody, type AutomationEntry, type AutomationRun, type CommandInput, type DeviceConsumption, type DeviceEnergyDays, type DeviceJournal, type DeviceEntry, type DevicePlacement, type EnergyHistory, type HealthResponse, type House, type PluginInfo, type PluginSceneEntry, type PluginSettingsPatch, type SceneRecallInput, type SceneUpdate, type WeatherForecast } from '@kasbah/shared'
import { parseDeviceId } from '@kasbah/shared'
import { t } from '../i18n'
import { ApiRequestError, type AgendaCalendar, type AssistantEvent, type ClaudeAccount, type TranscriptionSettings, type AssistantLogEntry, type AgendaEvent, type ConnectionStatus, type EnphasePairing, type EnphaseTokenStatus, type HeatingPoint, type IrobotStatus, type LightHistory, type McpUser, type SystemVersion, type UpdateStatus, type MelcloudStatus, type MelcloudUnit, type MixcloudHomeSection, type MixcloudPage, type MixcloudStatus, type MixcloudUser, type PetkitStatus, type RadioStation, type RenaultContract, type RenaultStatus, type SchoolData, type TeslaStatus, type Transport, type TransportHandlers, type WeatherAlerts, type WeatherElsewhere, type WeatherPlace, type YtmusicExplore, type YtmusicExploreShelf, type YtmusicPlaylist, type MusicLastPlayed, type MusicQueue, type YtmusicSearchResult, type MusicSession, type YtmusicStatus, type YtmusicTrack } from './transport'

// Relative URLs: same origin in prod (Fastify serves the build) and through the Vite proxy in dev.

const STALE_AFTER_MS = 45_000       // no frame for 45 s → the link is considered dead and we reconnect
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30_000

/**
 * Under the public address, a finished session (expired, password changed, account removed): back to
 * the server's login page, which will bring us back here. Only the code counts: other routes return 401
 * for their own account at a vendor.
 */
function signInAgain() {
  location.assign(`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`)
}

/** The error of a non-OK response, with the API's code and message when it gives them. */
async function errorOf(res: Response): Promise<ApiRequestError> {
  let code = 'HTTP_ERROR', message = `HTTP ${res.status}`
  try {
    const body = apiErrorSchema.safeParse(await res.json())
    if (body.success) ({ code, message } = body.data.error)
  } catch { /* non-JSON body */ }
  if (res.status === 401 && code === 'AUTH_REQUIRED') signInAgain()
  // a demonstration is not written to: the message says so in the screen's language, with what follows
  if (code === 'DEMO_READONLY') message = t('properties.readOnly')
  return new ApiRequestError(res.status, code, message)
}

async function request<T>(url: string, init: RequestInit | undefined, parse: (json: unknown) => T): Promise<T> {
  let res: Response
  try { res = await fetch(url, init) }
  catch (err) { throw new ApiRequestError(0, 'NETWORK', (err as Error).message) }
  if (!res.ok) throw await errorOf(res)
  return parse(await res.json())
}

/** Binary response (a sound): same errors as `request`. */
async function requestBlob(url: string, init: RequestInit): Promise<Blob> {
  let res: Response
  try { res = await fetch(url, init) }
  catch (err) { throw new ApiRequestError(0, 'NETWORK', (err as Error).message) }
  if (!res.ok) throw await errorOf(res)
  return res.blob()
}

/** NDJSON response (one JSON line per event), read as it arrives. */
async function streamLines(url: string, init: RequestInit, onLine: (json: unknown) => void): Promise<void> {
  let res: Response
  try { res = await fetch(url, init) }
  catch (err) { throw new ApiRequestError(0, 'NETWORK', (err as Error).message) }
  if (!res.ok || !res.body) throw await errorOf(res)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let rest = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    const lines = (rest + value).split('\n')
    rest = lines.pop()!
    for (const line of lines) if (line.trim()) onLine(JSON.parse(line))
  }
  if (rest.trim()) onLine(JSON.parse(rest))
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const shoppingOf = (j: unknown) => shoppingResponseSchema.parse(j).shopping as ShoppingList

export function createHttpTransport(base = ''): Transport {
  /** A gesture on a player's queue (`/queue/<step>`): the server returns the queue as it is afterwards. */
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
    getSiteMap: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/map`, undefined, (j) => siteMapSchema.parse(j) as SiteMap),
    getReleaseNotes: (deviceId, lang) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/release-notes?lang=${encodeURIComponent(lang)}`, undefined, (j) => deviceReleaseNotesSchema.parse(j)),
    getConsumption: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/consumption`, undefined, (j) => deviceConsumptionSchema.parse(j) as DeviceConsumption),
    getEnergyDays: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/energy-days`, undefined, (j) => deviceEnergyDaysSchema.parse(j) as DeviceEnergyDays),
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
    setAutomationOrder: (ids) => request(
      `${base}/api/automation-order`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids }) },
      (j) => automationsResponseSchema.parse(j).automations as AutomationEntry[],
    ),
    runAutomation: (id) => request(
      `${base}/api/automations/${encodeURIComponent(id)}/run`,
      { method: 'POST' },
      (j) => automationRunResponseSchema.parse(j).run as AutomationRun,
    ),
    getShopping: () => request(`${base}/api/shopping`, undefined, shoppingOf),
    addShoppingItems: (items) => request(`${base}/api/shopping/items`, json('POST', { items }), shoppingOf),
    updateShoppingItem: (id, patch) => request(`${base}/api/shopping/items/${encodeURIComponent(id)}`, json('PATCH', patch), shoppingOf),
    removeShoppingItem: (id) => request(`${base}/api/shopping/items/${encodeURIComponent(id)}`, { method: 'DELETE' }, shoppingOf),
    finishShopping: () => request(`${base}/api/shopping/finish`, { method: 'POST' }, shoppingOf),
    setShoppingFavorite: (name, favorite) => request(`${base}/api/shopping/favorites`, json('PUT', { name, favorite }), shoppingOf),
    getPlugins: () => request(`${base}/api/plugins`, undefined, (j) => pluginsResponseSchema.parse(j).plugins as PluginInfo[]),
    setPluginSettings: (pluginId, patch: PluginSettingsPatch) => request(
      `${base}/api/plugins/${encodeURIComponent(pluginId)}`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) },
      (j) => pluginsResponseSchema.parse(j).plugins as PluginInfo[],
    ),
    getProperties: () => request(`${base}/api/properties`, undefined, (j) => propertiesResponseSchema.parse(j)),
    selectProperty: (id) => request(`${base}/api/properties/${encodeURIComponent(id)}/select`, { method: 'POST' }, () => undefined),
    createProperty: (body) => request(`${base}/api/properties`, json('POST', body), (j) => propertyCreatedSchema.parse(j).id),
    setPropertyMode: (mode) => request(`${base}/api/properties/mode`, json('POST', { mode }), () => undefined),
    duplicateProperty: (id, name) => request(`${base}/api/properties/${encodeURIComponent(id)}/duplicate`, json('POST', { name }), (j) => propertyCreatedSchema.parse(j).id),
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
    saveOrigin: (origin) => request(
      `${base}/api/house/origin`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(origin) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    pairHue: () => request(`${base}/api/plugins/hue/pair`, { method: 'POST' }, (j) => j as { appKey: string; hint: string }),
    nestAuthUrl: () => request(`${base}/api/plugins/nest/auth/url`, undefined, (j) => j as { url: string; redirectUri: string }),
    enphaseTokenStatus: () => request(`${base}/api/plugins/enphase/token`, undefined, (j) => j as EnphaseTokenStatus),
    // the body may carry a password: POST, never in the query (it would end up in the logs)
    pairEnphase: (body: EnphasePairing) => request(
      `${base}/api/plugins/enphase/token`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as EnphaseTokenStatus,
    ),
    syncEnphaseHistory: (force = false) => request(
      `${base}/api/plugins/enphase/history/sync`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ force }) },
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
    renaultContracts: (vin, lang) => request(
      `${base}/api/plugins/renault/contracts/${encodeURIComponent(vin)}?lang=${encodeURIComponent(lang)}`, undefined,
      (j) => j as { contracts: RenaultContract[] },
    ),
    melcloudStatus: () => request(`${base}/api/plugins/melcloud/status`, undefined, (j) => j as MelcloudStatus),
    melcloudLogin: (body) => request(
      `${base}/api/plugins/melcloud/login`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as MelcloudStatus,
    ),
    melcloudLogout: () => request(`${base}/api/plugins/melcloud/logout`, { method: 'POST' }, (j) => j as MelcloudStatus),
    melcloudSystem: () => request(`${base}/api/plugins/melcloud/system`, undefined, (j) => j as { units: MelcloudUnit[]; pollMs: number }),
    melcloudHistory: () => request(`${base}/api/plugins/melcloud/history`, undefined, (j) => j as { hourly: HeatingPoint[]; daily?: HeatingPoint[]; pollMs: number }),
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
        // target = this browser: the returned path is relative to the server
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
    claudeAccount: () => request(`${base}/api/plugins/claude/account`, undefined, (j) => j as ClaudeAccount),
    claudeSetToken: (token) => request(`${base}/api/plugins/claude/account`, json('PUT', { token }), (j) => j as ClaudeAccount),
    claudeClearToken: () => request(`${base}/api/plugins/claude/account`, { method: 'DELETE' }, (j) => j as ClaudeAccount),
    assistantAsk: (text, onEvent, signal) => streamLines(
      `${base}/api/assistant/ask`, { ...json('POST', { text }), ...(signal ? { signal } : {}) }, (j) => onEvent(j as AssistantEvent),
    ),
    transcriptionStatus: () => request(`${base}/api/plugins/transcription/status`, undefined, (j) => j as { ready: boolean; provider: string | null; speech: boolean; autoSend: boolean }),
    transcriptionVoices: () => request(`${base}/api/plugins/transcription/voices`, undefined, (j) => j as { voices: { id: string; name: string; language?: string }[] }),
    transcriptionSettings: () => request(`${base}/api/plugins/transcription/settings`, undefined, (j) => j as TranscriptionSettings),
    setTranscriptionVoice: (voice) => request(`${base}/api/plugins/transcription/settings`, json('PUT', { voice }), (j) => j as TranscriptionSettings),
    speak: (text, words) => requestBlob(`${base}/api/plugins/transcription/speak`, json('POST', { text, words })),
    transcribe: (audio, hints) => request(`${base}/api/plugins/transcription/transcribe`, json('POST', { audio, hints }), (j) => j as { text: string; ms: number }),
    assistantLog: () => request(`${base}/api/assistant/log`, undefined, (j) => j as { entries: AssistantLogEntry[] }),
    mcpUsers: () => request(`${base}/api/mcp/users`, undefined, (j) => j as { users: McpUser[] }),
    mcpSetUser: (name, password) => request(`${base}/api/mcp/users/${encodeURIComponent(name)}`, json('PUT', { password }), (j) => j as { users: McpUser[] }),
    mcpRemoveUser: (name) => request(`${base}/api/mcp/users/${encodeURIComponent(name)}`, { method: 'DELETE' }, (j) => j as { users: McpUser[] }),
    systemVersion: (refresh) => request(`${base}/api/system/version${refresh ? '?refresh=1' : ''}`, undefined, (j) => j as SystemVersion),
    systemUpdateStatus: () => request(`${base}/api/system/update`, undefined, (j) => j as { status: UpdateStatus | null }),
    systemUpdate: () => request(`${base}/api/system/update`, { method: 'POST' }, (j) => j as { status: UpdateStatus }),
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

/** WebSocket origin: that of `base` if given, otherwise the page itself (Vite proxy in dev). */
function wsBase(base: string): string {
  if (base) return base.replace(/^http/, 'ws')
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`
}

/** WebSocket with exponential reconnection and silent-link detection. */
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
    // IMPORTANT: process each frame in onmessage, never through a watch on a high-frequency ref
    // (a watcher coalesces and would lose intermediate messages).
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
      // A session refusal cannot be read on a WebSocket: we ask the API, which redirects to
      // the login if needed (`request`).
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
