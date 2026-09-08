import type { PluginSceneEntry } from '@kasbah/shared'
import type { Logger } from 'pino'
import type { Bus } from './bus'
import type { PluginSettingsStore } from './plugin-settings'

// Initialise le réglage « démarrer animée » des ambiances QUI APPARAISSENT, avec le défaut du
// plugin. Déclencher sur l'apparition (et non sur un inventaire mémorisé) garantit par construction
// la règle voulue : l'existant n'est JAMAIS modifié, y compris après un redémarrage — la première
// liste reçue sert de photo de référence, sans rien écrire.
//
// Compte comme « apparue » : une nouvelle ambiance créée chez le fabricant, ou une ambiance
// existante à qui on vient d'ajouter une palette (elle entre alors dans l'ensemble des animées).
// Angle mort assumé : une ambiance créée pendant que le serveur est arrêté est vue comme existante.

export interface SceneSeederDeps {
  bus: Bus
  settings: PluginSettingsStore
  /** Écriture chez le fabricant (`PluginHost.updateScene`). */
  updateScene: (sceneId: string, update: { autoDynamic: boolean }) => Promise<void>
  logger: Logger
}

export class SceneSeeder {
  /** pluginId → ids des ambiances animées déjà connues. */
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
      if (!baseline) continue                                   // photo de référence : on n'écrit rien
      if (!this.deps.settings.get(pluginId).autoDynamicForNewScenes) continue
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
