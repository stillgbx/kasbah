import { pluginSettingsOf, addShoppingItems, clearCheckedShoppingItems, removeShoppingItem, setShoppingFavorite, shoppingAddBodySchema, shoppingFavoriteBodySchema, shoppingItemPatchSchema, updateShoppingItem, propertyModeBodySchema, newPropertyBodySchema, duplicatePropertyBodySchema, applyHouseEditToJson, houseEditPatchSchema, SurveyError, addGardenItemToJson, addOpeningToJson, addParkingToJson, gardenItemPatchSchema, newGardenItemSchema, patchGardenItemInJson, removeGardenItemFromJson, assertCommandAllowed, automationBodySchema, automationIdSchema, automationOrderSchema, automationPatchSchema, commandSchema, devicePlacementSchema, newOpeningSchema, newParkingSchema, openingPatchSchema, panelArrayPatchSchema, parkingPatchSchema, patchOpeningInJson, patchParkingInJson, placeDeviceInJson, pluginSettingsPatchSchema, putArrayInJson, releaseNotesLang, removeArrayFromJson, removeDeviceFromJson, removeOpeningFromJson, removeParkingFromJson, roomOrderSchema, polygonSchema, reliefSchema, sceneTuningSchema, setReliefInJson, setTerrainInJson, setRenderTuningInJson, sceneCreateSchema, sceneRecallSchema, sceneUpdateSchema, setPluginInJson, setRoomOrderInJson, type HealthResponse } from '@kasbah/shared'
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
  /** Propriétés démo entre lesquelles basculer ; absent = la seule maison du fichier. */
  properties?: PropertyHost
}

// REST : lecture (maison, appareils, santé) + commandes. L'état résultant d'une commande n'est
// PAS renvoyé dans la réponse : il arrive par le WebSocket comme tout autre changement (un seul chemin).

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
    // connecté : la santé de SES comptes, là où un plugin en tient par utilisateur
    plugins: await deps.host.health(req.sessionUser ?? null),
  }))

  app.get('/api/house', async (_req, reply) => {
    reply.header('cache-control', 'no-cache')
    return deps.house.house
  })

  app.get('/api/house/warnings', async () => ({ warnings: deps.house.warnings }))

  // Placement d'un appareil depuis l'UI : réécrit house.json (voir config/house.ts) et diffuse la
  // maison entière aux écrans connectés. Seule écriture du serveur dans le JSON.
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

  // Places de stationnement (`site.parkings[]`) : où un engin placé par son GPS se RANGE quand il
  // est au repos. Même mécanique que les ouvertures — poser, régler au centimètre, retirer — parce
  // que c'est le même geste : on relève au sol ce que le fabricant ne sait pas donner.
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

  // Aménagement du jardin (`site.garden[]`) : arbres, buissons, pierres. Du décor, posé et réglé
  // depuis le mode édition exactement comme une place.
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

  // Réglage de la lumière de la scène 3D (`render.tuning`), posé depuis le banc de la vue Maison :
  // c'est un choix de LA MAISON, pas de l'écran qui regarde — tous les écrans en héritent.
  // Même mécanique que le reste : patch du JSON brut, réécriture atomique, diffusion de la maison.
  app.put('/api/house/render', async (req) => {
    const tuning = sceneTuningSchema.parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setRenderTuningInJson(doc, tuning))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Relief du terrain (`site.relief`), posé depuis l'éditeur de la vue Maison. `null` = terrain plat.
  app.put('/api/house/relief', async (req) => {
    const relief = reliefSchema.nullable().parse(req.body)   // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setReliefInJson(doc, relief))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Contour du terrain (`site.terrain`), posé depuis l'éditeur de la vue Maison. Un contour qui se
  // croise → 400 ; un relief présent s'agrandit pour le couvrir.
  app.put('/api/house/terrain', async (req) => {
    const polygon = polygonSchema.parse(req.body)            // ZodError → 400
    const house = await updateHouseFile(deps.house, (doc) => setTerrainInJson(doc, polygon))
    deps.hub.broadcast({ type: 'house', house })
    return { house }
  })

  // Une SÉANCE d'édition validée depuis le mode édition : apparence (finitions des pièces, façade)
  // et forme des pièces (leurs cotes, dont le polygone est recalculé), écrite d'un coup ou pas du tout.
  // Une maison rendue inconstructible (pièces qui se chevauchent, cloison trop mince) → 400.
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

  // Carte du terrain d'une tondeuse : à la demande, pour qui déclare la capacité (le plugin sert son cache).
  app.get<{ Params: { id: string } }>('/api/devices/:id/map', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('site_map')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" publishes no site map`)
    return deps.host.siteMap(entry.descriptor.id)
  })

  // Notes de version d'un véhicule : à la demande, pour qui déclare la capacité (le plugin sert son cache).
  app.get<{ Params: { id: string }; Querystring: { lang?: string } }>('/api/devices/:id/release-notes', async (req, reply) => {
    const entry = deps.registry.get(req.params.id)
    if (!entry) return sendError(reply, 404, 'NOT_FOUND', `unknown device "${req.params.id}"`)
    if (!entry.descriptor.capabilities.includes('release_notes')) return sendError(reply, 400, 'KIND_MISMATCH', `device "${req.params.id}" publishes no release notes`)
    return deps.host.releaseNotes(entry.descriptor.id, releaseNotesLang(req.query.lang))
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

  // Automatisations de la maison. Chaque écriture rediffuse la liste entière par le WebSocket
  // (message `automations`, poussé par le moteur) ; la réponse porte l'automatisation et son statut.
  app.get('/api/automations', async () => ({ automations: deps.automations.list() }))

  app.put<{ Params: { id: string } }>('/api/automations/:id', async (req) => {
    const id = automationIdSchema.parse(req.params.id)          // ZodError → 400
    const body = automationBodySchema.parse(req.body)
    return { automation: await deps.automations.upsert(id, body) }
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

  // Ordre de la liste (celui du fichier). Hors de `/api/automations/` : un id `order` y est valide.
  app.put('/api/automation-order', async (req) => {
    const { ids } = automationOrderSchema.parse(req.body)
    return { automations: await deps.automations.reorder(ids) }
  })

  // Exécute les actions tout de suite, sans déclencheur ni « sauf si ». 200 même en échec partiel :
  // le compte rendu (`run.errors`) dit ce qui a raté, appareil par appareil.
  app.post<{ Params: { id: string } }>('/api/automations/:id/run', async (req, reply) => {
    const run = await deps.automations.runNow(req.params.id)
    if (!run) return sendError(reply, 404, 'NOT_FOUND', `unknown automation "${req.params.id}"`)
    return { run }
  })

  // Liste de courses de la maison. Chaque route rend la liste ENTIÈRE (elle est petite) et la
  // rediffuse par le WebSocket (message `shopping`) : l'écran d'à côté voit la coche tout de suite.
  // Coupée dans Réglages → Plugins (`plugins.shopping`) : toutes ses routes répondent 409, la liste
  // reste dans son fichier.
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

  // « Terminer les courses » : les lignes cochées quittent le panier.
  app.post('/api/shopping/finish', async () => ({ shopping: await deps.shopping.update(clearCheckedShoppingItems) }))

  app.put('/api/shopping/favorites', async (req) => {
    const { name, favorite } = shoppingFavoriteBodySchema.parse(req.body)
    return { shopping: await deps.shopping.update((l) => setShoppingFavorite(l, name, favorite, now())) }
  })

  // Propriétés : la liste, et la bascule (serveur de démonstration seulement). La bascule répond
  // AVANT de reconstruire le serveur sur l'autre maison ; le client attend qu'elle soit nommée.
  app.get('/api/properties', async () => deps.properties?.list() ?? singleProperty(deps.house.house))

  app.post<{ Params: { id: string } }>('/api/properties/:id/select', async (req, reply) => {
    if (!deps.properties) return sendError(reply, 409, 'NOT_SWITCHABLE', 'this server shows a single property (KASBAH_HOUSE_FILE)')
    if (!deps.properties.has(req.params.id)) return sendError(reply, 404, 'NOT_FOUND', `unknown property "${req.params.id}"`)
    deps.properties.select(req.params.id)
    return reply.code(202).send({ ok: true })
  })
  // Créer une propriété neuve, ou dupliquer une démo pour la modifier : le serveur de démonstration
  // seul (une installation réelle n'a qu'une maison). La bascule vers elle est un `select` à part.
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
  // Démo ou réel : le serveur rouvre la propriété retenue dans ce mode (après la réponse, 202).
  app.post('/api/properties/mode', async (req, reply) => {
    const list = deps.properties?.list()
    if (!list?.mode) return sendError(reply, 409, 'NOT_SWITCHABLE', 'this server shows a single property (KASBAH_HOUSE_FILE)')
    const { mode } = propertyModeBodySchema.parse(req.body)
    if (mode === 'real' && !list.realAvailable) return sendError(reply, 409, 'NO_REAL_PROPERTY', 'no real property yet: create or duplicate one')
    deps.properties!.setMode(mode)
    return reply.code(202).send({ ok: true })
  })

  // Plugins : l'inventaire complet (tous déclarés, actifs ou non) et ce qu'on en choisit. Le choix
  // vit dans house.json ; l'écrire allume, éteint ou redémarre le plugin sans redémarrer le serveur.
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
    const cmd = commandSchema.parse(req.body)        // ZodError → 400 via le gestionnaire d'erreurs
    assertCommandAllowed(entry.descriptor, cmd)      // CommandNotAllowedError → 400
    await deps.host.execute(entry.descriptor.id, cmd) // PluginError → 4xx/5xx
    return { ok: true as const }
  })
}
