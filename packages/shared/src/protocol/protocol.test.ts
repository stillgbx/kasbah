import { describe, expect, it } from 'vitest'
import { serverMessageSchema } from './ws'
import { healthResponseSchema } from './http'

describe('ws protocol', () => {
  it('parses a snapshot', () => {
    const msg = serverMessageSchema.parse({
      type: 'snapshot', serverTime: 1,
      devices: [{
        descriptor: { id: 'mock:a', pluginId: 'mock', externalId: 'a', kind: 'sensor', name: 'T', capabilities: ['measure'] },
        state: { kind: 'sensor', updatedAt: 1, available: true, value: 21.5 },
      }],
    })
    expect(msg.type).toBe('snapshot')
  })
  it('rejects unknown types and mismatched states', () => {
    expect(serverMessageSchema.safeParse({ type: 'nope' }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ type: 'state', deviceId: 'mock:a', state: { kind: 'light' } }).success).toBe(false)
  })
  it('parses health', () => {
    expect(healthResponseSchema.parse({ ok: true, uptimeS: 3, clients: 0, plugins: { mock: { status: 'ok' } } }).plugins.mock?.status).toBe('ok')
  })
})
