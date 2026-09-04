import { existsSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/**
 * Sert le build de l'app web (prod) avec repli SPA : toute requête GET hors /api et /ws
 * renvoie index.html. Silencieux si le dossier n'existe pas (mode dev, Vite sert l'app).
 */
export async function registerStatic(app: FastifyInstance, dir: string): Promise<boolean> {
  if (!existsSync(join(dir, 'index.html'))) return false
  await app.register(fastifyStatic, { root: dir, wildcard: true, index: ['index.html'] })
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `route ${req.method} ${req.url} not found` } })
  })
  return true
}
