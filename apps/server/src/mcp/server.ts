import { assertCommandAllowed, commandSchema, DEVICE_KINDS, indexHouse, sceneRecallSchema, type DeviceEntry } from '@kasbah/shared'
import { localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/fastify'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { LoadedHouse } from '../config/house'
import type { PluginHost } from '../core/plugin-host'
import type { DeviceRegistry } from '../core/registry'
import type { SceneRegistry } from '../core/scene-registry'

export interface McpDeps {
  registry: DeviceRegistry
  scenes: SceneRegistry
  host: PluginHost
  house: LoadedHouse
}

// Serveur MCP sur `/mcp` (Streamable HTTP, SDK v2) : les mêmes lectures et commandes que le REST,
// pour un agent. Sans authentification, donc réservé à la machine du serveur : le Host et l'Origin
// doivent être localhost (protection contre le DNS rebinding — pas un contrôle d'accès, un client du
// LAN peut forger son Host). Sans état : une instance par requête, clients 2025 servis aussi.

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true })

function buildServer(deps: McpDeps): McpServer {
  const server = new McpServer({ name: 'kasbah', version: '0.1.0' })

  // Nom et pièce tels que la maison les donne (renommage, placement), sinon ceux du fabricant.
  const describe = (e: DeviceEntry) => {
    const index = indexHouse(deps.house.house)
    const placed = index.devicesByBinding.get(e.descriptor.id)
    const room = placed?.roomId ? index.roomsById.get(placed.roomId)?.name : e.descriptor.meta.room
    return { id: e.descriptor.id, name: placed?.name ?? e.descriptor.name, kind: e.descriptor.kind, room, state: e.state }
  }

  server.registerTool('list_devices', {
    title: 'Lister les appareils',
    description: 'Appareils de la maison avec leur état courant. Filtres facultatifs, cumulables.',
    inputSchema: z.object({
      kind: z.enum(DEVICE_KINDS).optional(),
      room: z.string().optional().describe('Nom de pièce, sous-chaîne sans casse'),
      query: z.string().optional().describe("Sous-chaîne sans casse du nom ou de l'id"),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ kind, room, query }) => {
    const has = (s: string | undefined, part: string) => (s ?? '').toLowerCase().includes(part.toLowerCase())
    const devices = deps.registry.list().map(describe).filter((d) =>
      (!kind || d.kind === kind) && (!room || has(d.room, room)) && (!query || has(d.name, query) || has(d.id, query)))
    return json(devices)
  })

  server.registerTool('get_device', {
    title: 'Lire un appareil',
    description: 'Descripteur complet (capacités, meta) et état courant d\'un appareil.',
    inputSchema: z.object({ id: z.string() }),
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    const entry = deps.registry.get(id)
    return entry ? json(entry) : fail(`appareil inconnu "${id}"`)
  })

  server.registerTool('send_command', {
    title: 'Commander un appareil',
    description: "Envoie une commande à un vrai appareil. Réussit à l'accusé du fabricant ; le nouvel état se relit avec get_device. La commande doit être permise par les capacités de l'appareil.",
    inputSchema: z.object({ deviceId: z.string(), command: commandSchema }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ deviceId, command }) => {
    const entry = deps.registry.get(deviceId)
    if (!entry) return fail(`appareil inconnu "${deviceId}"`)
    assertCommandAllowed(entry.descriptor, command)
    await deps.host.execute(entry.descriptor.id, command)
    return json({ ok: true })
  })

  server.registerTool('list_scenes', {
    title: 'Lister les scènes',
    description: 'Scènes des fabricants (ambiances) et leur état.',
    annotations: { readOnlyHint: true },
  }, async () => json(deps.scenes.list()))

  server.registerTool('recall_scene', {
    title: 'Rappeler une scène',
    description: 'Active une scène de fabricant.',
    inputSchema: z.object({ sceneId: z.string(), recall: sceneRecallSchema.optional() }),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, async ({ sceneId, recall }) => {
    const entry = deps.scenes.get(sceneId)
    if (!entry) return fail(`scène inconnue "${sceneId}"`)
    const r = recall ?? sceneRecallSchema.parse({})
    if (r.mode === 'dynamic' && !entry.scene.dynamic) return fail(`la scène "${entry.scene.name}" n'a pas de palette animée`)
    await deps.host.recallScene(entry.scene.id, r)
    return json({ ok: true })
  })

  server.registerTool('get_health', {
    title: 'Santé des plugins',
    description: 'État de chaque plugin (statut, détail, nombre d\'appareils, quota).',
    annotations: { readOnlyHint: true },
  }, async () => json(deps.host.health()))

  server.registerResource('house', 'kasbah://house', {
    title: 'Maison',
    description: 'house.json validé : niveaux, pièces, ouvertures, placement des appareils.',
    mimeType: 'application/json',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(deps.house.house) }] }))

  return server
}

export async function registerMcp(app: FastifyInstance, deps: McpDeps): Promise<void> {
  const handler = createMcpHandler(() => buildServer(deps))
  app.addHook('onClose', () => handler.close())
  await app.register(async (sub) => {
    sub.addHook('onRequest', localhostHostValidation())
    sub.addHook('onRequest', localhostOriginValidation())
    // Fastify a déjà lu le corps JSON : on reconstruit la requête web que le SDK attend.
    // Pas de compression : la réponse peut être un flux SSE.
    sub.route({
      method: ['GET', 'POST', 'DELETE'], url: '/mcp', compress: false,
      handler: async (req, reply) => {
        const headers = new Headers()
        for (const [k, v] of Object.entries(req.headers)) {
          if (v !== undefined && k !== 'content-length') headers.set(k, Array.isArray(v) ? v.join(', ') : v)
        }
        const body = req.method === 'POST' ? JSON.stringify(req.body) : undefined
        return reply.send(await handler.fetch(new Request(`http://${req.host}${req.url}`, { method: req.method, headers, body })))
      },
    })
  })
}
