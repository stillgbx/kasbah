import { pluginSettingsOf, geoOriginSchema, setOriginInJson, addShoppingItems, clearCheckedShoppingItems, removeShoppingItem, setShoppingFavorite, shoppingAddBodySchema, shoppingFavoriteBodySchema, shoppingItemPatchSchema, updateShoppingItem, propertyModeBodySchema, newPropertyBodySchema, duplicatePropertyBodySchema, applyHouseEditToJson, houseEditPatchSchema, SurveyError, addGardenItemToJson, addOpeningToJson, addParkingToJson, gardenItemPatchSchema, newGardenItemSchema, patchGardenItemInJson, removeGardenItemFromJson, assertCommandAllowed, automationBodySchema, automationIdSchema, automationOrderSchema, automationPatchSchema, commandSchema, devicePlacementSchema, newOpeningSchema, newParkingSchema, openingPatchSchema, panelArrayPatchSchema, parkingPatchSchema, patchOpeningInJson, patchParkingInJson, placeDeviceInJson, pluginSettingsPatchSchema, putArrayInJson, releaseNotesLang, removeArrayFromJson, removeDeviceFromJson, removeOpeningFromJson, removeParkingFromJson, roomOrderSchema, polygonSchema, reliefSchema, sceneTuningSchema, setReliefInJson, setTerrainInJson, setRenderTuningInJson, sceneCreateSchema, sceneRecallSchema, sceneUpdateSchema, setPluginInJson, setRoomOrderInJson, type HealthResponse } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import { updateHouseFile, type LoadedHouse } from '../config/house'
import { singleProperty, type PropertyHost } from '../config/properties'
import type { AutomationEngine } from '../core/automations/engine'
import type { PluginHost } from '../core/plugin-host'
import type { DeviceRegistry } from '../core/registry'
import type { EnergyHistory } from '../core/history'
import type { SceneRegistry } from '../core/scene-registry'
import type { ShoppingService } from '../core/shopping'
import type { WsHub } from '../ws/hub'
import { describeError, sendError } from './errors'
import { recentEnergyDays } from './recentDays'
import { fromMcp } from './session'

export interface RoutesDeps {
  registry: DeviceRegistry
  scenes: SceneRegistry
  host: PluginHost
  house: LoadedHouse
  hub: WsHub
  history: EnergyHistory
  automations: AutomationEngine
  shopping: ShoppingService
  startedAt: number
  /** Demo properties to switch between; absent = the file's single house. */
  properties?: PropertyHost
}

// REST: reading (house, devices, health) + commands. The state resulting from a command is NOT
// returned in the response: it arrives through the WebSocket like any other change (a single path).

export function registerRoutes(app: FastifyInstance, deps: RoutesDeps): void {
  app.setErrorHandler((err, _req, reply) => {
    const d = describeError(err)
    if (d.status >= 500) app.log.error({ err }, 'unhandled route error')
    return sendError(reply, d.status, d.code, d.message)
  })

  app.get('/api/health', async (req): Promise<HealthResponse> => ({
    ok: true,
    uptimeS: Math.round((Date.now() - deps.startedAt) / 1000),
    clients: deps.hub.clientCount,
    // signed in: the health of THEIR accounts, where a plugin keeps some per user
    plugins: await deps.host.health(req.sessionUser ?? null),
  }))

  app.get('/api/house', async (_req, reply) => {
    reply.header('cache-control', 'no-cache')
    return deps.house.house
  })

  app.get('/api/house/warnings', async () => ({ warnings: deps.house.warnings }))

  // Placing a device from the UI: rewrites house.json (see config/house.ts) and broadcasts the whole
  // house to the connected screens. The server's only write into the JSON.
  app.put<{ Params: { id: string } }>('/api/house/devices/:id', async (req) => {
    const placement = devicePlacementSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => placeDeviceInJson(doc, req.params.id, placement))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Taking a device out of the house: its entry is removed from the JSON, it goes back to being
  // auto-placed or "Not placed" (the plugin stays the source of the inventory, only the placement goes).
  app.delete<{ Params: { id: string } }>('/api/house/devices/:id', async (req) => {
    const house = await updateHouseFile(deps.house, (doc) => removeDeviceFromJson(doc, req.params.id))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Display order of a level's rooms (drag and drop in the Lights view): same mechanism as placement
  // — patch of the raw JSON, atomic rewrite, broadcast of the whole house.
  app.put<{ Params: { id: string } }>('/api/house/levels/:id/room-order', async (req) => {
    const { roomIds } = roomOrderSchema.parse(req.body)
    const house = await updateHouseFile(deps.house, (doc) => setRoomOrderInJson(doc, req.params.id, roomIds))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Panel arrays (`house.arrays`): created and adjusted from the solar installation panel. Same
  // mechanism as placing a device — patch of the raw JSON, atomic rewrite, broadcast of the whole
  // house (the modules themselves are derived: they have nothing to write).
  app.put<{ Params: { id: string } }>('/api/house/arrays/:id', async (req) => {
    const patch = panelArrayPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => putArrayInJson(doc, req.params.id, patch))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Openings (`rooms[i].openings[j]`) adjusted from the edit mode of the Home view: the survey of a
  // real house is approximate, the dimensions and the place on the wall are adjusted while looking at
  // the 3D. Same mechanism as the rest — patch of the raw JSON, `parseHouse` before writing (it is
  // what refuses an opening that overflows its wall or overlaps another one), broadcast of the house.
  app.put<{ Params: { roomId: string; openingId: string } }>('/api/house/rooms/:roomId/openings/:openingId', async (req) => {
    const patch = openingPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => patchOpeningInJson(doc, req.params.roomId, req.params.openingId, patch))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Adding an opening: the UI gives the WHOLE opening (type, wall, place, dimensions), computed where
  // the finger landed on the wall. The server guesses nothing — the 3D is what knows where you tapped.
  app.post<{ Params: { roomId: string } }>('/api/house/rooms/:roomId/openings', async (req) => {
    const opening = newOpeningSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => addOpeningToJson(doc, req.params.roomId, opening))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Removing an opening: the wall closes up, and the cover that dressed it is released in the same
  // write (see `removeOpeningFromJson`) — otherwise it would name an opening that is gone.
  app.delete<{ Params: { roomId: string; openingId: string } }>('/api/house/rooms/:roomId/openings/:openingId', async (req) => {
    const house = await updateHouseFile(deps.house, (doc) => removeOpeningFromJson(doc, req.params.roomId, req.params.openingId))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Parking spots (`site.parkings[]`): where a machine placed by its GPS is STORED when at rest. Same
  // mechanism as openings — place, adjust to the centimeter, remove — because it is the same gesture:
  // we survey on the ground what the vendor cannot give.
  app.post('/api/house/parkings', async (req) => {
    const parking = newParkingSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => addParkingToJson(doc, parking))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  app.put<{ Params: { id: string } }>('/api/house/parkings/:id', async (req) => {
    const patch = parkingPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => patchParkingInJson(doc, req.params.id, patch))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  app.delete<{ Params: { id: string } }>('/api/house/parkings/:id', async (req) => {
    const house = await updateHouseFile(deps.house, (doc) => removeParkingFromJson(doc, req.params.id))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Garden layout (`site.garden[]`): trees, bushes, stones. Scenery, placed and adjusted from edit
  // mode exactly like a parking spot.
  app.post('/api/house/garden', async (req) => {
    const item = newGardenItemSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => addGardenItemToJson(doc, item))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  app.put<{ Params: { id: string } }>('/api/house/garden/:id', async (req) => {
    const patch = gardenItemPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => patchGardenItemInJson(doc, req.params.id, patch))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  app.delete<{ Params: { id: string } }>('/api/house/garden/:id', async (req) => {
    const house = await updateHouseFile(deps.house, (doc) => removeGardenItemFromJson(doc, req.params.id))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Lighting tuning of the 3D scene (`render.tuning`), set from the bench of the Home view: it is a
  // choice of THE HOUSE, not of the screen looking at it — all screens inherit it.
  // Same mechanism as the rest: patch of the raw JSON, atomic rewrite, broadcast of the house.
  app.put('/api/house/render', async (req) => {
    const tuning = sceneTuningSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setRenderTuningInJson(doc, tuning))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // GPS origin of the house (`origin`), aligned on the photo from Settings: the WHOLE house slides
  // and turns over the world (maps, devices placed by GPS, sun). The body is the whole origin, not a
  // patch.
  app.put('/api/house/origin', async (req) => {
    const origin = geoOriginSchema.parse(req.body)       // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setOriginInJson(doc, origin))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Terrain relief (`site.relief`), set from the editor of the Home view. `null` = flat terrain.
  app.put('/api/house/relief', async (req) => {
    const relief = reliefSchema.nullable().parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setReliefInJson(doc, relief))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Terrain outline (`site.terrain`), set from the editor of the Home view. A self-crossing outline
  // → 400; an existing relief grows to cover it.
  app.put('/api/house/terrain', async (req) => {
    const polygon = polygonSchema.parse(req.body)            // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setTerrainInJson(doc, polygon))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // An editing SESSION confirmed from edit mode: appearance (room finishes, facade) and room shapes
  // (their dimensions, from which the polygon is recomputed), written all at once or not at all.
  // A house made unbuildable (overlapping rooms, partition too thin) → 400.
  app.put('/api/house/edit', async (req) => {
    const patch = houseEditPatchSchema.parse(req.body)    // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => {
      const r = applyHouseEditToJson(doc, patch)
      if (r.blocking.length) throw new SurveyError(r.blocking.join(' ; '))
      return r.doc
    })
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

  // Weather forecasts: on demand, like the history — the plugin returns its last reading.
  app.get<{ Params: { id: string } }>('/api/devices/:id/forecast', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (entry.descriptor.kind !== 'weather') return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" is not a weather device`)
    return deps.host.forecast(entry.descriptor.id)
  })

  // A device's log (recorded errors, warnings): on demand, for those that declare the capability.
  app.get<{ Params: { id: string } }>('/api/devices/:id/journal', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('journal')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" keeps no journal`)
    return deps.host.journal(entry.descriptor.id)
  })

  // A mower's plot map: on demand, for those that declare the capability (the plugin serves its cache).
  app.get<{ Params: { id: string } }>('/api/devices/:id/map', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('site_map')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" publishes no site map`)
    return deps.host.siteMap(entry.descriptor.id)
  })

  // A vehicle's release notes: on demand, for those that declare the capability (the plugin serves its cache).
  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>('/api/devices/:id/release-notes', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('release_notes')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" publishes no release notes`)
    return deps.host.releaseNotes(entry.descriptor.id, releaseNotesLang(req.query.lang))
  })

  // A device's consumption (liters per time step): on demand, for those that declare the capability.
  app.get<{ Params: { id: string } }>('/api/devices/:id/consumption', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('water_usage')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" keeps no consumption history`)
    return deps.host.consumption(entry.descriptor.id)
  })

  // A site's daily energy totals: on demand, for those that declare the capability; `?days=n`
  // keeps only the last n days (see `recentEnergyDays`).
  app.get<{ Params: { id: string }; Querystring: { days?: string } }>('/api/devices/:id/energy-days', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('energy_history')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" keeps no energy history`)
    const history = await deps.host.energyDays(entry.descriptor.id)
    const n = Number(req.query.days)
    return Number.isInteger(n) && n >= 1 ? recentEnergyDays(history, n, Date.now()) : history
  })

  // Vendor scenes: reading, then recall. As for commands, the resulting state (which scene is
  // active) arrives through the WebSocket, not in the response.
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

  // Creates a light scene for a room, by copying a light scene present elsewhere at the vendor (it
  // does not publish its preset gallery). The new scene arrives through the `scenes` message, as if
  // it had been created in the vendor's app.
  app.post('/api/scenes', async (req, reply) => {
    const body = sceneCreateSchema.parse(req.body)
    const source = deps.scenes.get(body.fromSceneId)
    if (!source) return sendError(reply, 404, 'NOT_FOUND', `unknown scene "${body.fromSceneId}"`)
    await deps.host.createScene(source.scene.id, body.groupName)
    return { ok: true as const }
  })

  // Deletes a light scene at the vendor. Destructive and visible from all the vendor's apps: the
  // confirmation is asked on the UI side, not here.
  app.delete<{ Params: { id: string } }>('/api/scenes/:id', async (req, reply) => {
    const entry = deps.scenes.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown scene "${req.params.id}"`)
    await deps.host.deleteScene(entry.scene.id)
    return { ok: true as const }
  })

  // Writes a scene preference AT the vendor (a single source of truth for all apps). The new value
  // comes back through the vendor's events, not in the response.
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

  // The house's automations. Each write rebroadcasts the whole list through the WebSocket
  // (`automations` message, pushed by the engine); the response carries the automation and its status.
  app.get('/api/automations', async () => ({ automations: deps.automations.list() }))

  app.put<{ Params: { id: string } }>('/api/automations/:id', async (req) => {
    const id = automationIdSchema.parse(req.params.id)          // ZodError → 400
    const body = automationBodySchema.parse(req.body)
    // written by an assistant: the app will show it "to review" until a write from the app
    const byAssistant = fromMcp(req) ? (req.sessionUser ? { user: req.sessionUser } : {}) : undefined
    return { automation: await deps.automations.upsert(id, body, byAssistant) }
  })

  app.patch<{ Params: { id: string } }>('/api/automations/:id', async (req, reply) => {
    const { enabled } = automationPatchSchema.parse(req.body)
    const entry = await deps.automations.setEnabled(req.params.id, enabled)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown automation "${req.params.id}"`)
    return { automation: entry }
  })

  app.delete<{ Params: { id: string } }>('/api/automations/:id', async (req, reply) => {
    if (!(await deps.automations.remove(req.params.id))) return sendError(reply, 404, 'NOT_FOUND', `unknown automation "${req.params.id}"`)
    return { ok: true as const }
  })

  // Order of the list (the file's). Outside `/api/automations/`: an `order` id is valid there.
  app.put('/api/automation-order', async (req) => {
    const { ids } = automationOrderSchema.parse(req.body)
    return { automations: await deps.automations.reorder(ids) }
  })

  // Runs the actions right away, without trigger or "Unless". 200 even on partial failure: the report
  // (`run.errors`) says what failed, device by device.
  app.post<{ Params: { id: string } }>('/api/automations/:id/run', async (req, reply) => {
    const run = await deps.automations.runNow(req.params.id)
    if (!run) return sendError(reply, 404, 'NOT_FOUND', `unknown automation "${req.params.id}"`)
    return { run }
  })

  // The house's shopping list. Each route returns the WHOLE list (it is small) and rebroadcasts it
  // through the WebSocket (`shopping` message): the screen next door sees the tick right away.
  // Turned off in Settings → Plugins (`plugins.shopping`): all its routes answer 409, the list stays
  // in its file.
  const now = () => Date.now()
  const unknownItem = (reply: Parameters<typeof sendError>[0], id: string) => sendError(reply, 404, 'NOT_FOUND', `unknown shopping item "${id}"`)
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/shopping') || pluginSettingsOf(deps.house.house.plugins, 'shopping').enabled) return
    return sendError(reply, 409, 'DISABLED', 'the shopping list is turned off (Settings → Plugins)')
  })
  app.get('/api/shopping', async () => ({ shopping: deps.shopping.get() }))

  app.post('/api/shopping/items', async (req) => {
    const { items } = shoppingAddBodySchema.parse(req.body)
    return { shopping: await deps.shopping.update((l) => addShoppingItems(l, items, now())) }
  })

  app.patch<{ Params: { id: string } }>('/api/shopping/items/:id', async (req, reply) => {
    const patch = shoppingItemPatchSchema.parse(req.body)
    const shopping = await deps.shopping.update((l) => updateShoppingItem(l, req.params.id, patch))
    return shopping ? { shopping } : unknownItem(reply, req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/api/shopping/items/:id', async (req, reply) => {
    const shopping = await deps.shopping.update((l) => removeShoppingItem(l, req.params.id))
    return shopping ? { shopping } : unknownItem(reply, req.params.id)
  })

  // "Finish shopping": the checked lines leave the basket.
  app.post('/api/shopping/finish', async () => ({ shopping: await deps.shopping.update(clearCheckedShoppingItems) }))

  app.put('/api/shopping/favorites', async (req) => {
    const { name, favorite } = shoppingFavoriteBodySchema.parse(req.body)
    return { shopping: await deps.shopping.update((l) => setShoppingFavorite(l, name, favorite, now())) }
  })

  // Properties: the list, and the switch (demo server only). The switch answers BEFORE rebuilding the
  // server on the other house; the client waits for it to be named.
  app.get('/api/properties', async () => deps.properties?.list() ?? singleProperty(deps.house.house))

  app.post<{ Params: { id: string } }>('/api/properties/:id/select', async (req, reply) => {
    if (!deps.properties) return sendError(reply, 409, 'NOT_SWITCHABLE', 'this server shows a single property (KASBAH_HOUSE_FILE)')
    if (!deps.properties.has(req.params.id)) return sendError(reply, 404, 'NOT_FOUND', `unknown property "${req.params.id}"`)
    deps.properties.select(req.params.id)
    return reply.code(202).send({ ok: true })
  })
  // Creating a new property, or duplicating a demo to change it: the demo server only (a real
  // installation has only one house). Switching to it is a separate `select`.
  app.post('/api/properties', async (req, reply) => {
    if (!deps.properties?.list().canCreate) return sendError(reply, 409, 'NOT_SWITCHABLE', 'this server shows a single property (KASBAH_HOUSE_FILE)')
    const body = newPropertyBodySchema.parse(req.body)      // ZodError → 400
    return reply.code(201).send({ id: await deps.properties.create(body) })
  })
  app.post<{ Params: { id: string } }>('/api/properties/:id/duplicate', async (req, reply) => {
    if (!deps.properties?.list().canCreate) return sendError(reply, 409, 'NOT_SWITCHABLE', 'this server shows a single property (KASBAH_HOUSE_FILE)')
    const { name } = duplicatePropertyBodySchema.parse(req.body)
    return reply.code(201).send({ id: await deps.properties.duplicate(req.params.id, name) })
  })
  // Demo or real: the server reopens the property remembered in that mode (after the response, 202).
  app.post('/api/properties/mode', async (req, reply) => {
    const list = deps.properties?.list()
    if (!list?.mode) return sendError(reply, 409, 'NOT_SWITCHABLE', 'this server shows a single property (KASBAH_HOUSE_FILE)')
    const { mode } = propertyModeBodySchema.parse(req.body)
    if (mode === 'real' && !list.realAvailable) return sendError(reply, 409, 'NO_REAL_PROPERTY', 'no real property yet: create or duplicate one')
    deps.properties!.setMode(mode)
    return reply.code(202).send({ ok: true })
  })

  // Plugins: the full inventory (all declared, active or not) and what is chosen for them. The choice
  // lives in house.json; writing it turns the plugin on, off or restarts it without restarting the server.
  app.get('/api/plugins', async (req) => ({ plugins: await deps.host.inventory(req.sessionUser ?? null) }))

  app.patch<{ Params: { id: string } }>('/api/plugins/:id', async (req, reply) => {
    const id = req.params.id
    if (!deps.host.ids().includes(id)) return sendError(reply, 404, 'NOT_FOUND', `unknown plugin "${id}"`)
    const patch = pluginSettingsPatchSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setPluginInJson(doc, id, patch))
    await deps.host.apply(id)
    deps.hub.broadcast({ type: 'house', house })
    return { plugins: await deps.host.inventory(req.sessionUser ?? null) }
  })

  app.post<{ Params: { id: string } }>('/api/devices/:id/command', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    const cmd = commandSchema.parse(req.body)        // ZodError → 400 through the error handler
    assertCommandAllowed(entry.descriptor, cmd)      // CommandNotAllowedError → 400
    await deps.host.execute(entry.descriptor.id, cmd) // PluginError → 4xx/5xx
    return { ok: true as const }
  })
}
