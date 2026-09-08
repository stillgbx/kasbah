import { pluginSceneSchema, type PluginScene, type PluginSceneEntry, type SceneActivation, type SceneId } from '@kasbah/shared'
import type { Logger } from 'pino'
import type { Bus } from './bus'
import type { Clock } from './clock'

// Registre des scènes des fabricants : liste + scène active. Beaucoup plus simple que le registre
// d'appareils (pas de patch : un seul champ change), mais une RÈGLE de concept s'y applique — une
// seule scène active par groupe. Les ponts n'émettent pas toujours la désactivation de la scène
// précédente ; sans cette règle l'UI en montrerait deux allumées à la fois.

export class SceneRegistry {
  private entries = new Map<SceneId, PluginSceneEntry>()

  constructor(private readonly bus: Bus, private readonly clock: Clock, private readonly logger?: Logger) {}

  /** Remplace l'ensemble des scènes d'un plugin. L'état des ids conservés survit. */
  register(pluginId: string, scenes: PluginScene[]): void {
    const keep = new Set<string>()
    const now = this.clock.now()
    const valid: PluginScene[] = []
    for (const s of scenes) {
      const check = pluginSceneSchema.safeParse(s)
      if (!check.success) { this.logger?.error({ sceneId: s.id, issues: check.error.issues }, 'invalid scene rejected'); continue }
      valid.push(check.data)
      keep.add(check.data.id)
    }
    for (const [id, e] of this.entries) if (e.scene.pluginId === pluginId && !keep.has(id)) this.entries.delete(id)
    for (const scene of valid) {
      const prev = this.entries.get(scene.id)
      this.entries.set(scene.id, { scene, state: prev?.state ?? { active: 'inactive', updatedAt: now } })
    }
    this.bus.emit('scenes', this.list())
  }

  get(id: SceneId): PluginSceneEntry | undefined { return this.entries.get(id) }
  list(): PluginSceneEntry[] { return [...this.entries.values()] }
  countOf(pluginId: string): number { return this.list().filter((e) => e.scene.pluginId === pluginId).length }

  /** Pose la scène active ; les autres scènes du même groupe redeviennent inactives. */
  setActive(id: SceneId, active: SceneActivation): boolean {
    const e = this.entries.get(id)
    if (!e) { this.logger?.debug({ sceneId: id }, 'activation of unknown scene ignored'); return false }
    const changed: SceneId[] = []
    const now = this.clock.now()
    if (e.state.active !== active) {
      this.entries.set(id, { scene: e.scene, state: { active, updatedAt: now } })
      changed.push(id)
    }
    if (active !== 'inactive') {
      for (const [otherId, other] of this.entries) {
        if (otherId === id || other.state.active === 'inactive') continue
        if (other.scene.pluginId !== e.scene.pluginId || other.scene.group?.name !== e.scene.group?.name) continue
        this.entries.set(otherId, { scene: other.scene, state: { active: 'inactive', updatedAt: now } })
        changed.push(otherId)
      }
    }
    for (const c of changed) this.bus.emit('scene', c, this.entries.get(c)!.state)
    return changed.length > 0
  }
}
