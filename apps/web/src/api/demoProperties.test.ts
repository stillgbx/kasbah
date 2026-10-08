import { beforeEach, describe, expect, it } from 'vitest'
import { parseHouse, type ServerMessage } from '@kasbah/shared'
import { createMockTransport } from './mockTransport'
import { activeDemoProperty, DEMO_PROPERTIES, demoPropertiesResponse, rememberDemoProperty } from './demoProperties'

// Mode démo sans serveur : la propriété retenue par le navigateur, la bascule, et ce que le parc
// simulé apporte de neuf (ambiances rappelables, propriété nommée dans le snapshot).

describe('demo properties (in-process)', () => {
  beforeEach(() => localStorage.clear())

  it('starts on the first property and remembers the chosen one', () => {
    expect(activeDemoProperty().id).toBe('tilleuls')
    rememberDemoProperty('belvedere')
    expect(activeDemoProperty().id).toBe('belvedere')
    rememberDemoProperty('ailleurs')
    expect(activeDemoProperty().id).toBe('tilleuls')
  })

  const transport = () => {
    const p = activeDemoProperty()
    return createMockTransport({
      scenario: p.scenario, house: parseHouse(p.house),
      properties: { list: () => demoPropertiesResponse(activeDemoProperty().id), select: rememberDemoProperty },
    })
  }

  it('lists the three properties and switches between them', async () => {
    const t = transport()
    expect((await t.getProperties()).properties.map((p) => p.id)).toEqual(DEMO_PROPERTIES.map((p) => p.id))
    await t.selectProperty('embruns')
    expect((await t.getProperties()).activeId).toBe('embruns')
    await expect(t.selectProperty('ailleurs')).rejects.toMatchObject({ status: 404 })
    await expect(createMockTransport().selectProperty('embruns')).rejects.toMatchObject({ status: 409 })
  })

  it('names the property in the snapshot and recalls a simulated scene', async () => {
    const t = transport()
    const msgs: ServerMessage[] = []
    const off = t.connect({ onMessage: (m) => msgs.push(m), onStatus: () => {} })
    const snap = msgs.find((m) => m.type === 'snapshot')
    expect(snap).toMatchObject({ propertyId: 'tilleuls' })
    expect((await t.getScenes()).map((s) => s.scene.name)).toContain('Lecture')
    await t.recallScene('mock:tl-scene-lecture', { mode: 'static' })
    expect(msgs).toContainEqual(expect.objectContaining({ type: 'scene', sceneId: 'mock:tl-scene-lecture', state: expect.objectContaining({ active: 'static' }) }))
    off()
  })
})
