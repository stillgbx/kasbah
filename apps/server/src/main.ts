import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { buildApp, type KasbahApp } from './app'
import { loadEnv } from './config/env'
import { PropertyCatalog } from './config/catalog'
import type { PropertyEntry, PropertyHost } from './config/properties'
import { createLogger } from './core/logger'

// Point d'entrée : .env (apps/server/.env) → env validé → app → plugins → écoute → arrêt propre.

const here = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(here, '../.env'), quiet: true })
loadDotenv({ path: resolve(here, '../../.env'), quiet: true }) // repli : .env à côté de dist/

// Sans `KASBAH_HOUSE_FILE`, le serveur ouvre son CATALOGUE (`config/catalog.ts`) : les démonstrations
// (`house/demos/`, en lecture seule) et les propriétés réelles du poste (`house/properties/`), une
// seule vivante à la fois, en mode démo ou réel. Avec, il fait vivre ce seul fichier : c'est le
// forçage (tests, previews, une installation qui veut une maison imposée).
const forced = !!process.env.KASBAH_HOUSE_FILE
const env = loadEnv()
const logger = createLogger(env.KASBAH_LOG_LEVEL, env.KASBAH_LOG_PRETTY || process.stdout.isTTY === true)

const catalog = forced ? null : await PropertyCatalog.open()
let active: PropertyEntry | undefined = catalog?.active

let kasbah: KasbahApp
let switching = false
let closing = false

/** Assemble, écoute et démarre l'application sur la maison courante. */
async function start(): Promise<void> {
  const properties: PropertyHost | undefined = catalog ? {
    // le nom de la propriété ouverte est celui de son fichier, tel que l'UI vient peut-être de l'écrire
    list: () => {
      const l = catalog.list()
      return { ...l, properties: l.properties.map((p) => (p.id === active?.id ? { ...p, name: kasbah.house.house.name } : p)) }
    },
    // la bascule se fait APRÈS l'envoi de la réponse
    select: (id) => { setTimeout(() => void catalog.choose(id).then((next) => next && switchTo(next)), 50) },
    setMode: (mode) => { setTimeout(() => void catalog.chooseMode(mode).then((next) => next && switchTo(next)), 50) },
    has: (id) => !!catalog.find(id),
    create: (body) => catalog.create(body),
    duplicate: (id, name) => catalog.duplicate(id, name),
  } : undefined
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
  logger.info({ port: env.KASBAH_PORT, plugins: Object.entries(kasbah.house.house.plugins).filter(([, p]) => p.enabled).map(([id]) => id), house: kasbah.house.house.name, ...(catalog ? { mode: catalog.mode, property: active?.id } : {}) }, 'kasbah server listening')
  await kasbah.startPlugins()
}

/** Bascule de propriété (ou de mode) : on arrête tout, puis on reconstruit sur l'autre maison. */
async function switchTo(next: PropertyEntry): Promise<void> {
  if (next.id === active?.id || switching || closing) return
  switching = true
  try {
    logger.info({ from: active?.id, to: next.id, mode: catalog?.mode }, 'switching property')
    // les écrans gardent des connexions ouvertes (proxy de Vite, requêtes en cours) que `close()`
    // attendrait : passé une seconde, on les coupe — ils se reconnectent à l'autre maison
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
