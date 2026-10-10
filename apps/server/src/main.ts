import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { buildApp, type KasbahApp } from './app'
import { loadEnv } from './config/env'
import { createLocalProperty, duplicateProperty, loadDemoProperties, loadLocalProperties, readActiveDemo, writeActiveDemo, type PropertyEntry, type PropertyHost } from './config/properties'
import { createLogger } from './core/logger'

// Point d'entrée : .env (apps/server/.env) → env validé → app → plugins → écoute → arrêt propre.

const here = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(here, '../.env'), quiet: true })
loadDotenv({ path: resolve(here, '../../.env'), quiet: true }) // repli : .env à côté de dist/

// Sans `KASBAH_HOUSE_FILE`, le serveur est une DÉMONSTRATION : il propose les propriétés de
// `house/demos/` (en lecture seule) et celles créées ou dupliquées sur ce poste (`house/properties/`),
// et fait vivre celle qu'on choisit (scénario mock lu dans la maison). Avec, il fait vivre ce seul
// fichier, comme toujours.
const demo = !process.env.KASBAH_HOUSE_FILE
const env = loadEnv()
const logger = createLogger(env.KASBAH_LOG_LEVEL, env.KASBAH_LOG_PRETTY || process.stdout.isTTY === true)

const demos: PropertyEntry[] = demo ? (await loadDemoProperties()).map((d) => ({ ...d, demo: true })) : []
let locals: PropertyEntry[] = demo ? await loadLocalProperties() : []
/** Les propriétés du poste d'abord, puis les démonstrations. */
const all = (): PropertyEntry[] => [...locals, ...demos]
let active: PropertyEntry | undefined
if (demo) {
  const remembered = await readActiveDemo()
  active = all().find((p) => p.id === remembered) ?? demos[0]
}

let kasbah: KasbahApp
let switching = false
let closing = false

/** Assemble, écoute et démarre l'application sur la maison courante. */
async function start(): Promise<void> {
  const properties: PropertyHost | undefined = active && {
    list: () => ({
      activeId: active!.id, switchable: true, canCreate: true,
      properties: all().map(({ id, name, kind, demo: isDemo }) => ({ id, name, kind, ...(isDemo ? { demo: true } : {}) })),
    }),
    select: (id) => { setTimeout(() => void switchTo(id), 50) },   // après l'envoi de la réponse
    create: async (body) => {
      const id = await createLocalProperty(body, all().map((p) => p.id))
      locals = await loadLocalProperties()
      return id
    },
    duplicate: async (id, name) => {
      const source = all().find((p) => p.id === id)
      if (!source) throw Object.assign(new Error(`unknown property "${id}"`), { statusCode: 404, code: 'NOT_FOUND' })
      const copy = await duplicateProperty(source, name, all().map((p) => p.id))
      locals = await loadLocalProperties()
      return copy
    },
  }
  // l'hiver demandé par `MOCK_SCENARIO=winter` vaut pour la propriété : son parc en version d'hiver
  const scenario = active?.scenario && (process.env.MOCK_SCENARIO === 'winter' ? `${active.scenario}-winter` : active.scenario)
  kasbah = await buildApp({
    env: active ? { ...env, KASBAH_HOUSE_FILE: active.path } : env,
    logger,
    ...(scenario ? { envSource: { ...process.env, MOCK_SCENARIO: scenario } } : {}),
    ...(properties ? { properties } : {}),
    ...(active?.demo ? { readOnly: true } : {}),
  })
  await kasbah.app.listen({ port: env.KASBAH_PORT, host: env.KASBAH_HOST })
  logger.info({ port: env.KASBAH_PORT, plugins: Object.entries(kasbah.house.house.plugins).filter(([, p]) => p.enabled).map(([id]) => id), house: kasbah.house.house.name, ...(active ? { demo: active.id } : {}) }, 'kasbah server listening')
  await kasbah.startPlugins()
}

/** Bascule de propriété démo : on arrête tout, puis on reconstruit sur l'autre maison. */
async function switchTo(id: string): Promise<void> {
  const next = all().find((p) => p.id === id)
  if (!next || next.id === active?.id || switching || closing) return
  switching = true
  try {
    logger.info({ from: active?.id, to: next.id }, 'switching demo property')
    // les écrans gardent des connexions ouvertes (proxy de Vite, requêtes en cours) que `close()`
    // attendrait : passé une seconde, on les coupe — ils se reconnectent à l'autre maison
    const old = kasbah
    const cut = setTimeout(() => old.app.server.closeAllConnections(), 1000)
    try { await old.close() } finally { clearTimeout(cut) }
    active = next
    await writeActiveDemo(next.id)
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
