import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { buildApp, type KasbahApp } from './app'
import { loadEnv } from './config/env'
import { PropertyCatalog } from './config/catalog'
import type { PropertyEntry, PropertyHost } from './config/properties'
import { createLogger } from './core/logger'
import type { UpdateRequest } from './http/system'

// Entry point: .env (apps/server/.env) → validated env → app → plugins → listen → clean shutdown.

const here = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(here, '../.env'), quiet: true })
loadDotenv({ path: resolve(here, '../../.env'), quiet: true }) // fallback: .env next to dist/

// Without `KASBAH_HOUSE_FILE`, the server opens its CATALOG (`config/catalog.ts`): the demos
// (`house/demos/`, read-only) and the machine's real properties (`house/properties/`), a single one
// live at a time, in demo or real mode. With it, it runs that one file only: that is the override
// (tests, previews, an installation that wants an imposed house).
const forced = !!process.env.KASBAH_HOUSE_FILE
const env = loadEnv()
const logger = createLogger(env.KASBAH_LOG_LEVEL, env.KASBAH_LOG_PRETTY || process.stdout.isTTY === true)

const catalog = forced ? null : await PropertyCatalog.open()
let active: PropertyEntry | undefined = catalog?.active

let kasbah: KasbahApp
let switching = false
let closing = false

/** Assembles, listens and starts the application on the current house. */
async function start(): Promise<void> {
  const properties: PropertyHost | undefined = catalog ? {
    // the name of the open property is that of its file, as the UI may just have written it
    list: () => {
      const l = catalog.list()
      return { ...l, properties: l.properties.map((p) => (p.id === active?.id ? { ...p, name: kasbah.house.house.name } : p)) }
    },
    // the switch happens AFTER the response is sent
    select: (id) => { setTimeout(() => void catalog.choose(id).then((next) => next && switchTo(next)), 50) },
    setMode: (mode) => { setTimeout(() => void catalog.chooseMode(mode).then((next) => next && switchTo(next)), 50) },
    has: (id) => !!catalog.find(id),
    create: (body) => catalog.create(body),
    duplicate: (id, name) => catalog.duplicate(id, name),
  } : undefined
  // the winter requested by `MOCK_SCENARIO=winter` applies to the property: its device set in winter version
  const scenario = active?.scenario && (process.env.MOCK_SCENARIO === 'winter' ? `${active.scenario}-winter` : active.scenario)
  kasbah = await buildApp({
    env: active ? { ...env, KASBAH_HOUSE_FILE: active.path } : env,
    logger,
    ...(process.send ? { supervisor: (msg: UpdateRequest) => process.send!(msg) } : {}),
    ...(scenario ? { envSource: { ...process.env, MOCK_SCENARIO: scenario } } : {}),
    ...(properties ? { properties } : {}),
    ...(active?.demo ? { readOnly: true } : {}),
  })
  await kasbah.app.listen({ port: env.KASBAH_PORT, host: env.KASBAH_HOST })
  logger.info({ port: env.KASBAH_PORT, plugins: Object.entries(kasbah.house.house.plugins).filter(([, p]) => p.enabled).map(([id]) => id), house: kasbah.house.house.name, ...(catalog ? { mode: catalog.mode, property: active?.id } : {}) }, 'kasbah server listening')
  await kasbah.startPlugins()
}

/** Property (or mode) switch: stop everything, then rebuild on the other house. */
async function switchTo(next: PropertyEntry): Promise<void> {
  if (next.id === active?.id || switching || closing) return
  switching = true
  try {
    logger.info({ from: active?.id, to: next.id, mode: catalog?.mode }, 'switching property')
    // screens keep connections open (Vite proxy, requests in flight) that `close()` would wait
    // for: after one second, we cut them — they reconnect to the other house
    const old = kasbah
    const cut = setTimeout(() => old.app.server.closeAllConnections(), 1000)
    try { await old.close() } finally { clearTimeout(cut) }
    active = next
    await start()
  } finally { switching = false }
}

await start()

async function shutdown(signal: string) {
  if (closing) return
  closing = true
  logger.info({ signal }, 'shutting down')
  const deadline = setTimeout(() => { logger.warn('forced exit'); process.exit(1) }, 8000)
  try { await kasbah.close() } finally { clearTimeout(deadline) }
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

// Under the production supervisor (`scripts/supervisor.mjs`): "ready" once the plugins are started
// (otherwise it goes back to the previous commit), clean shutdown on its request, and plain shutdown
// if it disappears (on Windows, killing a parent does not kill its children: the port would stay
// taken).
if (process.send) {
  process.send({ type: 'ready' })
  process.on('message', (m: { type?: string }) => { if (m?.type === 'shutdown') void shutdown('supervisor') })
  process.on('disconnect', () => void shutdown('supervisor gone'))
}
