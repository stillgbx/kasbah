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
  it('parses scene messages and defaults a snapshot without scenes', () => {
    const snap = serverMessageSchema.parse({ type: 'snapshot', serverTime: 1, devices: [] })
    expect(snap.type === 'snapshot' && snap.scenes).toEqual([])
    const scenes = serverMessageSchema.parse({
      type: 'scenes',
      scenes: [{
        scene: { id: 'hue:s1', pluginId: 'hue', externalId: 's1', name: 'Starlight', group: { name: 'Salon', kind: 'room' }, dynamic: true, swatches: ['#ff8800'] },
        state: { active: 'dynamic', updatedAt: 2 },
      }],
    })
    expect(scenes.type === 'scenes' && scenes.scenes[0]!.scene.dynamic).toBe(true)
    expect(serverMessageSchema.safeParse({ type: 'scene', sceneId: 'nope', state: { active: 'static', updatedAt: 1 } }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ type: 'scene', sceneId: 'hue:s1', state: { active: 'nope', updatedAt: 1 } }).success).toBe(false)
  })
  it('rejects unknown types and mismatched states', () => {
    expect(serverMessageSchema.safeParse({ type: 'nope' }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ type: 'state', deviceId: 'mock:a', state: { kind: 'light' } }).success).toBe(false)
  })
  it('parses health', () => {
    expect(healthResponseSchema.parse({ ok: true, uptimeS: 3, clients: 0, plugins: { mock: { status: 'ok' } } }).plugins.mock?.status).toBe('ok')
  })
})
