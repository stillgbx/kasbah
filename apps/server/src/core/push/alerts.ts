import { readFile } from 'node:fs/promises'
import { deviceAlerts, NOTIFY_CATEGORY_OF_KIND, type DeviceAlert, type DeviceId, type NotifyCategory, type PluginHealth } from '@kasbah/shared'
import type { Logger } from 'pino'
import { z } from 'zod'
import { writeFileAtomic } from '../atomic-file'
import type { Bus } from '../bus'
import type { Clock } from '../clock'
import type { DeviceRegistry } from '../registry'
import { deviceAlertText, pluginAlertText, textsFor } from './texts'
import type { PushService } from './service'

// The house's alerts, pushed. The rule is the app's (`deviceAlerts`, shared; the plugin rule of
// `stores/alerts.ts`), only the moment changes: a notification goes out ONCE, when an alert appears.
//
// An alert is NEW when its id has not been notified (`deviceAlerts` puts in the id what makes it
// new: the version, the code and the time of the fault). A notified id is forgotten once it has been
// gone for `FORGET_AFTER_MS`: a state that drops the alert for a moment (a first partial reading
// after a restart, a vendor message that flickers) does not make it notified twice. The notified
// ids are written in `.state/`: a restart does not send again what was already sent.
//
// Plugins are read every minute (`host.health()`, the house's health, not an account's): `error`
// and `needs_pairing` right away, `degraded` once it has lasted 5 min — the app's rule.

/** An alert gone for this long can come back as a new notification. */
export const FORGET_AFTER_MS = 10 * 60_000
/**
 * The alerts of a device gone from the registry are kept this long: a plugin turned off then on
 * again does not send its ongoing alerts again, a device removed for good does not stay in the file.
 */
export const ABSENT_FORGET_MS = 7 * 24 * 3600_000
/** `degraded` is often a passing miss: notified once it has lasted this long (`DEGRADED_GRACE_MS` of the app). */
export const DEGRADED_GRACE_MS = 5 * 60_000
const HEALTH_EVERY_MS = 60_000
const FAILING: PluginHealth['status'][] = ['error', 'needs_pairing']

const fileSchema = z.object({ seen: z.record(z.string(), z.number()) })

export interface AlertNotifierDeps {
  bus: Bus
  registry: Pick<DeviceRegistry, 'get' | 'list'>
  /** The house's plugin health (`PluginHost.health()`). */
  health: () => Promise<Record<string, PluginHealth>>
  push: Pick<PushService, 'send'>
  clock: Clock
  path: string
  logger: Logger
}

export class AlertNotifier {
  /** Notified alert ids → last time they were seen ongoing. */
  private seen: Record<string, number> = {}
  private readonly degradedSince = new Map<string, number>()
  private readonly unsubscribe: (() => void)[] = []
  private timer: unknown = null
  /** The last write (queued by `writeFileAtomic`: it ends after the earlier ones). */
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly deps: AlertNotifierDeps) {}

  async start(): Promise<void> {
    try { this.seen = fileSchema.parse(JSON.parse(await readFile(this.deps.path, 'utf8'))).seen }
    catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.deps.logger.warn({ err }, 'notified alerts unreadable, ignored') }
    // guarded: `Bus.emit` catches nothing, an exception would bubble up into the publishing plugin
    this.unsubscribe.push(this.deps.bus.on('state', (id) => {
      try { this.onDevice(id) } catch (err) { this.deps.logger.error({ err }, 'alert notification failed') }
    }))
    this.timer = this.deps.clock.setInterval(() => void this.tick(), HEALTH_EVERY_MS)
  }

  /** Stops listening; resolves once the last write of the notified ids is on disk. */
  close(): Promise<void> {
    for (const off of this.unsubscribe.splice(0)) off()
    if (this.timer !== null) this.deps.clock.clearInterval(this.timer)
    this.timer = null
    return this.saving
  }

  /** A device published a state: its new alerts go out. */
  onDevice(id: DeviceId): void {
    const entry = this.deps.registry.get(id)
    if (!entry) return
    const now = this.deps.clock.now()
    let changed = false
    for (const a of deviceAlerts(id, entry.state) ?? []) {
      const category = NOTIFY_CATEGORY_OF_KIND[a.kind]
      if (!category) continue
      if (!(a.id in this.seen)) { this.notifyDevice(a, entry.descriptor.name, category); changed = true }
      this.seen[a.id] = now
    }
    if (changed) void this.save()
  }

  /** Every minute: the plugins, and the forgetting of the alerts that are over. */
  async tick(): Promise<void> {
    try {
      await this.checkPlugins()
      this.forget()
    } catch (err) {
      this.deps.logger.error({ err }, 'alert notification failed')
    }
  }

  private async checkPlugins(): Promise<void> {
    const now = this.deps.clock.now()
    const health = await this.deps.health()
    for (const id of this.degradedSince.keys()) if (health[id]?.status !== 'degraded') this.degradedSince.delete(id)
    let changed = false
    for (const [pluginId, h] of Object.entries(health)) {
      if (h.status === 'degraded' && !this.degradedSince.has(pluginId)) this.degradedSince.set(pluginId, now)
      const failing = FAILING.includes(h.status) || (h.status === 'degraded' && now - this.degradedSince.get(pluginId)! >= DEGRADED_GRACE_MS)
      if (!failing) continue
      const key = `plugin|${pluginId}|${h.status}`
      if (!(key in this.seen)) {
        changed = true
        this.send('plugins', (lang) => ({
          title: textsFor(lang).plugin(pluginId), body: pluginAlertText(h.status, h.detail, lang), tag: key, url: '/settings',
        }))
      }
      this.seen[key] = now
    }
    if (changed) void this.save()
  }

  /**
   * Refreshes the alerts still ongoing and forgets those gone for `FORGET_AFTER_MS`. A device whose
   * state does not allow saying (`null`) keeps its alerts: nothing says they are over. One no longer
   * in the registry keeps them `ABSENT_FORGET_MS` after it was last seen there.
   */
  private forget(): void {
    const now = this.deps.clock.now()
    const ongoing = new Set<string>()
    for (const e of this.deps.registry.list()) {
      const list = deviceAlerts(e.descriptor.id, e.state)
      if (list === null) for (const id of Object.keys(this.seen)) { if (id.startsWith(`${e.descriptor.id}|`)) ongoing.add(id) }
      else for (const a of list) ongoing.add(a.id)
    }
    const known = new Set(this.deps.registry.list().map((e) => e.descriptor.id))
    let changed = false
    for (const [id, at] of Object.entries(this.seen)) {
      // plugin ids are refreshed by `checkPlugins`, device ids here
      const deviceId = id.startsWith('plugin|') ? null : id.slice(0, id.indexOf('|'))
      if (ongoing.has(id)) { this.seen[id] = now; continue }
      const absent = deviceId !== null && !known.has(deviceId)
      if (now - at >= (absent ? ABSENT_FORGET_MS : FORGET_AFTER_MS)) { delete this.seen[id]; changed = true }
    }
    if (changed) void this.save()
  }

  private notifyDevice(a: DeviceAlert, name: string, category: NotifyCategory): void {
    this.send(category, (lang) => ({ title: name, body: deviceAlertText(a, lang), tag: a.id, url: `/${category}` }))
  }

  private send(...args: Parameters<PushService['send']>): void {
    this.deps.push.send(...args).catch((err) => this.deps.logger.warn({ err }, 'alert notification not sent'))
  }

  private save(): Promise<void> {
    this.saving = writeFileAtomic(this.deps.path, `${JSON.stringify({ seen: this.seen })}\n`)
      .catch((err) => this.deps.logger.warn({ err }, 'notified alerts not written'))
    return this.saving
  }
}
