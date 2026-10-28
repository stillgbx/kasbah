import { assertCommandAllowed, CommandNotAllowedError, inverseCommand, type Automation, type AutomationRun, type Command, type DeviceId } from '@kasbah/shared'
import { PluginError } from '../plugin'
import type { PluginHost } from '../plugin-host'
import type { PushService } from '../push/service'
import type { SceneRegistry } from '../scene-registry'
import type { EvalContext } from './context'
import { resolveTarget } from './evaluate'

// Running an automation's actions. The same path as a command sent from the interface
// (`POST /api/devices/:id/command`): the command is checked against what the device declares
// (`assertCommandAllowed`) before going to its plugin — never skipped.
//
// Actions run IN ORDER (close the shutters, then start the music); the devices of a single action
// go out together. A failure stops nothing: we do everything that can be done, and the report says
// what failed. It says "acknowledged", never "done": a vendor that acknowledges has not
// necessarily executed (see the iRobot and PetKit lessons in the wiki).

export interface RunnerDeps {
  host: Pick<PluginHost, 'execute' | 'recallScene'>
  scenes: Pick<SceneRegistry, 'get'>
  /** Push notifications (the "Notify" action); absent = refused. */
  push?: Pick<PushService, 'send'>
}

type RunError = AutomationRun['errors'][number]

/** "For N minutes": the inverse command to send to a device, and when. */
export interface PendingRevert {
  automationId: string
  /** Rank of the action in the list. */
  action: number
  deviceId: DeviceId
  command: Command
  dueAt: number
}

export interface RunResult {
  run: AutomationRun
  /** Reverts to schedule: one per device that acknowledged a "for N minutes" action. */
  reverts: PendingRevert[]
}

function codeOf(err: unknown): string {
  if (err instanceof PluginError || err instanceof CommandNotAllowedError) return err.code
  return 'INTERNAL'
}

export async function runActions(a: Automation, by: AutomationRun['by'], ctx: EvalContext, deps: RunnerDeps): Promise<RunResult> {
  const errors: RunError[] = []
  const reverts: PendingRevert[] = []
  let attempted = 0

  for (const [i, action] of a.actions.entries()) {
    if (action.type === 'notify') {
      attempted++
      if (!deps.push) { errors.push({ action: i, code: 'NOT_IMPLEMENTED', message: 'no push notifications on this server' }); continue }
      // no subscribed screen is not a failure: nobody asked to be told
      try {
        const r = await deps.push.send('automations', () => ({ title: a.name, body: action.message, tag: `automation|${a.id}`, url: '/' }))
        if (r.failed && !r.sent) errors.push({ action: i, code: 'UPSTREAM_ERROR', message: `notification not delivered to ${r.failed} screen(s)` })
      } catch (err) { errors.push({ action: i, code: codeOf(err), message: (err as Error).message }) }
      continue
    }
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
    const inverse = action.forMin ? inverseCommand(action.command) : undefined
    results.forEach((r, k) => {
      const deviceId = entries[k]!.descriptor.id
      if (r.status === 'rejected') errors.push({ action: i, deviceId, code: codeOf(r.reason), message: (r.reason as Error).message })
      else if (inverse) reverts.push({ automationId: a.id, action: i, deviceId, command: inverse, dueAt: ctx.now + action.forMin! * 60_000 })
    })
  }

  // No target (all rooms excluded, no shutter tonight) is not a failure: nothing to do.
  const outcome = !errors.length ? 'ok' : errors.length >= attempted ? 'failed' : 'partial'
  return { run: { at: ctx.now, by, outcome, errors }, reverts }
}
