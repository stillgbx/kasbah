import { apiErrorSchema, devicesResponseSchema, energyHistorySchema, healthResponseSchema, houseSchema, pluginSettingsResponseSchema, pluginSettingsSchema, scenesResponseSchema, serverMessageSchema, type CommandInput, type DeviceEntry, type DevicePlacement, type EnergyHistory, type HealthResponse, type House, type PluginSceneEntry, type PluginSettings, type SceneRecallInput, type SceneUpdate } from '@kasbah/shared'
import { parseDeviceId } from '@kasbah/shared'
import { ApiRequestError, type ConnectionStatus, type Transport, type TransportHandlers } from './transport'

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
    getPluginSettings: () => request(`${base}/api/plugins/settings`, undefined, (j) => pluginSettingsResponseSchema.parse(j).settings as Record<string, PluginSettings>),
    setPluginSettings: (pluginId, settings: PluginSettings) => request(
      `${base}/api/plugins/${encodeURIComponent(pluginId)}/settings`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings) },
      (j) => pluginSettingsSchema.parse((j as { settings: unknown }).settings) as PluginSettings,
    ),
    placeDevice: (id, placement: DevicePlacement) => request(
      `${base}/api/house/devices/${encodeURIComponent(id)}`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(placement) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    setRoomOrder: (levelId, roomIds) => request(
      `${base}/api/house/levels/${encodeURIComponent(levelId)}/room-order`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ roomIds }) },
      (j) => houseSchema.parse((j as { house: unknown }).house) as House,
    ),
    pairHue: () => request(`${base}/api/plugins/hue/pair`, { method: 'POST' }, (j) => j as { appKey: string; hint: string }),
    nestAuthUrl: () => request(`${base}/api/plugins/nest/auth/url`, undefined, (j) => j as { url: string; redirectUri: string }),
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
