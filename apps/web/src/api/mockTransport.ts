import { addOpeningToJson, addParkingToJson, commandSchema, defaultState, mergeState, parseHouse, patchOpeningInJson, patchParkingInJson, placeDeviceInJson, putArrayInJson, removeArrayFromJson, removeDeviceFromJson, removeOpeningFromJson, removeParkingFromJson, setRenderTuningInJson, setRoomOrderInJson, type CommandInput, type DeviceConsumption, type DeviceEntry, type DeviceState, type House, type StatePatch } from '@kasbah/shared'
import { SimError, Simulation, solarGeometry, type ScenarioName } from '@kasbah/mock-sim'
import demoHouse from '@kasbah/shared/demo-house.json'
import { ApiRequestError, type Transport, type TransportHandlers } from './transport'

// Transport sans serveur : la même simulation que le plugin serveur `mock`, dans l'onglet.
// Sert aux tests de composants et à une démo statique (VITE_INPROCESS_MOCK=1).

const STATUS: Record<string, number> = { UNSUPPORTED_COMMAND: 400, DEVICE_UNAVAILABLE: 503, UPSTREAM_ERROR: 502, TIMEOUT: 504 }

export interface MockTransportOptions { scenario?: ScenarioName; seed?: number; timeScale?: number; house?: House }

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * Débit domestique plausible, 24 valeurs (L/heure) : nuit à zéro, pointes petit-déjeuner et soir —
 * mêmes ordres de grandeur que la vraie station COMAP (`journal.md` du 2026-09-16 : 90-400 L/jour).
 */
const HOURLY_PROFILE_L = [0, 0, 0, 0, 0, 0, 4, 18, 26, 10, 3, 2, 8, 4, 0, 0, 2, 4, 10, 22, 30, 14, 4, 0]

/** Fait varier le total du jour entre ~90 et ~400 L sans casser le profil horaire. */
const dayMultiplier = (dayIndex: number): number => 1.5 + 0.9 * Math.sin(dayIndex * 0.9)

const hourlyLitres = (hourStart: number): number =>
  Math.round(HOURLY_PROFILE_L[new Date(hourStart).getHours()]! * dayMultiplier(Math.floor(hourStart / DAY_MS)))

const dailyLitres = (dayStart: number): number => {
  let sum = 0
  for (let h = 0; h < 24; h++) sum += hourlyLitres(dayStart + h * HOUR_MS)
  return sum
}

/**
 * Historique de consommation plausible, fabriqué à la volée (pas de vraie mémoire côté mock
 * in-process, comme `getHistory`) : 72 heures, 60 jours, 15 mois, tous mesurés — sert à voir le
 * graphique plein ; le cas « historique qui démarre » se vérifie côté composant (aucun point).
 */
function mockConsumption(deviceId: string, now = Date.now()): DeviceConsumption {
  const hourStart0 = Math.floor(now / HOUR_MS) * HOUR_MS
  const hourly = Array.from({ length: 72 }, (_, i) => { const t = hourStart0 - (71 - i) * HOUR_MS; return { t, litres: hourlyLitres(t) } })

  const dayStart0 = new Date(now); dayStart0.setHours(0, 0, 0, 0)
  const daily = Array.from({ length: 60 }, (_, i) => { const t = dayStart0.getTime() - (59 - i) * DAY_MS; return { t, litres: dailyLitres(t) } })

  const monthStart0 = new Date(now); monthStart0.setDate(1); monthStart0.setHours(0, 0, 0, 0)
  const monthly = Array.from({ length: 15 }, (_, i) => {
    const d = new Date(monthStart0); d.setMonth(d.getMonth() - (14 - i))
    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    let litres = 0
    for (let day = 0; day < daysInMonth; day++) litres += dailyLitres(new Date(d.getFullYear(), d.getMonth(), 1 + day).getTime())
    return { t: d.getTime(), litres }
  })

  return { deviceId, hourly, daily, monthly }
}

export function createMockTransport(opts: MockTransportOptions = {}): Transport & { sim: Simulation } {
  const sim = new Simulation({ scenario: opts.scenario ?? 'default', seed: opts.seed ?? 42, timeScale: opts.timeScale ?? 1 })
  let house = opts.house ?? parseHouse(demoHouse)
  const states = new Map<string, DeviceState>()
  const descriptors = sim.devices()
  for (const d of descriptors) states.set(d.id, { ...sim.getState(d.externalId)!, updatedAt: Date.now() })

  const entries = (): DeviceEntry[] => descriptors.map((descriptor) => ({ descriptor, state: states.get(descriptor.id) ?? defaultState(descriptor.kind) }))
  let handlers: TransportHandlers | null = null

  const apply = (externalId: string, patch: StatePatch) => {
    const id = `mock:${externalId}`
    const prev = states.get(id)
    if (!prev) return
    const next = mergeState(prev, patch as StatePatch<typeof prev.kind>, Date.now())
    if (next === prev) return
    states.set(id, next)
    handlers?.onMessage({ type: 'state', deviceId: id, state: next })
  }

  return {
    sim,
    async getHouse() { return house },
    async getDevices() { return entries() },
    async getHealth() {
      return { ok: true, uptimeS: 0, clients: 1, plugins: { mock: { status: 'ok', detail: 'in-process', deviceCount: descriptors.length } } }
    },
    async sendCommand(deviceId, command: CommandInput) {
      const cmd = commandSchema.parse(command)
      try { await sim.execute(deviceId.replace(/^mock:/, ''), cmd) }
      catch (err) {
        if (err instanceof SimError) throw new ApiRequestError(STATUS[err.code] ?? 500, err.code, err.message)
        throw err
      }
    },
    async getHistory(deviceId, hours = 24) {
      // courbe plausible des heures écoulées de la journée (pas de vraie mémoire côté mock in-process)
      const now = Date.now()
      const hourStart = Math.floor(now / 3_600_000) * 3_600_000
      const points = []
      for (let i = hours - 1; i >= 0; i--) {
        const t = hourStart - i * 3_600_000
        const h = new Date(t).getHours() + 0.5
        const productionW = Math.round(6000 * solarGeometry(h) * 0.85)
        points.push({ t, productionW, consumptionW: 350 + Math.round(600 * Math.abs(Math.sin(h / 3))), gridW: 0, samples: 1 })
      }
      return { deviceId, points }
    },
    async getForecast(deviceId) {
      try { return { deviceId, ...sim.forecast(deviceId.replace(/^mock:/, '')) } }
      catch (err) {
        if (err instanceof SimError) throw new ApiRequestError(STATUS[err.code] ?? 500, err.code, err.message)
        throw err
      }
    },
    // la simulation ne tient aucun journal : ses appareils ne déclarent pas la capacité, la vue ne demande rien
    async getJournal(deviceId) { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', `no journal in mock mode for ${deviceId}`) },
    async getConsumption(deviceId) { return mockConsumption(deviceId) },
    async placeDevice(id, placement) {
      // même logique que le serveur, en mémoire (rien n'est écrit) ; le message `house` suit comme en réel
      house = parseHouse(placeDeviceInJson(house, id, placement))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async removeDevice(id) {
      house = parseHouse(removeDeviceFromJson(house, id))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async saveArray(id, patch) {
      house = parseHouse(putArrayInJson(house, id, patch))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async removeArray(id) {
      house = parseHouse(removeArrayFromJson(house, id))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async saveOpening(roomId, openingId, patch) {
      house = parseHouse(patchOpeningInJson(house, roomId, openingId, patch))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async addOpening(roomId, opening) {
      house = parseHouse(addOpeningToJson(house, roomId, opening))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async addParking(parking) {
      house = parseHouse(addParkingToJson(house, parking))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async saveParking(id, patch) {
      house = parseHouse(patchParkingInJson(house, id, patch))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async removeParking(id) {
      house = parseHouse(removeParkingFromJson(house, id))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async removeOpening(roomId, openingId) {
      house = parseHouse(removeOpeningFromJson(house, roomId, openingId))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async setRoomOrder(levelId, roomIds) {
      house = parseHouse(setRoomOrderInJson(house, levelId, roomIds))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async saveRenderTuning(tuning) {
      house = parseHouse(setRenderTuningInJson(house, tuning))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async pairHue() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Hue bridge in mock mode') },
    async nestAuthUrl() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Google account in mock mode') },
    async enphaseTokenStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no IQ Gateway in mock mode') },
    async pairEnphase() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no IQ Gateway in mock mode') },
    async teslaStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async teslaRegister() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async teslaAuthUrl() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async teslaRotateKey() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async renaultStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Renault account in mock mode') },
    async renaultLogin() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Renault account in mock mode') },
    async renaultLogout() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Renault account in mock mode') },
    async melcloudStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no MELCloud account in mock mode') },
    async melcloudLogin() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no MELCloud account in mock mode') },
    async melcloudLogout() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no MELCloud account in mock mode') },
    async petkitStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async petkitRequestCode() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async petkitLogin() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async petkitLogout() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async melcloudSystem() { return { units: [], pollMs: 0 } },
    async melcloudHistory() { return { hourly: [], pollMs: 0 } },
    async irobotStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no iRobot account in mock mode') },
    async irobotLogin() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no iRobot account in mock mode') },
    async irobotLogout() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no iRobot account in mock mode') },
    async ytmusicStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicPutCookie() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicImportCookieFromBrowser() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicClearCookie() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicSearch() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicLiked() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicPlaylists() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicPlaylist() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicAlbum() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicArtist() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicExplore() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicExploreCategory() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicExploreNew() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicExploreCovers() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    async ytmusicPlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    // aucun flux servi par la simulation : la page Musique montre ses lecteurs, sans transfert possible
    async ytmusicSessions() { return { sessions: [] } },
    async ytmusicTransfer() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicLocalPlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueuePlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueue() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueueAdd() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueueNext() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueuePrevious() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueueJump() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueueRepeat() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueueRemove() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async ytmusicQueueClear() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async radioSearch() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioTop() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioFavorites() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioAddFavorite() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioAddCustom() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioRemoveFavorite() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioPlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    // la simulation déclare ses appareils, elle n'en découvre aucun : il n'y a rien à oublier
    async forgetDevice() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'nothing to forget in mock mode') },
    cameraStreamUrl() { return null },
    async cameraSnapshots() { return {} },
    async setCameraSnapshots() { /* pas de caméra en mode maquette */ },
    cameraSnapshotUrl() { return null },
    // la simulation n'a pas de fabricant, donc pas de scènes de fabricant
    async getScenes() { return [] },
    async recallScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async updateScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async createScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async deleteScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    // maquette in-process : la simulation tourne dans la page, il n'y a pas de serveur à régler
    async getPlugins() { return [] },
    async setPluginSettings() { return [] },
    connect(h) {
      handlers = h
      h.onStatus('connecting')
      sim.start(apply, (externalId, available) => apply(externalId, { available }))
      h.onMessage({ type: 'snapshot', serverTime: Date.now(), devices: entries(), scenes: [] })
      h.onStatus('online')
      return () => { sim.stop(); handlers = null }
    },
  }
}
