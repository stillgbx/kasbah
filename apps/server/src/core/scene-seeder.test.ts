import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ManualClock } from '@kasbah/mock-sim'
import pino from 'pino'
import { Bus } from './bus'
import { PluginSettingsStore } from './plugin-settings'
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
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-settings-'))
    const settings = new PluginSettingsStore(join(dir, 'settings.json'), logger)
    if (autoDynamicForNewScenes) await settings.set('hue', { autoDynamicForNewScenes: true })
    const bus = new Bus()
    const registry = new SceneRegistry(bus, new ManualClock(0))
    const updateScene = vi.fn(async () => undefined)
    const seeder = new SceneSeeder({ bus, settings, updateScene, logger })
    return { dir, registry, updateScene, seeder, settings }
  }

  it('takes the first list as a baseline and writes nothing, even with the default on', async () => {
    const h = await harness(true)
    try {
      h.registry.register('hue', [scene('a', true), scene('b', true, true), scene('c', false)])
      await flush()
      expect(h.updateScene).not.toHaveBeenCalled()
    } finally { h.seeder.close(); await rm(h.dir, { recursive: true, force: true }) }
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
    } finally { h.seeder.close(); await rm(h.dir, { recursive: true, force: true }) }
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
      await h.settings.set('hue', { autoDynamicForNewScenes: true })
      h.registry.register('hue', [scene('a', true), scene('b', true)])
      await flush()
      expect(h.updateScene).not.toHaveBeenCalled()
    } finally { h.seeder.close(); await rm(h.dir, { recursive: true, force: true }) }
  })

  it('settings survive a reload and default to off for an unknown plugin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kasbah-settings-'))
    try {
      const path = join(dir, 'nested', 'settings.json')
      const first = new PluginSettingsStore(path, logger)
      await first.load()
      expect(first.get('hue').autoDynamicForNewScenes).toBe(false)
      await first.set('hue', { autoDynamicForNewScenes: true })
      const second = new PluginSettingsStore(path, logger)
      await second.load()
      expect(second.get('hue').autoDynamicForNewScenes).toBe(true)
      expect(second.get('somfy').autoDynamicForNewScenes).toBe(false)
      expect(second.all()).toEqual({ hue: { autoDynamicForNewScenes: true } })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
