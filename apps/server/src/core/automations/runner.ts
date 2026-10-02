import { assertCommandAllowed, CommandNotAllowedError, type Automation, type AutomationRun } from '@kasbah/shared'
import { PluginError } from '../plugin'
import type { PluginHost } from '../plugin-host'
import type { SceneRegistry } from '../scene-registry'
import type { EvalContext } from './context'
import { resolveTarget } from './evaluate'

// Exécution des actions d'une automatisation. Le même chemin qu'une commande envoyée depuis
// l'interface (`POST /api/devices/:id/command`) : la commande est vérifiée contre ce que l'appareil
// déclare (`assertCommandAllowed`) avant d'aller à son plugin — jamais sautée.
//
// Les actions s'enchaînent DANS L'ORDRE (fermer les volets, puis lancer la musique) ; les appareils
// d'une même action partent ensemble. Un échec n'arrête rien : on fait tout ce qui peut l'être, et
// le compte rendu dit ce qui a raté. Il dit « accusé », jamais « fait » : un fabricant qui acquitte
// n'a pas forcément exécuté (voir les leçons iRobot et PetKit du wiki).

export interface RunnerDeps {
  host: Pick<PluginHost, 'execute' | 'recallScene'>
  scenes: Pick<SceneRegistry, 'get'>
}

type RunError = AutomationRun['errors'][number]

function codeOf(err: unknown): string {
  if (err instanceof PluginError || err instanceof CommandNotAllowedError) return err.code
  return 'INTERNAL'
}

export async function runActions(a: Automation, by: AutomationRun['by'], ctx: EvalContext, deps: RunnerDeps): Promise<AutomationRun> {
  const errors: RunError[] = []
  let attempted = 0

  for (const [i, action] of a.actions.entries()) {
    if (action.type === 'recallScene') {
      attempted++
      const entry = deps.scenes.get(action.sceneId)
      if (!entry) { errors.push({ action: i, code: 'SCENE_UNKNOWN', message: `unknown scene "${action.sceneId}"` }); continue }
      if (action.recall.mode === 'dynamic' && !entry.scene.dynamic) {
        errors.push({ action: i, code: 'UNSUPPORTED_COMMAND', message: `scene "${entry.scene.name}" has no animated palette` })
        continue
      }
      try { await deps.host.recallScene(entry.scene.id, action.recall) }
      catch (err) { errors.push({ action: i, code: codeOf(err), message: (err as Error).message }) }
      continue
    }

    const { entries, missing } = resolveTarget(action.target, ctx)
    for (const id of missing) {
      attempted++
      errors.push({ action: i, deviceId: id, code: 'DEVICE_UNKNOWN', message: `unknown device "${id}"` })
    }
    attempted += entries.length
    const results = await Promise.allSettled(entries.map(async (e) => {
      assertCommandAllowed(e.descriptor, action.command)
      await deps.host.execute(e.descriptor.id, action.command)
    }))
    results.forEach((r, k) => {
      if (r.status === 'rejected') errors.push({ action: i, deviceId: entries[k]!.descriptor.id, code: codeOf(r.reason), message: (r.reason as Error).message })
    })
  }

  // Aucune cible (toutes les pièces écartées, aucun volet ce soir) n'est pas un échec : rien à faire.
  const outcome = !errors.length ? 'ok' : errors.length >= attempted ? 'failed' : 'partial'
  return { at: ctx.now, by, outcome, errors }
}
