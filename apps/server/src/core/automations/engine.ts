import type { Automation, AutomationBody, AutomationEntry, AutomationRun, AutomationStatus, DeviceId } from '@kasbah/shared'
import { assertCommandAllowed, automationBodySchema } from '@kasbah/shared'
import type { Logger } from 'pino'
import type { LoadedHouse } from '../../config/house'
import type { Bus } from '../bus'
import type { Clock } from '../clock'
import type { DeviceRegistry } from '../registry'
import type { SceneRegistry } from '../scene-registry'
import { HouseView, type EvalContext } from './context'
import { evaluatePredicate, touches, type Tri } from './evaluate'
import type { RevertsStore } from './reverts'
import { runActions, type PendingRevert, type RunnerDeps, type RunResult } from './runner'
import { nextOccurrence } from './schedule'
import { computeStatus } from './status'
import type { AutomationsStore } from './store'

// Automation engine, on the server side (the screen sleeps, the server doesn't).
//
// TIME: a single timer, set on the nearest due time of all active automations, never further than
// 6 h (the sun is re-read every day, and `setTimeout` caps at 24.8 days). A due time missed while
// the server is down is not caught up.
//
// STATE: on each published state, the triggers that depend on that device are re-evaluated; only a
// FALSE → TRUE transition fires. A first reading, a device coming back, a restart start from
// "unknown" and therefore never fire. States produced by our own commands arrive later, on another
// turn: edge only, no loop.
//
// FOR N MINUTES: an action carrying `forMin` leaves, per device that acknowledged, a dated REVERT
// (the inverse command). They are recorded on disk (`reverts`) and survive a restart; a due revert
// goes out as soon as its device has published a state and answers — never on the default values
// of a device not read yet. A new trigger replaces the pending revert of the same device (the wait
// starts over). Neither deleting nor disabling the rule cancels it: the gate closes anyway.
//
// Each bus handler is guarded: `Bus.emit` catches nothing, and an exception here would bubble up
// into the plugin that published the state.

/** Longest wait of a single timer. */
const MAX_WAIT_MS = 6 * 3600_000

export interface AutomationEngineDeps extends RunnerDeps {
  store: AutomationsStore
  /** Pending "for N minutes" reverts; absent = kept in memory only. */
  reverts?: RevertsStore
  registry: DeviceRegistry
  scenes: SceneRegistry
  house: LoadedHouse
  bus: Bus
  clock: Clock
  logger: Logger
}

export class AutomationEngine {
  private readonly automations = new Map<string, Automation>()
  private readonly lastRun = new Map<string, AutomationRun>()
  private readonly nextRun = new Map<string, number>()
  private readonly pendingSince = new Map<string, number>()
  /** Last value of a state trigger's predicate; absent = never evaluated. */
  private readonly last = new Map<string, Tri>()
  private readonly holds = new Map<string, unknown>()
  private readonly running = new Set<string>()
  /** Pending reverts, by `automation#action#device`. */
  private readonly reverts = new Map<string, PendingRevert>()
  private revertTimer: unknown = null
  /** Devices that have published a state since they appeared: the others have the default values. */
  private readonly fresh = new Set<DeviceId>()
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribe: (() => void)[] = []
  private readonly view: HouseView
  private timer: unknown = null
  private lastSent = ''
  private closed = false

  constructor(private readonly deps: AutomationEngineDeps) {
    this.view = new HouseView(deps.house, deps.registry)
  }

  async start(): Promise<void> {
    for (const a of await this.deps.store.load()) this.automations.set(a.id, a)
    try { for (const r of (await this.deps.reverts?.load()) ?? []) this.reverts.set(revertKey(r), r) }
    catch (err) { this.deps.logger.warn({ err }, 'pending automation reverts unreadable, ignored') }
    const guard = <A extends unknown[]>(name: string, fn: (...args: A) => void) => (...args: A) => {
      try { fn(...args) } catch (err) { this.deps.logger.error({ err, event: name }, 'automation handler failed') }
    }
    const { bus } = this.deps
    this.unsubscribe.push(
      bus.on('state', guard('state', (id: DeviceId) => { this.fresh.add(id); this.onDevices([id]); this.runDueReverts() })),
      bus.on('availability', guard('availability', (ids: DeviceId[]) => { this.onDevices(ids); this.runDueReverts(); this.notify() })),
      bus.on('devices', guard('devices', (entries) => {
        const present = new Set(entries.map((e) => e.descriptor.id))
        for (const id of this.fresh) if (!present.has(id)) this.fresh.delete(id)
        this.view.invalidate()
        this.notify()
      })),
      bus.on('scenes', guard('scenes', () => this.notify())),
    )
    for (const a of this.automations.values()) this.baseline(a)
    this.arm()
    this.armReverts()
    this.deps.logger.info({ count: this.automations.size, reverts: this.reverts.size }, 'automations loaded')
  }

  close(): void {
    this.closed = true
    for (const u of this.unsubscribe) u()
    this.unsubscribe.length = 0
    if (this.timer) this.deps.clock.clearTimeout(this.timer)
    if (this.revertTimer) this.deps.clock.clearTimeout(this.revertTimer)
    for (const h of this.holds.values()) this.deps.clock.clearTimeout(h)
    this.holds.clear()
    this.listeners.clear()
  }

  /** Notified on each change of the list or of a status (the WS hub rebroadcasts). */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  list(): AutomationEntry[] {
    const ctx = this.context()
    return [...this.automations.values()].map((a) => this.entry(a, ctx))
  }

  get(id: string): AutomationEntry | undefined {
    const a = this.automations.get(id)
    return a ? this.entry(a, this.context()) : undefined
  }

  /**
   * Creates or replaces. The body is validated here too: the engine never keeps an invalid rule.
   * `byAssistant`: written by an assistant (MCP) in the name of this account; absent = from the app,
   * which clears the mark.
   */
  async upsert(id: string, body: AutomationBody, byAssistant?: { user?: string }): Promise<AutomationEntry> {
    const parsed = automationBodySchema.parse(body)
    const now = this.deps.clock.now()
    const a: Automation = { id, ...parsed, updatedAt: now, ...(byAssistant ? { byAssistant: { ...byAssistant, at: now } } : {}) }
    const before = this.automations.get(id)
    this.automations.set(id, a)
    try { await this.persist() }
    catch (err) { if (before) this.automations.set(id, before); else this.automations.delete(id); throw err }
    this.reset(a)
    this.notify()
    return this.entry(a, this.context())
  }

  async remove(id: string): Promise<boolean> {
    const before = this.automations.get(id)
    if (!before) return false
    this.automations.delete(id)
    try { await this.persist() }
    catch (err) { this.automations.set(id, before); throw err }
    this.forget(id)
    this.lastRun.delete(id)
    this.arm()
    this.notify()
    return true
  }

  async setEnabled(id: string, enabled: boolean): Promise<AutomationEntry | undefined> {
    const before = this.automations.get(id)
    if (!before) return undefined
    const a: Automation = { ...before, enabled, updatedAt: this.deps.clock.now() }
    this.automations.set(id, a)
    try { await this.persist() }
    catch (err) { this.automations.set(id, before); throw err }
    this.reset(a)
    this.notify()
    return this.entry(a, this.context())
  }

  /**
   * Puts the list in the given order (the file's, which the interface displays). An unknown id is
   * ignored; a rule missing from the list keeps its relative place, after the others.
   */
  async reorder(ids: readonly string[]): Promise<AutomationEntry[]> {
    const before = [...this.automations.values()]
    const listed = ids.filter((id, k) => this.automations.has(id) && ids.indexOf(id) === k).map((id) => this.automations.get(id)!)
    const rest = before.filter((a) => !listed.includes(a))
    this.automations.clear()
    for (const a of [...listed, ...rest]) this.automations.set(a.id, a)
    try { await this.persist() }
    catch (err) {
      this.automations.clear()
      for (const a of before) this.automations.set(a.id, a)
      throw err
    }
    this.notify()
    return this.list()
  }

  /** "Run" now: the actions alone, without trigger or "Unless" — this tests the "Then". */
  async runNow(id: string): Promise<AutomationRun | undefined> {
    const a = this.automations.get(id)
    if (!a) return undefined
    const result = await runActions(a, 'manual', this.context(), this.deps)
    this.done(a, result)
    return result.run
  }

  // ── internal ─────────────────────────────────────────────────────────────────────────────

  private context(): EvalContext {
    return this.view.context(this.deps.clock.now(), (id) => this.fresh.has(id))
  }

  private entry(a: Automation, ctx: EvalContext): AutomationEntry {
    const status: AutomationStatus = { ...computeStatus(a, ctx, this.deps.scenes) }
    const last = this.lastRun.get(a.id)
    const next = this.nextRun.get(a.id)
    const pending = this.pendingSince.get(a.id)
    if (last) status.lastRun = last
    if (next !== undefined) status.nextRunAt = next
    if (pending !== undefined) status.pendingSince = pending
    return { automation: a, status }
  }

  private async persist(): Promise<void> {
    await this.deps.store.save([...this.automations.values()])
  }

  /** A rule written or (dis)abled starts over: new snapshot, timers recomputed. */
  private reset(a: Automation): void {
    this.forget(a.id)
    this.baseline(a)
    this.arm()
  }

  private forget(id: string): void {
    this.last.delete(id)
    this.clearHold(id)
    this.nextRun.delete(id)
  }

  /** Reference snapshot of a state trigger: its current value, which fires nothing. */
  private baseline(a: Automation): void {
    if (!a.enabled || a.trigger.type !== 'state') return
    this.last.set(a.id, evaluatePredicate(a.trigger.when, this.context()))
  }

  private notify(): void {
    if (this.closed || !this.listeners.size) return
    const text = JSON.stringify(this.list())
    if (text === this.lastSent) return
    this.lastSent = text
    for (const cb of this.listeners) cb()
  }

  // time

  private arm(): void {
    if (this.closed) return
    const { clock, house } = this.deps
    if (this.timer) { clock.clearTimeout(this.timer); this.timer = null }
    const now = clock.now()
    let earliest = Infinity
    for (const a of this.automations.values()) {
      if (!a.enabled || a.trigger.type !== 'time') { this.nextRun.delete(a.id); continue }
      const next = nextOccurrence(a.trigger, now, house.house.origin)
      if (next === undefined) { this.nextRun.delete(a.id); continue }
      this.nextRun.set(a.id, next)
      earliest = Math.min(earliest, next)
    }
    if (earliest === Infinity) return
    this.timer = clock.setTimeout(() => this.tick(), Math.max(0, Math.min(earliest - now, MAX_WAIT_MS)))
  }

  private tick(): void {
    this.timer = null
    try {
      const now = this.deps.clock.now()
      for (const [id, at] of this.nextRun) {
        const a = this.automations.get(id)
        if (a && at <= now) this.fire(a, 'time')
      }
    } catch (err) {
      this.deps.logger.error({ err }, 'automation tick failed')
    }
    this.arm()
    this.notify()
  }

  // state

  private onDevices(ids: DeviceId[]): void {
    let ctx: EvalContext | null = null
    for (const a of this.automations.values()) {
      if (!a.enabled || a.trigger.type !== 'state') continue
      const when = a.trigger.when
      const c = (ctx ??= this.context())
      if (!ids.some((id) => touches(when, id, c))) continue
      this.evaluateState(a, c)
    }
  }

  private evaluateState(a: Automation, ctx: EvalContext): void {
    if (a.trigger.type !== 'state') return
    const v = evaluatePredicate(a.trigger.when, ctx)
    const prev = this.last.get(a.id)
    this.last.set(a.id, v)
    if (v !== true) {
      if (this.clearHold(a.id)) this.notify()
      return
    }
    if (prev !== false) return                           // not an edge: snapshot, unknown → true, or already true
    const forMin = a.trigger.forMin
    if (!forMin) { this.fire(a, 'state'); return }
    this.pendingSince.set(a.id, ctx.now)
    this.holds.set(a.id, this.deps.clock.setTimeout(() => {
      this.holds.delete(a.id)
      this.pendingSince.delete(a.id)
      try {
        const current = this.automations.get(a.id)
        if (current?.enabled && current.trigger.type === 'state' && evaluatePredicate(current.trigger.when, this.context()) === true) this.fire(current, 'state')
      } catch (err) {
        this.deps.logger.error({ err, automation: a.id }, 'automation hold failed')
      }
      this.notify()
    }, forMin * 60_000))
    this.notify()
  }

  /** Cancels a "for N minutes" wait. Returns true if there was one. */
  private clearHold(id: string): boolean {
    const h = this.holds.get(id)
    this.pendingSince.delete(id)
    if (h === undefined) return false
    this.deps.clock.clearTimeout(h)
    this.holds.delete(id)
    return true
  }

  // execution

  private fire(a: Automation, by: 'time' | 'state'): void {
    if (this.running.has(a.id)) {
      this.deps.logger.warn({ automation: a.id }, 'automation still running, trigger ignored')
      return
    }
    const ctx = this.context()
    const blocked = a.unless.some((p) => evaluatePredicate(p, ctx) === true)
    if (blocked) {
      this.record(a, { at: ctx.now, by, outcome: 'skipped', errors: [] })
      return
    }
    this.running.add(a.id)
    // Never awaited here: we are inside a bus or timer handler.
    void runActions(a, by, ctx, this.deps)
      .then((result) => this.done(a, result))
      .catch((err) => this.deps.logger.error({ err, automation: a.id }, 'automation run failed'))
      .finally(() => this.running.delete(a.id))
  }

  private done(a: Automation, { run, reverts }: RunResult): void {
    if (reverts.length) {
      for (const r of reverts) this.reverts.set(revertKey(r), r)
      this.saveReverts()
      this.armReverts()
    }
    this.record(a, run)
  }

  // "for N minutes" reverts

  /** A single timer, on the next revert not yet due; due ones wait for their device. */
  private armReverts(): void {
    if (this.closed) return
    const { clock } = this.deps
    if (this.revertTimer) { clock.clearTimeout(this.revertTimer); this.revertTimer = null }
    const now = clock.now()
    let earliest = Infinity
    for (const r of this.reverts.values()) if (r.dueAt > now) earliest = Math.min(earliest, r.dueAt)
    if (earliest !== Infinity) this.revertTimer = clock.setTimeout(() => {
      this.revertTimer = null
      try { this.runDueReverts() } catch (err) { this.deps.logger.error({ err }, 'automation revert tick failed') }
      this.armReverts()
    }, Math.min(earliest - now, MAX_WAIT_MS))
    this.runDueReverts()
  }

  /** Sends the due reverts whose device has published a state and answers. */
  private runDueReverts(): void {
    if (!this.reverts.size) return
    const now = this.deps.clock.now()
    let sent = false
    for (const [key, r] of this.reverts) {
      if (r.dueAt > now || !this.fresh.has(r.deviceId)) continue
      const entry = this.deps.registry.get(r.deviceId)
      if (!entry?.state.available) continue
      this.reverts.delete(key)
      sent = true
      void (async () => {
        assertCommandAllowed(entry.descriptor, r.command)
        await this.deps.host.execute(r.deviceId, r.command)
      })()
        .then(() => this.deps.logger.info({ automation: r.automationId, device: r.deviceId, command: r.command.type }, 'automation revert sent'))
        .catch((err) => this.deps.logger.warn({ err, automation: r.automationId, device: r.deviceId, command: r.command.type }, 'automation revert failed'))
    }
    if (sent) this.saveReverts()
  }

  private saveReverts(): void {
    void this.deps.reverts?.save([...this.reverts.values()])
      .catch((err) => this.deps.logger.warn({ err }, 'pending automation reverts not saved'))
  }

  private record(a: Automation, run: AutomationRun): void {
    this.lastRun.set(a.id, run)
    const log = run.outcome === 'ok' || run.outcome === 'skipped' ? 'info' : 'warn'
    this.deps.logger[log]({ automation: a.id, by: run.by, outcome: run.outcome, errors: run.errors }, 'automation run')
    this.notify()
  }
}

const revertKey = (r: PendingRevert) => `${r.automationId}#${r.action}#${r.deviceId}`
