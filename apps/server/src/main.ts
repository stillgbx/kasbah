import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadDotenv } from 'dotenv'
import { buildApp } from './app'
import { loadEnv } from './config/env'
import { createLogger } from './core/logger'

// Point d'entrée : .env (apps/server/.env) → env validé → app → plugins → écoute → arrêt propre.

const here = dirname(fileURLToPath(import.meta.url))
loadDotenv({ path: resolve(here, '../.env'), quiet: true })
loadDotenv({ path: resolve(here, '../../.env'), quiet: true }) // repli : .env à côté de dist/

const env = loadEnv()
const logger = createLogger(env.KASBAH_LOG_LEVEL, env.KASBAH_LOG_PRETTY || process.stdout.isTTY === true)

const kasbah = await buildApp({ env, logger })
await kasbah.app.listen({ port: env.KASBAH_PORT, host: env.KASBAH_HOST })
logger.info({ port: env.KASBAH_PORT, plugins: Object.entries(kasbah.house.house.plugins).filter(([, p]) => p.enabled).map(([id]) => id), house: kasbah.house.house.name }, 'kasbah server listening')
await kasbah.startPlugins()

let closing = false
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
