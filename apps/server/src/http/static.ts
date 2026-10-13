import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/** Fichier que le build web écrit à sa racine : son identifiant (`apps/web/vite.config.ts`). */
const BUILD_ID_FILE = 'build-id.txt'

/**
 * Sert le build de l'app web (prod) avec repli SPA : toute requête GET hors /api, /ws et /assets
 * renvoie index.html. Silencieux si le dossier n'existe pas (mode dev, Vite sert l'app).
 * Un fichier absent de /assets (vue d'un build remplacé, demandée par un écran resté ouvert) est un
 * vrai 404 : index.html à sa place se lisait « type MIME text/html » dans la console.
 */
export async function registerStatic(app: FastifyInstance, dir: string): Promise<boolean> {
  if (!existsSync(join(dir, 'index.html'))) return false
  await app.register(fastifyStatic, { root: dir, wildcard: true, index: ['index.html'] })
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws') && !req.url.startsWith('/assets/')) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `route ${req.method} ${req.url} not found` } })
  })
  return true
}

/**
 * Identifiant du build web présent dans `dir`, relu à chaque appel : un build refait sans redémarrer
 * le serveur est vu à la connexion suivante. `undefined` sans build (dev) ou d'un build plus ancien.
 */
export function readAppBuild(dir: string): string | undefined {
  try { return readFileSync(join(dir, BUILD_ID_FILE), 'utf8').trim() || undefined } catch { return undefined }
}
