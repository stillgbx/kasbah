import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLUGIN_SETTINGS } from '@kasbah/shared'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { Bus } from './bus'
import { SceneRegistry } from './scene-registry'
import { SceneSeeder } from './scene-seeder'

const flush = () => new Promise((r) => setTimeout(r, 0))
const logger = pino({ level: 'silent' })

const scene = (id: string, dynamic: boolean, autoDynamic = false) => ({
  id: `hue:${id}`, pluginId: 'hue', externalId: id, name: id, dynamic, autoDynamic, swatches: [],
})

/** Règle : le défaut s'applique aux ambiances QUI APPARAISSENT, jamais à celles déjà connues. */
describe('scene seeder', () => {
  async function harness(autoDynamicForNewScenes: boolean) {
    // le réglage vit dans house.json : ici une valeur qu'on peut changer en cours de test
    const settings = { ...DEFAULT_PLUGIN_SETTINGS, enabled: true, autoDynamicForNewScenes }
    const settingsOf = () => settings
    const bus = new Bus()
    const registry = new SceneRegistry(bus, new ManualClock(0))
    const updateScene = vi.fn(async () => undefined)
    const seeder = new SceneSeeder({ bus, settingsOf, updateScene, logger })
    return { registry, updateScene, seeder, settings }
  }

  it('takes the first list as a baseline and writes nothing, even with the default on', async () => {
    const h = await harness(true)
    try {
      h.registry.register('hue', [scene('a', true), scene('b', true, true), scene('c', false)])
      await flush()
      expect(h.updateScene).not.toHaveBeenCalled()
    } finally { h.seeder.close() }
  })

  it('applies the default to a scene that appears, and only to it', async () => {
    const h = await harness(true)
    try {
      h.registry.register('hue', [scene('a', true), scene('b', true, true)])
      await flush()
      // « nouvelle » = créée chez le fabricant (d) OU qui vient de gagner une palette (c)
      h.registry.register('hue', [scene('a', true), scene('b', true, true), scene('c', true), scene('d', true, true)])
      await flush()
      expect(h.updateScene.mock.calls).toEqual([['hue:c', { autoDynamic: true }]])
    } finally { h.seeder.close() }
  })

  it('writes nothing when the plugin default is off', async () => {
    const h = await harness(false)
    try {
      h.registry.register('hue', [scene('a', true)])
      await flush()
      h.registry.register('hue', [scene('a', true), scene('b', true)])
      await flush()
      expect(h.updateScene).not.toHaveBeenCalled()
      // …et l'activer plus tard ne rattrape PAS les ambiances déjà connues
      h.settings.autoDynamicForNewScenes = true
      h.registry.register('hue', [scene('a', true), scene('b', true)])
      await flush()
      expect(h.updateScene).not.toHaveBeenCalled()
    } finally { h.seeder.close() }
  })

})
