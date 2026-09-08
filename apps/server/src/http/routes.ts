import { assertCommandAllowed, commandSchema, devicePlacementSchema, placeDeviceInJson, pluginSettingsSchema, sceneRecallSchema, sceneUpdateSchema, type HealthResponse } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { updateHouseFile, type LoadedHouse } from '../config/house'
import type { PluginHost } from '../core/plugin-host'
import type { DeviceRegistry } from '../core/registry'
import type { EnergyHistory } from '../core/history'
import type { PluginSettingsStore } from '../core/plugin-settings'
import type { SceneRegistry } from '../core/scene-registry'
import type { WsHub } from '../ws/hub'
import { describeError, sendError } from './errors'

export interface RoutesDeps {
  registry: DeviceRegistry
  scenes: SceneRegistry
  settings: PluginSettingsStore
  host: PluginHost
  house: LoadedHouse
  hub: WsHub
  history: EnergyHistory
  startedAt: number
}

// REST : lecture (maison, appareils, santé) + commandes. L'état résultant d'une commande n'est
// PAS renvoyé dans la réponse : il arrive par le WebSocket comme tout autre changement (un seul chemin).

export function registerRoutes(app: FastifyInstance, deps: RoutesDeps): void {
  app.setErrorHandler((err, _req, reply) => {
    const d = describeError(err)
    if (d.status >= 500) app.log.error({ err }, 'unhandled route error')
    return sendError(reply, d.status, d.code, d.message)
  })

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    ok: true,
    uptimeS: Math.round((Date.now() - deps.startedAt) / 1000),
    clients: deps.hub.clientCount,
    plugins: deps.host.health(),
  }))

  app.get('/api/house', async (_req, reply) => {
    reply.header('cache-control', 'no-cache')
    return deps.house.house
  })

  app.get('/api/house/warnings', async () => ({ warnings: deps.house.warnings }))

  // Placement d'un appareil depuis l'UI : réécrit house.json (voir config/house.ts) et diffuse la
  // maison entière aux tablettes connectées. Seule écriture du serveur dans le JSON.
  app.put<{ Params: { id: string } }>('/api/house/devices/:id', async (req) => {
    const placement = devicePlacementSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => placeDeviceInJson(doc, req.params.id, placement))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  app.get('/api/devices', async () => ({ devices: deps.registry.list() }))

  app.get<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    return entry
  })

  app.get<{ Params: { id: string }; Querystring: { hours?: string } }>('/api/devices/:id/history', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    const hours = Math.min(48, Math.max(1, Number(req.query.hours ?? 24) || 24))
    return { deviceId: entry.descriptor.id, points: deps.history.points(entry.descriptor.id, hours) }
  })

  // Scènes des fabricants : lecture, puis rappel. Comme pour les commandes, l'état résultant
  // (quelle scène est active) arrive par le WebSocket, pas dans la réponse.
  app.get('/api/scenes', async () => ({ scenes: deps.scenes.list() }))

  app.post<{ Params: { id: string } }>('/api/scenes/:id/recall', async (req, reply) => {
    const entry = deps.scenes.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown scene "${req.params.id}"`)
    const recall = sceneRecallSchema.parse(req.body ?? {})
    if (recall.mode === 'dynamic' && !entry.scene.dynamic) {
      return sendError(reply, 400, 'UNSUPPORTED_COMMAND', `scene "${entry.scene.name}" has no animated palette`)
    }
    await deps.host.recallScene(entry.scene.id, recall)
    return { ok: true as const }
  })

  // Écrit une préférence de scène CHEZ le fabricant (une seule source de vérité pour toutes les
  // apps). La nouvelle valeur revient par les événements du fabricant, pas dans la réponse.
  app.patch<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const entry = deps.scenes.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown scene "${req.params.id}"`)
    const update = sceneUpdateSchema.parse(req.body)
    if (update.autoDynamic && !entry.scene.dynamic) {
      return sendError(reply, 400, 'UNSUPPORTED_COMMAND', `scene "${entry.scene.name}" has no animated palette`)
    }
    await deps.host.updateScene(entry.scene.id, update)
    return { ok: true as const }
  })

  // Réglages par plugin (persistés côté serveur, valables pour toutes les tablettes).
  app.get('/api/plugins/settings', async () => ({ settings: deps.settings.all() }))

  app.patch<{ Params: { id: string } }>('/api/plugins/:id/settings', async (req, reply) => {
    if (!deps.host.ids().includes(req.params.id)) return sendError(reply, 404, 'NOT_FOUND', `unknown plugin "${req.params.id}"`)
    const settings = pluginSettingsSchema.parse(req.body)
    return { settings: await deps.settings.set(req.params.id, settings) }
  })

  app.post<{ Params: { id: string } }>('/api/devices/:id/command', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    const cmd = commandSchema.parse(req.body)        // ZodError → 400 via le gestionnaire d'erreurs
    assertCommandAllowed(entry.descriptor, cmd)      // CommandNotAllowedError → 400
    await deps.host.execute(entry.descriptor.id, cmd) // PluginError → 4xx/5xx
    return { ok: true as const }
  })
}
