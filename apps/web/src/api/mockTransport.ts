import { commandSchema, defaultState, mergeState, parseHouse, placeDeviceInJson, type CommandInput, type DeviceEntry, type DeviceState, type House, type StatePatch } from '@kasbah/shared'
import { SimError, Simulation, solarGeometry, type ScenarioName } from '@kasbah/mock-sim'
import demoHouse from '@kasbah/shared/demo-house.json'
import { ApiRequestError, type Transport, type TransportHandlers } from './transport'

// Transport sans serveur : la même simulation que le plugin serveur `mock`, dans l'onglet.
// Sert aux tests de composants et à une démo statique (VITE_INPROCESS_MOCK=1).

const STATUS: Record<string, number> = { UNSUPPORTED_COMMAND: 400, DEVICE_UNAVAILABLE: 503, UPSTREAM_ERROR: 502, TIMEOUT: 504 }

export interface MockTransportOptions { scenario?: ScenarioName; seed?: number; timeScale?: number; house?: House }

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
    async placeDevice(id, placement) {
      // même logique que le serveur, en mémoire (rien n'est écrit) ; le message `house` suit comme en réel
      house = parseHouse(placeDeviceInJson(house, id, placement))
      handlers?.onMessage({ type: 'house', house })
      return house
    },
    async pairHue() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no Hue bridge in mock mode') },
    // la simulation n'a pas de fabricant, donc pas de scènes de fabricant
    async getScenes() { return [] },
    async recallScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async updateScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async createScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async deleteScene() { throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'no vendor scenes in mock mode') },
    async getPluginSettings() { return {} },
    async setPluginSettings(_pluginId, settings) { return settings },
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
