import { addOpeningToJson, assertCommandAllowed, commandSchema, devicePlacementSchema, newOpeningSchema, openingPatchSchema, panelArrayPatchSchema, patchOpeningInJson, placeDeviceInJson, pluginSettingsPatchSchema, putArrayInJson, removeArrayFromJson, removeDeviceFromJson, removeOpeningFromJson, roomOrderSchema, sceneTuningSchema, setRenderTuningInJson, sceneCreateSchema, sceneRecallSchema, sceneUpdateSchema, setPluginInJson, setRoomOrderInJson, type HealthResponse } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { updateHouseFile, type LoadedHouse } from '../config/house'
import type { PluginHost } from '../core/plugin-host'
import type { DeviceRegistry } from '../core/registry'
import type { EnergyHistory } from '../core/history'
import type { SceneRegistry } from '../core/scene-registry'
import type { WsHub } from '../ws/hub'
import { describeError, sendError } from './errors'

export interface RoutesDeps {
  registry: DeviceRegistry
  scenes: SceneRegistry
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

  // Sortir un appareil de la maison : son entrée est retirée du JSON, il redevient auto-placé ou « non
  // placé » (le plugin reste la source de l'inventaire, seul le placement disparaît).
  app.delete<{ Params: { id: string } }>('/api/house/devices/:id', async (req) => {
    const house = await updateHouseFile(deps.house, (doc) => removeDeviceFromJson(doc, req.params.id))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Ordre d'affichage des pièces d'un niveau (glisser-déposer de la vue Lumières) : même mécanique
  // que le placement — patch du JSON brut, réécriture atomique, diffusion de la maison entière.
  app.put<{ Params: { id: string } }>('/api/house/levels/:id/room-order', async (req) => {
    const { roomIds } = roomOrderSchema.parse(req.body)
    const house = await updateHouseFile(deps.house, (doc) => setRoomOrderInJson(doc, req.params.id, roomIds))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Champs de panneaux (`house.arrays`) : créés et réglés depuis le panneau de l'installation
  // solaire. Même mécanique que le placement d'un appareil — patch du JSON brut, réécriture atomique,
  // diffusion de la maison entière (les modules, eux, sont dérivés : ils n'ont rien à écrire).
  app.put<{ Params: { id: string } }>('/api/house/arrays/:id', async (req) => {
    const patch = panelArrayPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => putArrayInJson(doc, req.params.id, patch))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Ouvertures (`rooms[i].openings[j]`) réglées depuis le mode édition de la vue Maison : le relevé
  // d'une maison réelle est approximatif, on ajuste les cotes et la place sur le mur en regardant la
  // 3D. Même mécanique que le reste — patch du JSON brut, `parseHouse` avant écriture (c'est lui qui
  // refuse une ouverture qui déborde son mur ou en chevauche une autre), diffusion de la maison.
  app.put<{ Params: { roomId: string; openingId: string } }>('/api/house/rooms/:roomId/openings/:openingId', async (req) => {
    const patch = openingPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => patchOpeningInJson(doc, req.params.roomId, req.params.openingId, patch))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Ajouter une ouverture : l'UI donne l'ouverture ENTIÈRE (nature, mur, place, cotes), calculée là
  // où le doigt s'est posé sur le mur. Le serveur ne devine rien — c'est la 3D qui sait où on a tapé.
  app.post<{ Params: { roomId: string } }>('/api/house/rooms/:roomId/openings', async (req) => {
    const opening = newOpeningSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => addOpeningToJson(doc, req.params.roomId, opening))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Retirer une ouverture : le mur se referme, et l'ouvrant qui l'habillait est libéré dans la même
  // écriture (voir `removeOpeningFromJson`) — sans quoi il nommerait une ouverture disparue.
  app.delete<{ Params: { roomId: string; openingId: string } }>('/api/house/rooms/:roomId/openings/:openingId', async (req) => {
    const house = await updateHouseFile(deps.house, (doc) => removeOpeningFromJson(doc, req.params.roomId, req.params.openingId))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Réglage de la lumière de la scène 3D (`render.tuning`), posé depuis le banc de la vue Maison :
  // c'est un choix de LA MAISON, pas de la tablette qui regarde — toutes les tablettes en héritent.
  // Même mécanique que le reste : patch du JSON brut, réécriture atomique, diffusion de la maison.
  app.put('/api/house/render', async (req) => {
    const tuning = sceneTuningSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setRenderTuningInJson(doc, tuning))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  app.delete<{ Params: { id: string } }>('/api/house/arrays/:id', async (req) => {
    const house = await updateHouseFile(deps.house, (doc) => removeArrayFromJson(doc, req.params.id))
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

  // Prévisions météo : à la demande, comme l'historique — le plugin rend sa dernière lecture.
  app.get<{ Params: { id: string } }>('/api/devices/:id/forecast', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (entry.descriptor.kind !== 'weather') return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" is not a weather device`)
    return deps.host.forecast(entry.descriptor.id)
  })

  // Journal d'un appareil (erreurs, avertissements consignés) : à la demande, pour qui déclare la capacité.
  app.get<{ Params: { id: string } }>('/api/devices/:id/journal', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('journal')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" keeps no journal`)
    return deps.host.journal(entry.descriptor.id)
  })

  // Consommation d'un appareil (litres par pas de temps) : à la demande, pour qui déclare la capacité.
  app.get<{ Params: { id: string } }>('/api/devices/:id/consumption', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('water_usage')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" keeps no consumption history`)
    return deps.host.consumption(entry.descriptor.id)
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

  // Crée une ambiance pour une pièce, en recopiant une ambiance présente ailleurs chez le
  // fabricant (il ne publie pas sa galerie de préréglages). La nouvelle scène arrive par le
  // message `scenes`, comme si elle avait été créée dans l'app du fabricant.
  app.post('/api/scenes', async (req, reply) => {
    const body = sceneCreateSchema.parse(req.body)
    const source = deps.scenes.get(body.fromSceneId)
    if (!source) return sendError(reply, 404, 'NOT_FOUND', `unknown scene "${body.fromSceneId}"`)
    await deps.host.createScene(source.scene.id, body.groupName)
    return { ok: true as const }
  })

  // Supprime une ambiance chez le fabricant. Destructif et visible depuis toutes les apps du
  // fabricant : la confirmation est demandée côté UI, pas ici.
  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const entry = deps.scenes.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown scene "${req.params.id}"`)
    await deps.host.deleteScene(entry.scene.id)
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

  // Plugins : l'inventaire complet (tous déclarés, actifs ou non) et ce qu'on en choisit. Le choix
  // vit dans house.json ; l'écrire allume, éteint ou redémarre le plugin sans redémarrer le serveur.
  app.get('/api/plugins', async () => ({ plugins: deps.host.inventory() }))

  app.patch<{ Params: { id: string } }>('/api/plugins/:id', async (req, reply) => {
    const id = req.params.id
    if (!deps.host.ids().includes(id)) return sendError(reply, 404, 'NOT_FOUND', `unknown plugin "${id}"`)
    const patch = pluginSettingsPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setPluginInJson(doc, id, patch))
    await deps.host.apply(id)
    deps.hub.broadcast({ type: 'house', house })
    return { plugins: deps.host.inventory() }
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
