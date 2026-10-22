import type { FastifyInstance } from 'fastify'
import type { Logger } from 'pino'
import { sendError } from './errors'

// Browser diagnostics. `diag.html` (apps/web/public) is a page with no framework, which even a weak
// browser (the car's) loads when the app does not: it reads the browser and its WebGL and posts the
// report here. The server writes it to its log, so it is read there and not copied off a screen.

/** A report weighs a few kilobytes: anything larger is not one. */
const BODY_LIMIT = 32 * 1024

export function registerDiagRoutes(app: FastifyInstance, logger: Logger): void {
  app.post('/api/diag', { bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const report = req.body
    if (!report || typeof report !== 'object' || Array.isArray(report)) return sendError(reply, 400, 'BAD_REQUEST', 'a JSON object is expected')
    logger.info({ ua: req.headers['user-agent'] ?? null, report }, 'browser diagnostics')
    return reply.code(204).send()
  })
}
