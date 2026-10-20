import type { PluginSceneEntry, PluginSettings } from '@kasbah/shared'
import type { Logger } from 'pino'
import type { Bus } from './bus'

// Initializes the "Starts animated" setting of light scenes THAT APPEAR, with the plugin's default.
// Triggering on appearance (rather than on a stored inventory) guarantees the intended rule by
// construction: what exists is NEVER modified, including after a restart — the first list received
// serves as the reference snapshot, without writing anything.
//
// Counts as "appeared": a new light scene created at the vendor, or an existing light scene that
// just got a palette (it then joins the set of animated ones).
// Accepted blind spot: a light scene created while the server is stopped is seen as existing.

export interface SceneSeederDeps {
  bus: Bus
  /** The plugin's settings in the house (`house.plugins`). */
  settingsOf: (pluginId: string) => PluginSettings
  /** Write at the vendor (`PluginHost.updateScene`). */
  updateScene: (sceneId: string, update: { autoDynamic: boolean }) => Promise<void>
  logger: Logger
}

export class SceneSeeder {
  /** pluginId → ids of the animated light scenes already known. */
  private readonly known = new Map<string, Set<string>>()
  private readonly unsubscribe: () => void

  constructor(private readonly deps: SceneSeederDeps) {
    this.unsubscribe = deps.bus.on('scenes', (entries) => { void this.onScenes(entries) })
  }

  private async onScenes(entries: PluginSceneEntry[]): Promise<void> {
    const byPlugin = new Map<string, PluginSceneEntry[]>()
    for (const e of entries) {
      if (!e.scene.dynamic) continue
      const arr = byPlugin.get(e.scene.pluginId)
      if (arr) arr.push(e)
      else byPlugin.set(e.scene.pluginId, [e])
    }
    for (const [pluginId, animated] of byPlugin) {
      const ids = new Set(animated.map((e) => e.scene.id))
      const baseline = this.known.get(pluginId)
      this.known.set(pluginId, ids)
      if (!baseline) continue                                   // reference snapshot: nothing is written
      if (!this.deps.settingsOf(pluginId).autoDynamicForNewScenes) continue
      for (const e of animated) {
        if (baseline.has(e.scene.id) || e.scene.autoDynamic) continue
        try {
          await this.deps.updateScene(e.scene.id, { autoDynamic: true })
          this.deps.logger.info({ sceneId: e.scene.id, name: e.scene.name }, 'new animated scene: auto-dynamic applied')
        } catch (err) {
          this.deps.logger.warn({ err, sceneId: e.scene.id }, 'could not apply auto-dynamic to a new scene')
        }
      }
    }
  }

  close(): void { this.unsubscribe() }
}
