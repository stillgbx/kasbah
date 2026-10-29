import { addShoppingItems, clearCheckedShoppingItems, EMPTY_SHOPPING_LIST, removeShoppingItem, setShoppingFavorite, shoppingAddBodySchema, shoppingItemPatchSchema, updateShoppingItem, type ShoppingList, applyHouseEditToJson, SurveyError, addGardenItemToJson, addOpeningToJson, addParkingToJson, patchGardenItemInJson, removeGardenItemFromJson, automationBodySchema, commandSchema, deviceClassOf, defaultState, mergeState, parseHouse, patchOpeningInJson, patchParkingInJson, placeDeviceInJson, putArrayInJson, removeArrayFromJson, removeDeviceFromJson, removeOpeningFromJson, removeParkingFromJson, setReliefInJson, setRenderTuningInJson, setOriginInJson, setTerrainInJson, setRoomOrderInJson, type Automation, type AutomationEntry, type AutomationRun, type AutomationStatus, type CommandInput, type DeviceConsumption, type DeviceEntry, type DeviceState, type House, type PluginSceneEntry, type PropertiesResponse, type SceneActivation, type StateFor, type StatePatch } from '@kasbah/shared'
import { SimError, Simulation, solarGeometry, type ScenarioName } from '@kasbah/mock-sim'
import demoHouse from '@kasbah/shared/demo-house.json'
import { createMockSchool } from './mockSchool'
import { DEMO_ONLY_MIC, DEMO_REQUESTS, demoClipOf, demoLang, demoPlan, demoRequestOf, demoTranscript, type DemoLang, type DemoRequestId } from './demoAssistant'
import { ApiRequestError, type Transport, type TransportHandlers, type WeatherPlace } from './transport'

const MOCK_PLACES: WeatherPlace[] = [
  { id: '2988507', name: 'Paris', region: 'Île-de-France, France', countryCode: 'FR', lat: 48.85341, lon: 2.3488 },
  { id: '2995469', name: 'Marseille', region: "Provence-Alpes-Côte d'Azur, France", countryCode: 'FR', lat: 43.29695, lon: 5.38107 },
  { id: '3021372', name: 'Dijon', region: 'Bourgogne, France', countryCode: 'FR', lat: 47.31344, lon: 5.01391 },
  { id: '2643743', name: 'Londres', region: 'Angleterre, Royaume-Uni', countryCode: 'GB', lat: 51.50853, lon: -0.12574 },
]

// Serverless transport: the same simulation as the server `mock` plugin, in the tab.
// Used for component tests and a static demo (VITE_INPROCESS_MOCK=1).

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A recording of the demo assistant, beside the demo build (`voice/`, copied by `vite.config.ts`). */
const demoClipUrl = (id: DemoRequestId, lang: DemoLang) => `${import.meta.env.BASE_URL}voice/${id}.${lang}.mp3`

const STATUS: Record<string, number> ={ UNSUPPORTED_COMMAND: 400, DEVICE_UNAVAILABLE: 503, UPSTREAM_ERROR: 502, TIMEOUT: 504 }

export interface MockTransportOptions {
  scenario?: ScenarioName
  seed?: number
  timeScale?: number
  house?: House
  /**
   * Demo properties to switch between (demo mode). Absent: the transport's only house,
   * with no switching possible.
   */
  properties?: { list(): PropertiesResponse; select(id: string): void }
  /**
   * The demo's microphone and assistant (`demoAssistant.ts`): three sample requests that act on the
   * simulation, answered aloud from recordings. Absent: no microphone, a fixed reply.
   */
  demoAssistant?: boolean
}

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * Plausible household flow, 24 values (L/hour): zero at night, breakfast and evening peaks —
 * same orders of magnitude as the real COMAP station (`journal.md` of 2026-09-16: 90-400 L/day).
 */
const HOURLY_PROFILE_L = [0, 0, 0, 0, 0, 0, 4, 18, 26, 10, 3, 2, 8, 4, 0, 0, 2, 4, 10, 22, 30, 14, 4, 0]

/** Varies the day's total between ~90 and ~400 L without breaking the hourly profile. */
const dayMultiplier = (dayIndex: number): number => 1.5 + 0.9 * Math.sin(dayIndex * 0.9)

const hourlyLitres = (hourStart: number): number =>
  Math.round(HOURLY_PROFILE_L[new Date(hourStart).getHours()]! * dayMultiplier(Math.floor(hourStart / DAY_MS)))

const dailyLitres = (dayStart: number): number => {
  let sum = 0
  for (let h = 0; h < 24; h++) sum += hourlyLitres(dayStart + h * HOUR_MS)
  return sum
}

/**
 * Plausible consumption history, fabricated on the fly (no real memory on the in-process mock
 * side, like `getHistory`): 72 hours, 60 days, 15 months, all measured — used to see the
 * full chart; the "history that starts" case is checked on the component side (no point).
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
 * Plausible brightness history (sun curve, pseudo-random clouds but stable from one call
 * to the next), like `mockConsumption`: 48 hours, 400 days, the months derived from the days. The
 * last 6 hours of yesterday stay ABSENT, to see the dash of an unmeasured step.
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
 * Demonstration automations of mock mode: one on a sun schedule, one on the calendar,
 * and one that targets a device the simulation does not have — to see the "Incomplete" pill.
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

/** Next "HH:MM" of a fixed-time schedule trigger; the sun is not computed in mock mode. */
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

  // In-memory automations: same shape as the server, approximate status (missing devices,
  // next fixed time). Each write pushes the list again, like the server's WebSocket message.
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

  // In-memory shopping list, through the same operations as the server; a few regulars so
  // the demo does not open on an empty page.
  let shopping: ShoppingList = ['Lait', 'Pain', 'Café', 'Pommes', 'Œufs', 'Beurre']
    .reduce((l, name) => setShoppingFavorite(l, name, true, 0), addShoppingItems(EMPTY_SHOPPING_LIST, [{ name: 'Lait', quantity: 2 }, { name: 'Pain' }, { name: 'Tomates' }], 0))
  const writeShopping = (next: ShoppingList | null, id?: string) => {
    if (!next) throw new ApiRequestError(404, 'NOT_FOUND', `unknown shopping item "${id}"`)
    shopping = next
    handlers?.onMessage({ type: 'shopping', shopping })
    return shopping
  }

  // light scenes of the simulated device set, presented as those of a bridge (`mock:<id>`)
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
      // plausible curve of the hours elapsed in the day (no real memory on the in-process mock side)
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
    // elsewhere: a few hard-coded cities, and the house's simulated weather, shifted so the change shows
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
    // a yellow thunderstorm warning until midnight, to see the line; nothing outside the simulated "metropolitan area"
    async getWeatherAlerts(lat, lon) {
      const inFrance = lat > 41 && lat < 51.5 && lon > -5.5 && lon < 10
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0)
      return {
        area: inFrance ? 'Simulation' : null,
        warnings: inFrance ? [{ type: 'thunderstorm', level: 'yellow' as const, onset: midnight.getTime() - 86_400_000, expires: midnight.getTime() }] : [],
        attribution: 'Simulation', web: 'https://vigilance.meteofrance.fr/',
      }
    },
    // the simulation keeps no log: its devices do not declare the capability, the view asks for nothing
    async getJournal(deviceId) { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', `no journal in mock mode for ${deviceId}`) },
    async getSiteMap(deviceId) {
      try { return { deviceId, ...sim.siteMap(deviceId.replace(/^mock:/, '')) } }
      catch (err) {
        if (err instanceof SimError) throw new ApiRequestError(STATUS[err.code] ?? 500, err.code, err.message)
        throw err
      }
    },
    async getReleaseNotes(deviceId, lang) {
      try { return { deviceId, ...sim.releaseNotes(deviceId.replace(/^mock:/, ''), lang) } }
      catch (err) {
        if (err instanceof SimError) throw new ApiRequestError(STATUS[err.code] ?? 500, err.code, err.message)
        throw err
      }
    },
    async getConsumption(deviceId) { return mockConsumption(deviceId) },
    async getEnergyDays(deviceId) {
      try { return { deviceId, ...sim.energyDays(deviceId.replace(/^mock:/, '')) } }
      catch (err) {
        if (err instanceof SimError) throw new ApiRequestError(STATUS[err.code] ?? 500, err.code, err.message)
        throw err
      }
    },
    async placeDevice(id, placement) {
      // same logic as the server, in memory (nothing is written); the `house` message follows as in real life
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
    async saveOrigin(origin) {
      house = parseHouse(setOriginInJson(house, origin))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async pairHue() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Hue bridge in mock mode') },
    async nestAuthUrl() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Google account in mock mode') },
    async enphaseTokenStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no IQ Gateway in mock mode') },
    async pairEnphase() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no IQ Gateway in mock mode') },
    async syncEnphaseHistory() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no IQ Gateway in mock mode') },
    async teslaStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async teslaRegister() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async teslaAuthUrl() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async teslaRotateKey() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Tesla account in mock mode') },
    async renaultStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Renault account in mock mode') },
    async renaultLogin() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Renault account in mock mode') },
    async renaultLogout() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Renault account in mock mode') },
    // a sample contract: enough to see the proposal in the "Edit" panel without a real account
    async renaultContracts() {
      return { contracts: [{ description: 'EASYPACK 49MOIS EXEMPLE', start: '2025-03-01', end: '2029-03-31', maxKm: 40000 }] }
    },
    async melcloudStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no MELCloud account in mock mode') },
    async melcloudLogin() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no MELCloud account in mock mode') },
    async melcloudLogout() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no MELCloud account in mock mode') },
    async petkitStatus() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async petkitRequestCode() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async petkitLogin() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async petkitLogout() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no PetKit account in mock mode') },
    async melcloudSystem() { return { units: [], pollMs: 0 } },
    async melcloudHistory() { return { hourly: [], daily: [], pollMs: 0 } },
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
    // no stream served by the simulation: the Music page shows its players, without transfer possible
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
    // assistant: no `claude` here, a demonstration reply
    async claudeAccount() { return { user: null, savedAt: null, house: false } },
    async claudeSetToken() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Claude in mock mode') },
    async claudeClearToken() { return { user: null, savedAt: null, house: false } },
    async assistantAsk(text, onEvent) {
      const t0 = Date.now()
      await wait(400)
      const request = opts.demoAssistant ? demoRequestOf(text) : null
      if (!opts.demoAssistant) onEvent({ type: 'text', text: "Mode démo : l'assistant a besoin du serveur Kasbah." })
      else if (!request) onEvent({ type: 'text', text: DEMO_ONLY_MIC[demoLang()] })
      else {
        // the tool lines of a real run: the devices read, then one command each
        onEvent({ type: 'tool', id: 'demo-list', name: 'list_devices', input: {} })
        onEvent({ type: 'tool_result', id: 'demo-list', ok: true })
        for (const [i, step] of demoPlan(request.id, house, entries()).entries()) {
          await wait(150)
          onEvent({ type: 'tool', id: `demo-${i}`, name: 'send_command', input: step })
          let ok = true
          try { await sim.execute(step.deviceId.replace(/^mock:/, ''), commandSchema.parse(step.command)) } catch { ok = false }
          onEvent({ type: 'tool_result', id: `demo-${i}`, ok })
        }
        onEvent({ type: 'text', text: DEMO_REQUESTS[request.id][request.lang].answer })
      }
      onEvent({ type: 'done', ms: Date.now() - t0 })
    },
    async assistantLog() { return { entries: [] } },
    // no transcription engine here: the microphone is only shown for the demo's sample requests, which
    // speak when their recordings were built with the demo (an HTML fallback is not one)
    async transcriptionStatus() {
      if (!opts.demoAssistant) return { ready: false, provider: null, speech: false, autoSend: false }
      const speech = await fetch(demoClipUrl('lights', 'en'), { method: 'HEAD' })
        .then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('audio/'), () => false)
      return { ready: true, provider: 'demo', speech, autoSend: true }
    },
    async speak(text) {
      const clip = opts.demoAssistant ? demoClipOf(text) : null
      if (!clip) throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no speech in mock mode')
      const r = await fetch(demoClipUrl(clip.id, clip.lang))
      if (!r.ok) throw new ApiRequestError(r.status, 'NOT_FOUND', `no recording for "${clip.id}"`)
      return r.blob()
    },
    async transcriptionVoices() { return { voices: [] } },
    async transcriptionSettings() { return { user: null, voice: null, houseVoice: null, defaultVoice: null } },
    async setTranscriptionVoice(voice) { return { user: null, voice, houseVoice: voice, defaultVoice: null } },
    // the demo hears nothing: the recording is dropped and replaced by a sample request
    async transcribe() {
      if (!opts.demoAssistant) throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no transcription in mock mode')
      return { text: demoTranscript(demoLang()), ms: 0 }
    },
    // MCP accounts: in memory, a demonstration account
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
    // demonstration: no repository behind it, hence no supervisor
    async systemVersion() { return { supervised: false, running: { sha: '0000000000000000000000000000000000000000', subject: 'Démonstration', date: new Date(0).toISOString() }, available: [], error: null } },
    async systemUpdateStatus() { return { status: null } },
    async systemUpdate() { throw new ApiRequestError(409, 'NOT_SUPERVISED', 'no supervisor in mock mode') },
    // no server, hence no push service to subscribe to
    async pushKey() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no push notifications in mock mode') },
    async pushSubscribe() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no push notifications in mock mode') },
    async pushUnsubscribe() {},
    async pushTest() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no push notifications in mock mode') },
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
    // the simulation declares its devices, it discovers none: there is nothing to forget
    async forgetDevice() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'nothing to forget in mock mode') },
    cameraStreamUrl() { return null },
    async cameraSnapshots() { return {} },
    async setCameraSnapshots() { /* no camera in mock mode */ },
    cameraSnapshotUrl() { return null },
    // the simulated device set's light scenes can be recalled; they cannot be created or adjusted (no vendor)
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
    async getShopping() { return shopping },
    async addShoppingItems(items) { return writeShopping(addShoppingItems(shopping, shoppingAddBodySchema.parse({ items }).items, Date.now())) },
    async updateShoppingItem(id, patch) { return writeShopping(updateShoppingItem(shopping, id, shoppingItemPatchSchema.parse(patch)), id) },
    async removeShoppingItem(id) { return writeShopping(removeShoppingItem(shopping, id), id) },
    async finishShopping() { return writeShopping(clearCheckedShoppingItems(shopping)) },
    async setShoppingFavorite(name, favorite) { return writeShopping(setShoppingFavorite(shopping, name, favorite, Date.now())) },
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
    async setAutomationOrder(ids) {
      const ordered = [...ids.flatMap((id) => automations.get(id) ?? []), ...[...automations.values()].filter((a) => !ids.includes(a.id))]
      automations.clear()
      for (const a of ordered) automations.set(a.id, a)
      pushAutomations()
      return automationList()
    },
    // Runs for real on the simulation (the shutters close in the 3D); a selection
    // is resolved here on kind and nature only, with no rooms or exceptions.
    async runAutomation(id) {
      const a = knownAutomation(id)
      const errors: AutomationRun['errors'] = []
      for (const [i, action] of a.actions.entries()) {
        if (action.type !== 'command') {
          errors.push({ action: i, code: 'NOT_IMPLEMENTED', message: action.type === 'notify' ? 'no push notifications in mock mode' : 'no vendor scenes in mock mode' })
          continue
        }
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
    // in-process mock: the simulation runs in the page, there is no server to configure
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
    // in-process mock: no file to write a property to
    async createProperty() { throw new ApiRequestError(409, 'NOT_SWITCHABLE', 'no server to create a property in this mode') },
    async duplicateProperty() { throw new ApiRequestError(409, 'NOT_SWITCHABLE', 'no server to create a property in this mode') },
    async setPropertyMode() { throw new ApiRequestError(409, 'NOT_SWITCHABLE', 'no other mode in this mode') },
    connect(h) {
      handlers = h
      h.onStatus('connecting')
      sim.start(
        apply,
        (externalId, available) => apply(externalId, { available }),
        (externalId, event) => handlers?.onMessage({ type: 'deviceEvent', deviceId: `mock:${externalId}`, event, at: Date.now() }),
        onScene,
      )
      h.onMessage({ type: 'snapshot', serverTime: Date.now(), devices: entries(), scenes: sceneEntries(), automations: automationList(), shopping, propertyId: house.id })
      h.onStatus('online')
      return () => { sim.stop(); handlers = null }
    },
  }
}
