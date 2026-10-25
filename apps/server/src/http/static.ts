import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/** File the web build writes at its root: its identifier (`apps/web/vite.config.ts`). */
const BUILD_ID_FILE = 'build-id.txt'

/**
 * No other site may frame the app: a framed page sends its own requests, with the app's origin,
 * past the Origin check. `self` for `diag.html`, which frames it.
 */
const FRAME_HEADERS = { 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': "frame-ancestors 'self'" }

/**
 * Serves the web app build (prod) with SPA fallback: any GET request outside /api, /ws and /assets
 * returns index.html. Silent if the folder does not exist (dev mode, Vite serves the app).
 * A file missing from /assets (view of a replaced build, requested by a screen left open) is a
 * real 404: index.html in its place read as "MIME type text/html" in the console.
 */
export async function registerStatic(app: FastifyInstance, dir: string): Promise<boolean> {
  if (!existsSync(join(dir, 'index.html'))) return false
  await app.register(fastifyStatic, {
    root: dir, wildcard: true, index: ['index.html'],
    // also for the SPA fallback below: `sendFile` goes through it
    setHeaders: (reply, path) => { if (path.endsWith('.html')) reply.headers(FRAME_HEADERS) },
  })
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws') && !req.url.startsWith('/assets/')) {
      return reply.type('text/html').sendFile('index.html')
    }
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: `route ${req.method} ${req.url} not found` } })
  })
  return true
}

/**
 * Identifier of the web build present in `dir`, re-read on each call: a build redone without
 * restarting the server is seen at the next connection. `undefined` without a build (dev) or for an
 * older build.
 */
export function readAppBuild(dir: string): string | undefined {
  try { return readFileSync(join(dir, BUILD_ID_FILE), 'utf8').trim() || undefined } catch { return undefined }
}
