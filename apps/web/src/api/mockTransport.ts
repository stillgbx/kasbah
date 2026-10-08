import { applyHouseEditToJson, SurveyError, addGardenItemToJson, addOpeningToJson, addParkingToJson, patchGardenItemInJson, removeGardenItemFromJson, automationBodySchema, commandSchema, deviceClassOf, defaultState, mergeState, parseHouse, patchOpeningInJson, patchParkingInJson, placeDeviceInJson, putArrayInJson, removeArrayFromJson, removeDeviceFromJson, removeOpeningFromJson, removeParkingFromJson, setReliefInJson, setRenderTuningInJson, setTerrainInJson, setRoomOrderInJson, type Automation, type AutomationEntry, type AutomationRun, type AutomationStatus, type CommandInput, type DeviceConsumption, type DeviceEntry, type DeviceState, type House, type PluginSceneEntry, type PropertiesResponse, type SceneActivation, type StateFor, type StatePatch } from '@kasbah/shared'
import { SimError, Simulation, solarGeometry, type ScenarioName } from '@kasbah/mock-sim'
import demoHouse from '@kasbah/shared/demo-house.json'
import { createMockSchool } from './mockSchool'
import { ApiRequestError, type Transport, type TransportHandlers, type WeatherPlace } from './transport'

const MOCK_PLACES: WeatherPlace[] = [
  { id: '2988507', name: 'Paris', region: 'Île-de-France, France', countryCode: 'FR', lat: 48.85341, lon: 2.3488 },
  { id: '2995469', name: 'Marseille', region: "Provence-Alpes-Côte d'Azur, France", countryCode: 'FR', lat: 43.29695, lon: 5.38107 },
  { id: '3021372', name: 'Dijon', region: 'Bourgogne, France', countryCode: 'FR', lat: 47.31344, lon: 5.01391 },
  { id: '2643743', name: 'Londres', region: 'Angleterre, Royaume-Uni', countryCode: 'GB', lat: 51.50853, lon: -0.12574 },
]

// Transport sans serveur : la même simulation que le plugin serveur `mock`, dans l'onglet.
// Sert aux tests de composants et à une démo statique (VITE_INPROCESS_MOCK=1).

const STATUS: Record<string, number> = { UNSUPPORTED_COMMAND: 400, DEVICE_UNAVAILABLE: 503, UPSTREAM_ERROR: 502, TIMEOUT: 504 }

export interface MockTransportOptions {
  scenario?: ScenarioName
  seed?: number
  timeScale?: number
  house?: House
  /**
   * Propriétés démo entre lesquelles basculer (mode démo). Absent : la seule maison du transport,
   * sans bascule possible.
   */
  properties?: { list(): PropertiesResponse; select(id: string): void }
}

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

/**
 * Historique de luminosité plausible (courbe de soleil, nuages pseudo-aléatoires mais stables d'un
 * appel à l'autre), comme `mockConsumption` : 48 heures, 400 jours, les mois déduits des jours. Les
 * 6 dernières heures d'hier restent ABSENTES, pour voir le tiret d'un pas non mesuré.
 */
function mockLightHistory(now = Date.now()) {
  const sun = (t: number) => {
    const d = new Date(t)
    const h = d.getHours() + d.getMinutes() / 60
    const season = 0.55 + 0.45 * Math.cos((2 * Math.PI * (d.getMonth() - 5.5)) / 12)
    const cloud = 0.5 + 0.5 * Math.abs(Math.sin(Math.floor(t / DAY_MS) * 12.9898))
    return h <= 6 || h >= 20 ? 0 : Math.round(40_000 * season * cloud * Math.sin((Math.PI * (h - 6)) / 14))
  }
  const hour0 = Math.floor(now / HOUR_MS) * HOUR_MS
  const hourly = Array.from({ length: 48 }, (_, i) => hour0 - (47 - i) * HOUR_MS)
    .filter((t) => (hour0 - t) / HOUR_MS < 18 || (hour0 - t) / HOUR_MS >= 24)
    .map((t) => ({ t, maxLux: sun(t + HOUR_MS / 2) }))
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0)
  const daily = Array.from({ length: 400 }, (_, i) => {
    const d = new Date(day0); d.setDate(d.getDate() - (399 - i))
    return { t: d.getTime(), maxLux: sun(d.getTime() + 13 * HOUR_MS) }
  })
  const monthly: { t: number; maxLux: number }[] = []
  for (const p of daily) {
    const d = new Date(p.t); const m = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    const last = monthly[monthly.length - 1]
    if (last && last.t === m) last.maxLux = Math.max(last.maxLux, p.maxLux)
    else monthly.push({ t: m, maxLux: p.maxLux })
  }
  return { hourly, daily, monthly }
}

/**
 * Automatisations de démonstration du mode maquette : une horaire au soleil, une au calendrier,
 * et une qui vise un appareil que la simulation n'a pas — pour voir la pastille « incomplète ».
 */
const DEMO_AUTOMATIONS: Automation[] = [
  {
    id: 'volets-crepuscule', name: 'Volets au crépuscule', enabled: true,
    trigger: { type: 'time', at: { kind: 'sun', event: 'dusk', offsetMin: -15, notAfter: '22:00' } },
    unless: [{ type: 'anyInRoom', roomId: 'salon', kind: 'media_player' }],
    actions: [{ type: 'command', target: { type: 'selector', kind: 'cover', deviceClass: 'shutter' }, command: { type: 'cover.close' } }],
  },
  {
    id: 'portail-midi', name: 'Portail le midi', enabled: false,
    trigger: { type: 'time', at: { kind: 'clock', time: '12:00' }, days: [1, 5] },
    unless: [],
    actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:cover-gate'] }, command: { type: 'cover.open' } }],
  },
  {
    id: 'veilleuse', name: 'Veilleuse du couloir', enabled: true,
    trigger: { type: 'time', at: { kind: 'clock', time: '23:30' } },
    unless: [],
    actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['hue:veilleuse-couloir'] }, command: { type: 'light.set', on: true, brightness: 10 } }],
  },
]

/** Prochain « HH:MM » d'un déclencheur horaire à heure fixe ; le soleil n'est pas calculé en maquette. */
function mockNextRun(a: Automation, now = Date.now()): number | undefined {
  if (!a.enabled || a.trigger.type !== 'time' || a.trigger.at.kind !== 'clock') return undefined
  const [h = 0, m = 0] = a.trigger.at.time.split(':').map(Number)
  const days = a.trigger.days
  const from = new Date(now)
  for (let k = 0; k < 8; k++) {
    const t = new Date(from.getFullYear(), from.getMonth(), from.getDate() + k, h, m).getTime()
    if (t > now && (!days || days.includes(new Date(t).getDay()))) return t
  }
  return undefined
}

export function createMockTransport(opts: MockTransportOptions = {}): Transport & { sim: Simulation } {
  const sim = new Simulation({ scenario: opts.scenario ?? 'default', seed: opts.seed ?? 42, timeScale: opts.timeScale ?? 1 })
  let house = opts.house ?? parseHouse(demoHouse)
  let mcpUsers = ['parent']
  const states = new Map<string, DeviceState>()
  const descriptors = sim.devices()
  for (const d of descriptors) states.set(d.id, { ...sim.getState(d.externalId)!, updatedAt: Date.now() })

  const entries = (): DeviceEntry[] => descriptors.map((descriptor) => ({ descriptor, state: states.get(descriptor.id) ?? defaultState(descriptor.kind) }))
  let handlers: TransportHandlers | null = null

  // Automatisations en mémoire : même forme que le serveur, statut approché (appareils absents,
  // prochaine heure fixe). Chaque écriture repousse la liste, comme le message WebSocket du serveur.
  const automations = new Map(DEMO_AUTOMATIONS.map((a) => [a.id, a]))
  const lastRuns = new Map<string, AutomationRun>()
  const automationEntry = (a: Automation): AutomationEntry => {
    const ids = a.actions.flatMap((x) => (x.type === 'command' && x.target.type === 'devices' ? x.target.deviceIds : []))
    const missing = ids.filter((id) => !states.has(id)).map((id) => ({ kind: 'device' as const, id }))
    const status: AutomationStatus = { health: missing.length ? 'incomplete' : 'ok', missing, unavailableDeviceIds: [] }
    const next = mockNextRun(a)
    const last = lastRuns.get(a.id)
    if (next !== undefined) status.nextRunAt = next
    if (last) status.lastRun = last
    return { automation: a, status }
  }
  const automationList = () => [...automations.values()].map(automationEntry)
  const pushAutomations = () => handlers?.onMessage({ type: 'automations', automations: automationList() })
  const knownAutomation = (id: string) => {
    const a = automations.get(id)
    if (!a) throw new ApiRequestError(404, 'NOT_FOUND', `unknown automation "${id}"`)
    return a
  }

  // ambiances du parc simulé, présentées comme celles d'un pont (`mock:<id>`)
  const sceneEntry = (s: ReturnType<Simulation['scenes']>[number]): PluginSceneEntry => ({
    scene: { ...s, id: `mock:${s.externalId}`, pluginId: 'mock', autoDynamic: false },
    state: { active: sim.sceneState(s.externalId), updatedAt: Date.now() },
  })
  const sceneEntries = () => sim.scenes().map(sceneEntry)
  const onScene = (externalId: string, active: SceneActivation) =>
    handlers?.onMessage({ type: 'scene', sceneId: `mock:${externalId}`, state: { active, updatedAt: Date.now() } })

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
    // ailleurs : quelques villes en dur, et la météo simulée de la maison, décalée pour qu'on voie le changement
    async searchPlaces(query) {
      const q = query.trim().toLowerCase()
      return MOCK_PLACES.filter((p) => p.name.toLowerCase().startsWith(q))
    },
    async getWeatherAt(lat, lon) {
      const home = entries().find((e) => e.descriptor.kind === 'weather')
      if (!home) throw new ApiRequestError(503, 'DEVICE_UNAVAILABLE', 'no simulated weather')
      const shift = Math.round((lat - 45) / 2 - Math.abs(lon) / 20)
      const state = { ...(home.state as StateFor<'weather'>), available: true, tempC: (home.state as StateFor<'weather'>).tempC + shift }
      return { state, forecast: sim.forecast(home.descriptor.id.replace(/^mock:/, '')), attribution: 'Simulation' }
    },
    // une vigilance jaune orages jusqu'à minuit, pour voir la ligne ; rien hors de la « métropole » simulée
    async getWeatherAlerts(lat, lon) {
      const inFrance = lat > 41 && lat < 51.5 && lon > -5.5 && lon < 10
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0)
      return {
        area: inFrance ? 'Simulation' : null,
        warnings: inFrance ? [{ type: 'thunderstorm', level: 'yellow' as const, onset: midnight.getTime() - 86_400_000, expires: midnight.getTime() }] : [],
        attribution: 'Simulation', web: 'https://vigilance.meteofrance.fr/',
      }
    },
    // la simulation ne tient aucun journal : ses appareils ne déclarent pas la capacité, la vue ne demande rien
    async getJournal(deviceId) { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', `no journal in mock mode for ${deviceId}`) },
    async getReleaseNotes(deviceId, lang) {
      try { return { deviceId, ...sim.releaseNotes(deviceId.replace(/^mock:/, ''), lang) } }
      catch (err) {
        if (err instanceof SimError) throw new ApiRequestError(STATUS[err.code] ?? 500, err.code, err.message)
        throw err
      }
    },
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
    async addGardenItem(item) {
      house = parseHouse(addGardenItemToJson(house, item))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async saveGardenItem(id, patch) {
      house = parseHouse(patchGardenItemInJson(house, id, patch))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async removeGardenItem(id) {
      house = parseHouse(removeGardenItemFromJson(house, id))
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
    async saveRelief(relief) {
      house = parseHouse(setReliefInJson(house, relief))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async saveEdit(patch) {
      const r = applyHouseEditToJson(house, patch)
      if (r.blocking.length) throw new SurveyError(r.blocking.join(' ; '))
      house = parseHouse(r.doc)
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async saveTerrain(polygon) {
      house = parseHouse(setTerrainInJson(house, polygon))
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
    async lightHistory() { return mockLightHistory() },
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
    async musicPlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music cookie in mock mode') },
    // aucun flux servi par la simulation : la page Musique montre ses lecteurs, sans transfert possible
    async musicSessions() { return { sessions: [] } },
    async musicLast() { return { last: [] } },
    async musicResume() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicTransfer() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicLocalPlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueuePlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueue() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueueAdd() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueueNext() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueuePrevious() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueueJump() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueueRepeat() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicQueueRemove() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async musicProgress() {},
    async musicQueueClear() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no YouTube Music stream in mock mode') },
    async session() { return { user: null } },
    // assistant : pas de `claude` ici, une réponse de démonstration
    async claudeAccount() { return { user: null, savedAt: null, house: false } },
    async claudeSetToken() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Claude in mock mode') },
    async claudeClearToken() { return { user: null, savedAt: null, house: false } },
    async assistantAsk(_text, onEvent) {
      await new Promise((r) => setTimeout(r, 400))
      onEvent({ type: 'text', text: "Mode démo : l'assistant a besoin du serveur Kasbah." })
      onEvent({ type: 'done', ms: 400 })
    },
    async assistantLog() { return { entries: [] } },
    // pas de moteur de transcription ici : le micro ne se montre pas
    async transcriptionStatus() { return { ready: false, provider: null, speech: false } },
    async speak() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no speech in mock mode') },
    async transcriptionVoices() { return { voices: [] } },
    async transcriptionSettings() { return { voice: null, defaultVoice: null } },
    async setTranscriptionVoice(voice) { return { voice, defaultVoice: null } },
    async transcribe() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no transcription in mock mode') },
    // comptes MCP : en mémoire, un compte de démonstration
    async mcpUsers() { return { users: mcpUsers.map((name) => ({ name })) } },
    async mcpSetUser(name) {
      if (!mcpUsers.includes(name)) mcpUsers.push(name)
      return { users: mcpUsers.map((n) => ({ name: n })) }
    },
    async mcpRemoveUser(name) {
      if (!mcpUsers.includes(name)) throw new ApiRequestError(404, 'NOT_FOUND', `no MCP user "${name}"`)
      mcpUsers = mcpUsers.filter((n) => n !== name)
      return { users: mcpUsers.map((n) => ({ name: n })) }
    },
    async agendaCalendars() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no calendar in mock mode') },
    async agendaAddCalendar() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no calendar in mock mode') },
    async agendaUpdateCalendar() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no calendar in mock mode') },
    async agendaRemoveCalendar() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no calendar in mock mode') },
    async agendaReorderCalendars() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no calendar in mock mode') },
    async agendaEvents() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no calendar in mock mode') },
    ...createMockSchool(),
    async mixcloudStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudSetAccount() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudClearAccount() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudList() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudHome() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudPlaylists() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudPlaylist() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudFollowing() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudUserMixes() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudSearch() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async mixcloudForgetResume() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Mixcloud account in mock mode') },
    async radioSearch() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioTop() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioFavorites() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioAddFavorite() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioAddCustom() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioRemoveFavorite() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioPlay() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no radio directory in mock mode') },
    async radioPlaying() { return { playing: [] } },
    // la simulation déclare ses appareils, elle n'en découvre aucun : il n'y a rien à oublier
    async forgetDevice() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'nothing to forget in mock mode') },
    cameraStreamUrl() { return null },
    async cameraSnapshots() { return {} },
    async setCameraSnapshots() { /* pas de caméra en mode maquette */ },
    cameraSnapshotUrl() { return null },
    // les ambiances du parc simulé se rappellent ; elles ne se créent ni ne se réglent (pas de fabricant)
    async getScenes() { return sceneEntries() },
    async recallScene(sceneId, recall) {
      try { await sim.recallScene(sceneId.replace(/^mock:/, ''), { mode: recall.mode ?? 'static', ...(recall.brightness !== undefined ? { brightness: recall.brightness } : {}) }) }
      catch (err) {
        if (err instanceof SimError) throw new ApiRequestError(STATUS[err.code] ?? 500, err.code, err.message)
        throw err
      }
    },
    async updateScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async createScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async deleteScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async getAutomations() { return automationList() },
    async putAutomation(id, body) {
      const a: Automation = { id, ...automationBodySchema.parse(body), updatedAt: Date.now() }
      automations.set(id, a)
      pushAutomations()
      return automationEntry(a)
    },
    async setAutomationEnabled(id, enabled) {
      const a = { ...knownAutomation(id), enabled, updatedAt: Date.now() }
      automations.set(id, a)
      pushAutomations()
      return automationEntry(a)
    },
    async deleteAutomation(id) {
      knownAutomation(id)
      automations.delete(id)
      lastRuns.delete(id)
      pushAutomations()
    },
    // Exécute pour de vrai sur la simulation (les volets se ferment dans la 3D) ; une sélection
    // se résout ici sur le kind et la nature seulement, sans pièces ni exceptions.
    async runAutomation(id) {
      const a = knownAutomation(id)
      const errors: AutomationRun['errors'] = []
      for (const [i, action] of a.actions.entries()) {
        if (action.type !== 'command') { errors.push({ action: i, code: 'NOT_IMPLEMENTED', message: 'no vendor scenes in mock mode' }); continue }
        const t = action.target
        const ids = t.type === 'devices' ? t.deviceIds
          : descriptors.filter((d) => d.kind === t.kind && (!t.deviceClass || deviceClassOf(d) === t.deviceClass)).map((d) => d.id)
        for (const deviceId of ids) {
          try { await this.sendCommand(deviceId, action.command) }
          catch (err) { errors.push({ action: i, deviceId, code: err instanceof ApiRequestError ? err.code : 'INTERNAL', message: (err as Error).message }) }
        }
      }
      const run: AutomationRun = { at: Date.now(), by: 'manual', outcome: errors.length ? 'partial' : 'ok', errors }
      lastRuns.set(id, run)
      pushAutomations()
      return run
    },
    // maquette in-process : la simulation tourne dans la page, il n'y a pas de serveur à régler
    async getPlugins() { return [] },
    async setPluginSettings() { return [] },
    async getProperties() {
      return opts.properties?.list() ?? { activeId: house.id, switchable: false, properties: [{ id: house.id, name: house.name, kind: 'house' }] }
    },
    async selectProperty(id) {
      if (!opts.properties) throw new ApiRequestError(409, 'NOT_SWITCHABLE', 'no other property in this mode')
      if (!opts.properties.list().properties.some((p) => p.id === id)) throw new ApiRequestError(404, 'NOT_FOUND', `unknown property "${id}"`)
      opts.properties.select(id)
    },
    connect(h) {
      handlers = h
      h.onStatus('connecting')
      sim.start(
        apply,
        (externalId, available) => apply(externalId, { available }),
        (externalId, event) => handlers?.onMessage({ type: 'deviceEvent', deviceId: `mock:${externalId}`, event, at: Date.now() }),
        onScene,
      )
      h.onMessage({ type: 'snapshot', serverTime: Date.now(), devices: entries(), scenes: sceneEntries(), automations: automationList(), propertyId: house.id })
      h.onStatus('online')
      return () => { sim.stop(); handlers = null }
    },
  }
}
