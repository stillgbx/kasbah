import { pluginSettingsOf } from '@kasbah/shared'
import fastifyCompress from '@fastify/compress'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { registerAssistantRoutes } from './assistant/assistant'
import type { Env } from './config/env'
import { loadHouse, type LoadedHouse } from './config/house'
import type { PropertyHost } from './config/properties'
import { AutomationEngine } from './core/automations/engine'
import { automationsPathFor, createAutomationsFile } from './core/automations/store'
import { Bus } from './core/bus'
import { systemClock, type Clock } from './core/clock'
import type { PluginFactory } from './core/plugin'
import { PluginHost } from './core/plugin-host'
import { DeviceRegistry } from './core/registry'
import { SceneRegistry } from './core/scene-registry'
import { SceneSeeder } from './core/scene-seeder'
import { ShoppingService, shoppingPathFor } from './core/shopping'
import { EnergyHistory } from './core/history'
import { registerRoutes } from './http/routes'
import { actAsHook, createAppSession, sessionConfigSchema } from './http/session'
import { registerStatic } from './http/static'
import { createMcpAuth, mcpAuthConfigSchema, publicHostFilter } from './mcp/auth'
import { registerMcp } from './mcp/server'
import { registerMcpUserRoutes } from './mcp/users-routes'
import { PLUGIN_FACTORIES } from './plugins'
import { setPlaybackBridge } from './core/playbackBridge'
import { createMusicPlayer, musicConfigSchema, MUSIC_PREFIX } from './music/player'
import { WsHub } from './ws/hub'

export interface BuildAppOptions {
  env: Env
  logger: Logger
  clock?: Clock
  factories?: Record<string, PluginFactory>
  envSource?: NodeJS.ProcessEnv
  /** Maison déjà chargée (tests) ; sinon lue depuis env.KASBAH_HOUSE_FILE. */
  house?: LoadedHouse
  serveStatic?: boolean
  /** Propriétés entre lesquelles basculer (serveur de démonstration) ; absent = une seule maison. */
  properties?: PropertyHost
  /** La maison est une démonstration : ni elle ni ses automatisations ne s'écrivent. */
  readOnly?: boolean
}

export interface KasbahApp {
  app: FastifyInstance
  registry: DeviceRegistry
  scenes: SceneRegistry
  bus: Bus
  hub: WsHub
  host: PluginHost
  house: LoadedHouse
  automations: AutomationEngine
  /** Démarre les plugins (après app.ready()/listen pour que les routes soient prêtes). */
  startPlugins(): Promise<void>
  close(): Promise<void>
}

/** Assemble l'application sans écouter : utilisé par main.ts et par les tests (app.inject). */
export async function buildApp(opts: BuildAppOptions): Promise<KasbahApp> {
  const clock = opts.clock ?? systemClock
  // le child pino spécialise le type générique de l'instance : on revient au FastifyInstance nominal
  const app = Fastify({
    loggerInstance: opts.logger.child({ component: 'http' }, { level: 'warn' }),
    // Le défaut de Fastify (100 caractères par paramètre d'URL, sinon 414) est trop court pour les
    // ids Google Nest : `nest:<id>` fait 99 caractères et l'id maison dérivé par l'auto-placement
    // (`auto.nest-<id>`) 104 — le mode Déplacer échouait en 414 sur toute caméra auto-placée.
    // Fastify 5 : les options du routeur vivent dans `routerOptions` (FSTDEP022 sinon).
    routerOptions: { maxParamLength: 512 },
  }) as unknown as FastifyInstance
  // Sous le nom public : le MCP avec ses jetons, le reste derrière une session. Posé AVANT toute route.
  const mcpConfig = mcpAuthConfigSchema.parse(opts.envSource ?? process.env)
  const mcpAuth = createMcpAuth({ config: mcpConfig, logger: opts.logger.child({ component: 'mcp' }) })
  const session = createAppSession({
    config: sessionConfigSchema.parse(opts.envSource ?? process.env),
    publicUrl: mcpConfig.MCP_PUBLIC_URL,
    publicHosts: mcpAuth.publicHosts,
    guard: mcpAuth.guard,
    users: mcpAuth.users,
    logger: opts.logger.child({ component: 'session' }),
  })
  app.addHook('onRequest', publicHostFilter(mcpAuth.publicHosts, session.gate))
  app.addHook('onRequest', actAsHook)
  const house = opts.house ?? (await loadHouse(opts.env.KASBAH_HOUSE_FILE))
  if (opts.readOnly) house.readOnly = true
  for (const w of house.warnings) opts.logger.warn({ path: w.path, code: w.code }, w.message)

  const bus = new Bus()
  const registry = new DeviceRegistry(bus, clock, opts.logger.child({ component: 'registry' }))
  const scenes = new SceneRegistry(bus, clock, opts.logger.child({ component: 'scenes' }))
  // Réglages par plugin : ils vivent DANS la maison (`house.plugins`), écrits par l'UI. `house`
  // est muté en place par `updateHouseFile`, donc cette lecture voit toujours la valeur courante.
  const settingsOf = (pluginId: string) => pluginSettingsOf(house.house.plugins, pluginId)
  const history = new EnergyHistory(bus, clock)
  const host = new PluginHost({
    settingsOf,
    site: () => house.house.origin,
    strict: opts.env.KASBAH_STRICT_PLUGINS,
    factories: opts.factories ?? PLUGIN_FACTORIES,
    registry, scenes, bus, clock, logger: opts.logger,
    ...(opts.envSource ? { envSource: opts.envSource } : {}),
    commandTimeoutMs: opts.env.KASBAH_COMMAND_TIMEOUT_MS,
  })

  // Automatisations : un fichier à côté de la maison, exécutées ici (l'écran dort, le serveur
  // non). Après `host`, par qui passent les commandes ; avant le hub, dont le snapshot les porte.
  const automations = new AutomationEngine({
    store: createAutomationsFile(automationsPathFor(house.path), { readOnly: !!opts.readOnly }),
    registry, scenes, host, house, bus, clock, logger: opts.logger.child({ component: 'automations' }),
  })
  // Liste de courses : un fichier à côté de la maison, lu avant le hub, dont le snapshot la porte.
  const shopping = new ShoppingService(shoppingPathFor(house.path), { readOnly: !!opts.readOnly })
  await shopping.load()
  const hub = new WsHub(registry, bus, clock, opts.logger.child({ component: 'ws' }), { scenes, automations, shopping, propertyId: () => house.house.id })
  automations.onChange(() => hub.broadcast({ type: 'automations', automations: automations.list() }))
  shopping.onChange((list) => hub.broadcast({ type: 'shopping', shopping: list }))
  await automations.start()

  await hub.attach(app)
  // initialise le réglage des ambiances qui APPARAISSENT (jamais l'existant) — après `host`,
  // dont il utilise l'écriture chez le fabricant
  const seeder = new SceneSeeder({
    bus, settingsOf, logger: opts.logger.child({ component: 'scenes' }),
    updateScene: (sceneId, update) => host.updateScene(sceneId, update),
  })

  // Compression des réponses, AVANT les routes : le crochet `onSend` ne vaut que pour ce qui est
  // enregistré après lui. Le gros du gain est sur le bundle web et les carrosseries 3D
  // (`model/gltf-binary`, que mime-db donne déjà pour compressible) — 815 Ko de modèles tombent à
  // environ 550 Ko. Les types non compressibles (JPEG d'un instantané de caméra, flux vidéo) sont
  // laissés tranquilles par défaut, et le WebSocket ne passe pas par ce crochet.
  await app.register(fastifyCompress, { global: true })

  registerRoutes(app, { registry, scenes, host, house, hub, history, automations, shopping, startedAt: clock.now(), ...(opts.properties ? { properties: opts.properties } : {}) })
  host.registerRoutes(app)
  await registerMcp(app, { registry, scenes, host, house, auth: mcpAuth })
  registerMcpUserRoutes(app, { usersFile: mcpConfig.MCP_USERS_FILE })
  registerAssistantRoutes(app, {
    auth: mcpAuth,
    mcpUrl: `http://127.0.0.1:${opts.env.KASBAH_PORT}/mcp`,
    logger: opts.logger.child({ component: 'assistant' }),
  })
  session.routes(app)
  // Les sources musicales n'ont pas d'appareils : pour `play_url` elles passent par Cast/Sonos via l'hôte.
  setPlaybackBridge({
    getDevice: (id) => registry.get(id),
    execute: (id, command) => host.execute(id, command),
    onState: (cb) => bus.on('state', cb),
  })
  // Le lecteur COMMUN des sources musicales (file, relais LAN, transfert, écoute locale) : les
  // sources s'y inscrivent à leur démarrage, il passe par le pont ci-dessus pour les enceintes.
  const music = createMusicPlayer({
    config: musicConfigSchema.parse(opts.envSource ?? process.env),
    publicHosts: mcpAuth.publicHosts,
    logger: opts.logger.child({ component: 'music' }),
    now: () => clock.now(),
  })
  await app.register(async (sub) => music.registerRoutes(sub), { prefix: MUSIC_PREFIX })
  if (opts.serveStatic ?? true) {
    const served = await registerStatic(app, opts.env.KASBAH_STATIC_DIR)
    opts.logger.info({ dir: opts.env.KASBAH_STATIC_DIR, served }, served ? 'serving web build' : 'no web build found (dev mode: use Vite)')
  }

  return {
    app, registry, scenes, bus, hub, host, house, automations,
    startPlugins: () => host.startAll(),
    async close() {
      automations.close()                 // plus rien ne se déclenche pendant l'arrêt
      setPlaybackBridge(null)
      music.stop()
      await host.stopAll()
      seeder.close()
      hub.close()
      history.close()
      await app.close()
    },
  }
}
