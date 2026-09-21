import { apiErrorSchema, devicesResponseSchema, energyHistorySchema, healthResponseSchema, houseSchema, pluginsResponseSchema, scenesResponseSchema, serverMessageSchema, weatherForecastSchema, deviceJournalSchema, deviceConsumptionSchema, type CommandInput, type DeviceConsumption, type DeviceJournal, type DeviceEntry, type DevicePlacement, type EnergyHistory, type HealthResponse, type House, type PluginInfo, type PluginSceneEntry, type PluginSettingsPatch, type SceneRecallInput, type SceneUpdate, type WeatherForecast } from '@kasbah/shared'
import { parseDeviceId } from '@kasbah/shared'
import { ApiRequestError, type ConnectionStatus, type EnphasePairing, type EnphaseTokenStatus, type HeatingPoint, type IrobotStatus, type MelcloudStatus, type MelcloudUnit, type PetkitStatus, type RenaultStatus, type TeslaStatus, type Transport, type TransportHandlers, type YtmusicPlaylist, type YtmusicSearchResult, type YtmusicStatus, type YtmusicTrack } from './transport'

// URLs relatives : même origine en prod (Fastify sert le build) et via le proxy Vite en dev.

const STALE_AFTER_MS = 45_000       // aucune trame depuis 45 s → on considère le lien mort et on reconnecte
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30_000

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
    throw new ApiRequestError(res.status, code, message)
  }
  return parse(await res.json())
}

export function createHttpTransport(base = ''): Transport {
  return {
    getHouse: () => request(`${base}/api/house`, undefined, (j) => houseSchema.parse(j) as House),
    getDevices: () => request(`${base}/api/devices`, undefined, (j) => devicesResponseSchema.parse(j).devices as DeviceEntry[]),
    getHealth: () => request(`${base}/api/health`, undefined, (j) => healthResponseSchema.parse(j) as HealthResponse),
    getHistory: (deviceId, hours = 24) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/history?hours=${hours}`, undefined, (j) => energyHistorySchema.parse(j) as EnergyHistory),
    getForecast: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/forecast`, undefined, (j) => weatherForecastSchema.parse(j) as WeatherForecast),
    getJournal: (deviceId) => request(`${base}/api/devices/${encodeURIComponent(deviceId)}/journal`, undefined, (j) => deviceJournalSchema.parse(j) as DeviceJournal),
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
    ytmusicAlbum: (id) => request(
      `${base}/api/plugins/ytmusic/albums/${encodeURIComponent(id)}`, undefined,
      (j) => j as { tracks: YtmusicTrack[] },
    ),
    ytmusicArtist: (id) => request(
      `${base}/api/plugins/ytmusic/artists/${encodeURIComponent(id)}`, undefined,
      (j) => j as { tracks: YtmusicTrack[] },
    ),
    ytmusicPlay: (body) => request(
      `${base}/api/plugins/ytmusic/play`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      (j) => j as { ok: true; streamUrl: string; sid: string },
    ),
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
    ws.onclose = () => { if (staleTimer) clearTimeout(staleTimer); if (!closed) { if (status === 'online') setStatus('connecting'); scheduleReconnect() } }
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
