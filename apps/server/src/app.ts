import { pluginSettingsOf } from '@kasbah/shared'
import fastifyCompress from '@fastify/compress'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { registerAssistantRoutes } from './assistant/assistant'
import type { Env } from './config/env'
import { loadHouse, type LoadedHouse } from './config/house'
import type { PropertyHost } from './config/properties'
import { AutomationEngine } from './core/automations/engine'
import { createRevertsFile } from './core/automations/reverts'
import { automationsPathFor, createAutomationsFile } from './core/automations/store'
import { Bus } from './core/bus'
import { systemClock, type Clock } from './core/clock'
import type { PluginFactory } from './core/plugin'
import { PluginHost } from './core/plugin-host'
import { AlertNotifier } from './core/push/alerts'
import { PushService } from './core/push/service'
import { stateFile } from './core/paths'
import { DeviceRegistry } from './core/registry'
import { SceneRegistry } from './core/scene-registry'
import { SceneSeeder } from './core/scene-seeder'
import { ShoppingService, shoppingPathFor } from './core/shopping'
import { EnergyHistory } from './core/history'
import { registerDiagRoutes } from './http/diag'
import { registerPushRoutes } from './http/push'
import { registerRoutes } from './http/routes'
import { registerSystemRoutes, type SystemRoutesDeps } from './http/system'
import { actAsHook, createAppSession, sessionConfigSchema } from './http/session'
import { readAppBuild, registerStatic } from './http/static'
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
  /** House already loaded (tests); otherwise read from env.KASBAH_HOUSE_FILE. */
  house?: LoadedHouse
  serveStatic?: boolean
  /** Properties to switch between (demo server); absent = a single house. */
  properties?: PropertyHost
  /** The house is a demo: neither it nor its automations are written. */
  readOnly?: boolean
  /** Channel to the production supervisor (`scripts/supervisor.mjs`): the update from Settings. */
  supervisor?: SystemRoutesDeps['supervisor']
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
  /** Starts the plugins (after app.ready()/listen so that the routes are ready). */
  startPlugins(): Promise<void>
  close(): Promise<void>
}

/** Assembles the application without listening: used by main.ts and by the tests (app.inject). */
export async function buildApp(opts: BuildAppOptions): Promise<KasbahApp> {
  const clock = opts.clock ?? systemClock
  // the pino child specializes the instance's generic type: we go back to the nominal FastifyInstance
  const app = Fastify({
    loggerInstance: opts.logger.child({ component: 'http' }, { level: 'warn' }),
    // Fastify's default (100 characters per URL parameter, otherwise 414) is too short for Google
    // Nest ids: `nest:<id>` is 99 characters and the house id derived by auto-placement
    // (`auto.nest-<id>`) 104 — Move mode failed with 414 on any auto-placed camera.
    // Fastify 5: router options live in `routerOptions` (FSTDEP022 otherwise).
    routerOptions: { maxParamLength: 512 },
  }) as unknown as FastifyInstance
  // Under the public name: the MCP with its tokens, the rest behind a session. Set BEFORE any route.
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
  app.addHook('onRequest', publicHostFilter(mcpAuth.publicHosts, session.gate, mcpConfig.KASBAH_LAN_HOSTS))
  app.addHook('onRequest', actAsHook)
  const house = opts.house ?? (await loadHouse(opts.env.KASBAH_HOUSE_FILE))
  if (opts.readOnly) house.readOnly = true
  for (const w of house.warnings) opts.logger.warn({ path: w.path, code: w.code }, w.message)

  const bus = new Bus()
  const registry = new DeviceRegistry(bus, clock, opts.logger.child({ component: 'registry' }))
  const scenes = new SceneRegistry(bus, clock, opts.logger.child({ component: 'scenes' }))
  // Per-plugin settings: they live IN the house (`house.plugins`), written by the UI. `house` is
  // mutated in place by `updateHouseFile`, so this read always sees the current value.
  const settingsOf = (pluginId: string) => pluginSettingsOf(house.house.plugins, pluginId)
  const history = new EnergyHistory(bus, clock)
  // Push notifications: the subscribed screens, the alerts of the house, the "Notify" action.
  const push = new PushService({
    path: stateFile('push.json'),
    subject: mcpConfig.MCP_PUBLIC_URL ?? 'mailto:kasbah@localhost',
    accounts: async () => (await mcpAuth.users()).users.map((u) => u.name),
    logger: opts.logger.child({ component: 'push' }),
    now: () => clock.now(),
  })
  await push.load()
  const host = new PluginHost({
    settingsOf,
    site: () => house.house.origin,
    strict: opts.env.KASBAH_STRICT_PLUGINS,
    factories: opts.factories ?? PLUGIN_FACTORIES,
    registry, scenes, bus, clock, logger: opts.logger,
    ...(opts.envSource ? { envSource: opts.envSource } : {}),
    commandTimeoutMs: opts.env.KASBAH_COMMAND_TIMEOUT_MS,
  })

  // Automations: a file next to the house, run here (the screen sleeps, the server doesn't). After
  // `host`, through which commands go; before the hub, whose snapshot carries them.
  const automations = new AutomationEngine({
    store: createAutomationsFile(automationsPathFor(house.path), { readOnly: !!opts.readOnly }),
    reverts: createRevertsFile(stateFile('automation-reverts.json')),
    registry, scenes, host, house, bus, clock, push, logger: opts.logger.child({ component: 'automations' }),
  })
  const alerts = new AlertNotifier({
    bus, registry, health: () => host.health(), push, clock, path: stateFile('push-alerts.json'),
    logger: opts.logger.child({ component: 'push' }),
  })
  await alerts.start()
  // Shopping list: a file next to the house, read before the hub, whose snapshot carries it.
  const shopping = new ShoppingService(shoppingPathFor(house.path), { readOnly: !!opts.readOnly })
  await shopping.load()
  const hub = new WsHub(registry, bus, clock, opts.logger.child({ component: 'ws' }), {
    scenes, automations, shopping, propertyId: () => house.house.id,
    // web build served, re-read on each connection; without static serving, no build to compare
    ...((opts.serveStatic ?? true) ? { appBuild: () => readAppBuild(opts.env.KASBAH_STATIC_DIR) } : {}),
  })
  automations.onChange(() => hub.broadcast({ type: 'automations', automations: automations.list() }))
  shopping.onChange((list) => hub.broadcast({ type: 'shopping', shopping: list }))
  await automations.start()

  await hub.attach(app)
  // initializes the setting of light scenes that APPEAR (never the existing ones) — after `host`,
  // whose vendor write it uses
  const seeder = new SceneSeeder({
    bus, settingsOf, logger: opts.logger.child({ component: 'scenes' }),
    updateScene: (sceneId, update) => host.updateScene(sceneId, update),
  })

  // Response compression, BEFORE the routes: the `onSend` hook only applies to what is registered
  // after it. Most of the gain is on the web bundle and the 3D car bodies (`model/gltf-binary`,
  // which mime-db already lists as compressible) — 815 KB of models drop to about 550 KB.
  // Non-compressible types (JPEG of a camera snapshot, video stream) are left alone by default, and
  // the WebSocket does not go through this hook.
  await app.register(fastifyCompress, { global: true })

  registerRoutes(app, { registry, scenes, host, house, hub, history, automations, shopping, startedAt: clock.now(), ...(opts.properties ? { properties: opts.properties } : {}) })
  host.registerRoutes(app)
  registerPushRoutes(app, push)
  registerSystemRoutes(app, { supervisor: opts.supervisor, statusFile: stateFile('update-status.json') })
  registerDiagRoutes(app, opts.logger.child({ component: 'diag' }))
  await registerMcp(app, { registry, scenes, host, house, auth: mcpAuth })
  registerMcpUserRoutes(app, { usersFile: mcpConfig.MCP_USERS_FILE })
  registerAssistantRoutes(app, {
    auth: mcpAuth,
    mcpUrl: `http://127.0.0.1:${opts.env.KASBAH_PORT}/mcp`,
    logger: opts.logger.child({ component: 'assistant' }),
  })
  session.routes(app)
  // Music sources have no devices: for `play_url` they go through Cast/Sonos via the host.
  setPlaybackBridge({
    getDevice: (id) => registry.get(id),
    execute: (id, command) => host.execute(id, command),
    onState: (cb) => bus.on('state', cb),
  })
  // The SHARED player of the music sources (queue, LAN relay, transfer, local listening): sources
  // register with it when they start, it goes through the bridge above for the speakers.
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
      automations.close()                 // nothing fires anymore during shutdown
      await alerts.close()
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
