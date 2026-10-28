import { pushEndpointBodySchema, pushSubscribeBodySchema } from '@kasbah/shared'
import type { FastifyInstance } from 'fastify'
import type { PushService } from '../core/push/service'
import { textsFor } from '../core/push/texts'
import { sendError } from './errors'

// Push notifications of a screen: the server's public key, subscribing (with its categories),
// unsubscribing, and a test sent to this screen only. Behind the session under the public name,
// like the rest of the app: a subscription remembers its account (`req.sessionUser`).

export function registerPushRoutes(app: FastifyInstance, push: PushService): void {
  app.get('/api/push/key', async () => ({ publicKey: push.publicKey() }))

  app.put('/api/push/subscription', async (req) => {
    await push.subscribe(pushSubscribeBodySchema.parse(req.body), req.sessionUser)
    return { ok: true }
  })

  // an unknown subscription is already gone: nothing to refuse
  app.delete('/api/push/subscription', async (req) => {
    const { endpoint } = pushEndpointBodySchema.parse(req.body)
    await push.unsubscribe(endpoint)
    return { ok: true }
  })

  app.post('/api/push/test', async (req, reply) => {
    const { endpoint } = pushEndpointBodySchema.parse(req.body)
    if (!push.has(endpoint)) return sendError(reply, 404, 'NOT_FOUND', 'no such subscription')
    const result = await push.sendTo(endpoint, (lang) => ({ title: textsFor(lang).testTitle, body: textsFor(lang).testBody, tag: 'test', url: '/settings' }))
    return result.sent ? result : sendError(reply, 502, 'UPSTREAM_ERROR', 'the push service refused the notification')
  })
}
