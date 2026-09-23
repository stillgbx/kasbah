import type { Automation, AutomationBody, AutomationEntry, AutomationRun, AutomationStatus, DeviceId } from '@kasbah/shared'
import { automationBodySchema } from '@kasbah/shared'
import type { Logger } from 'pino'
import type { LoadedHouse } from '../../config/house'
import type { Bus } from '../bus'
import type { Clock } from '../clock'
import type { DeviceRegistry } from '../registry'
import type { SceneRegistry } from '../scene-registry'
import { HouseView, type EvalContext } from './context'
import { evaluatePredicate, touches, type Tri } from './evaluate'
import { runActions, type RunnerDeps } from './runner'
import { nextOccurrence } from './schedule'
import { computeStatus } from './status'
import type { AutomationsStore } from './store'

// Moteur des automatisations, côté serveur (la tablette dort, le serveur non).
//
// HORAIRE : un seul minuteur, posé sur la plus proche échéance de toutes les automatisations
// actives, jamais plus loin que 6 h (le soleil se relit chaque jour, et `setTimeout` plafonne à
// 24,8 jours). Une échéance manquée pendant un arrêt du serveur n'est pas rattrapée.
//
// ÉTAT : sur chaque état publié, les déclencheurs qui dépendent de cet appareil sont réévalués ;
// seul un passage FAUX → VRAI déclenche. Un premier relevé, un appareil qui revient, un redémarrage
// partent d'« inconnu » et ne déclenchent donc jamais. Les états produits par nos propres commandes
// arrivent plus tard, sur un autre tour : front seul, pas de boucle.
//
// Chaque gestionnaire du bus est protégé : `Bus.emit` n'attrape rien, et une exception ici
// remonterait dans le plugin qui a publié l'état.

/** Plus longue attente d'un seul minuteur. */
const MAX_WAIT_MS = 6 * 3600_000

export interface AutomationEngineDeps extends RunnerDeps {
  store: AutomationsStore
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
  /** Dernière valeur du prédicat d'un déclencheur d'état ; absent = jamais évalué. */
  private readonly last = new Map<string, Tri>()
  private readonly holds = new Map<string, unknown>()
  private readonly running = new Set<string>()
  /** Appareils qui ont publié un état depuis leur apparition : les autres ont les valeurs par défaut. */
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
    const guard = <A extends unknown[]>(name: string, fn: (...args: A) => void) => (...args: A) => {
      try { fn(...args) } catch (err) { this.deps.logger.error({ err, event: name }, 'automation handler failed') }
    }
    const { bus } = this.deps
    this.unsubscribe.push(
      bus.on('state', guard('state', (id: DeviceId) => { this.fresh.add(id); this.onDevices([id]) })),
      bus.on('availability', guard('availability', (ids: DeviceId[]) => { this.onDevices(ids); this.notify() })),
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
    this.deps.logger.info({ count: this.automations.size }, 'automations loaded')
  }

  close(): void {
    this.closed = true
    for (const u of this.unsubscribe) u()
    this.unsubscribe.length = 0
    if (this.timer) this.deps.clock.clearTimeout(this.timer)
    for (const h of this.holds.values()) this.deps.clock.clearTimeout(h)
    this.holds.clear()
    this.listeners.clear()
  }

  /** Prévenu à chaque changement de la liste ou d'un statut (le hub WS rediffuse). */
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

  /** Crée ou remplace. Le corps est validé ici aussi : le moteur ne garde jamais une règle invalide. */
  async upsert(id: string, body: AutomationBody): Promise<AutomationEntry> {
    const parsed = automationBodySchema.parse(body)
    const a: Automation = { id, ...parsed, updatedAt: this.deps.clock.now() }
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

  /** « Exécuter maintenant » : les actions seules, sans déclencheur ni « sauf si » — on teste l'« Alors ». */
  async runNow(id: string): Promise<AutomationRun | undefined> {
    const a = this.automations.get(id)
    if (!a) return undefined
    const run = await runActions(a, 'manual', this.context(), this.deps)
    this.record(a, run)
    return run
  }

  // ── interne ──────────────────────────────────────────────────────────────────────────────

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

  /** Une règle écrite ou (dés)activée repart de zéro : nouvelle photo, minuteurs recalculés. */
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

  /** Photo de référence d'un déclencheur d'état : sa valeur actuelle, qui ne déclenche rien. */
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

  // horaire

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

  // état

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
    if (prev !== false) return                           // pas un front : photo, inconnu → vrai, ou déjà vrai
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

  /** Annule une attente « pendant N minutes ». Rend vrai s'il y en avait une. */
  private clearHold(id: string): boolean {
    const h = this.holds.get(id)
    this.pendingSince.delete(id)
    if (h === undefined) return false
    this.deps.clock.clearTimeout(h)
    this.holds.delete(id)
    return true
  }

  // exécution

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
    // Jamais attendu ici : on est dans un gestionnaire du bus ou du minuteur.
    void runActions(a, by, ctx, this.deps)
      .then((run) => this.record(a, run))
      .catch((err) => this.deps.logger.error({ err, automation: a.id }, 'automation run failed'))
      .finally(() => this.running.delete(a.id))
  }

  private record(a: Automation, run: AutomationRun): void {
    this.lastRun.set(a.id, run)
    const log = run.outcome === 'ok' || run.outcome === 'skipped' ? 'info' : 'warn'
    this.deps.logger[log]({ automation: a.id, by: run.by, outcome: run.outcome, errors: run.errors }, 'automation run')
    this.notify()
  }
}
