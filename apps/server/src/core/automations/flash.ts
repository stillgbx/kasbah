import { assertCommandAllowed, rgbToXy, type Command, type DeviceEntry, type DeviceId, type FlashColor, type FlashSpeed } from '@kasbah/shared'
import type { Logger } from 'pino'
import type { Clock } from '../clock'
import type { PluginHost } from '../plugin-host'

// "Flash" action of the automations: the SERVER makes the lights blink, whatever their brand, with
// the plain `light.set` of the contract — on at full brightness (in a color if asked and the light
// has colors), off, again, for the requested duration — then puts each light back as it was.
//
// - A light already flashing is NOT read again: it keeps the state noted at the start (read now,
//   it would be "off" half of the time), and its end moves to the new deadline.
// - One command at a time per light: a phase whose previous command has not been acknowledged is
//   skipped, so that a slow bridge does not pile up orders (a Hue bridge takes ~10 per second).
// - In memory only: a restart in the middle leaves the light in its last phase.

/** Full cycle (on + off) per speed. Below ~0.8 s, Zigbee latency blurs the blinking. */
export const FLASH_PERIOD_MS: Record<FlashSpeed, number> = { slow: 2000, normal: 1200, fast: 800 }

const RGB: Record<Exclude<FlashColor, 'white'>, [number, number, number]> = {
  red: [1, 0, 0], orange: [1, 0.5, 0], yellow: [1, 0.85, 0], green: [0, 1, 0], blue: [0, 0, 1], purple: [0.6, 0, 1],
}
/** Neutral white, for the lights that have a color temperature. */
const WHITE_MIREK = 250

export interface FlashRequest { color?: FlashColor; durationS: number; speed: FlashSpeed }

interface Flashing {
  on: Command
  /** The light as it was before the first flash. */
  restore: Command
  until: number
  halfMs: number
  lit: boolean
  busy: boolean
  timer: unknown
}

export interface FlasherDeps {
  host: Pick<PluginHost, 'execute'>
  clock: Clock
  logger: Logger
}

/** The command of the "on" phase, limited to what the light declares. */
export function flashOnCommand(entry: DeviceEntry, color: FlashColor | undefined): Command {
  const caps = entry.descriptor.capabilities
  const cmd: Extract<Command, { type: 'light.set' }> = { type: 'light.set', on: true, transitionMs: 0 }
  if (caps.includes('brightness')) cmd.brightness = 100
  if (color === 'white') { if (caps.includes('color_temp')) cmd.colorTempMirek = WHITE_MIREK }
  else if (color && caps.includes('color')) {
    const [r, g, b] = RGB[color]
    cmd.color = rgbToXy({ r, g, b })
  }
  return cmd
}

/** The command that puts the light back as its state says. */
export function restoreCommand(entry: DeviceEntry): Command {
  const s = entry.state
  if (s.kind !== 'light' || !s.on) return { type: 'light.set', on: false, transitionMs: 0 }
  return {
    type: 'light.set', on: true, transitionMs: 0,
    ...(s.brightness !== undefined ? { brightness: s.brightness } : {}),
    ...(s.color ? { color: s.color } : s.colorTempMirek !== undefined ? { colorTempMirek: s.colorTempMirek } : {}),
  }
}

export class Flasher {
  private readonly active = new Map<DeviceId, Flashing>()

  constructor(private readonly deps: FlasherDeps) {}

  /** Lights currently flashing (tests, logs). */
  get size(): number { return this.active.size }

  /**
   * Starts the light flashing, or prolongs it. Resolves once the first "on" is acknowledged; throws
   * if the light refuses it (not a light, plugin error) — the run reports it.
   */
  async start(entry: DeviceEntry, req: FlashRequest): Promise<void> {
    const on = flashOnCommand(entry, req.color)
    assertCommandAllowed(entry.descriptor, on)
    const id = entry.descriptor.id
    const until = this.deps.clock.now() + req.durationS * 1000
    const halfMs = FLASH_PERIOD_MS[req.speed] / 2
    const current = this.active.get(id)
    if (current) {
      Object.assign(current, { on, halfMs, until: Math.max(current.until, until) })
      return
    }
    const f: Flashing = { on, restore: restoreCommand(entry), until, halfMs, lit: true, busy: true, timer: null }
    this.active.set(id, f)
    try { await this.deps.host.execute(id, on) }
    catch (err) {
      this.active.delete(id)
      throw err
    }
    f.busy = false
    this.schedule(id, f)
  }

  /** Stops every timer, without putting the lights back (server shutting down). */
  close(): void {
    for (const f of this.active.values()) if (f.timer !== null) this.deps.clock.clearTimeout(f.timer)
    this.active.clear()
  }

  private schedule(id: DeviceId, f: Flashing): void {
    f.timer = this.deps.clock.setTimeout(() => this.step(id, f), f.halfMs)
  }

  private step(id: DeviceId, f: Flashing): void {
    f.timer = null
    if (this.active.get(id) !== f) return
    if (this.deps.clock.now() >= f.until) {
      this.active.delete(id)
      this.send(id, f, f.restore, 'restore')
      return
    }
    if (!f.busy) {
      f.lit = !f.lit
      this.send(id, f, f.lit ? f.on : { type: 'light.set', on: false, transitionMs: 0 }, 'phase')
    }
    this.schedule(id, f)
  }

  private send(id: DeviceId, f: Flashing, cmd: Command, what: 'phase' | 'restore'): void {
    f.busy = true
    this.deps.host.execute(id, cmd)
      .catch((err) => this.deps.logger.warn({ err, device: id, what }, 'light flash command failed'))
      .finally(() => { f.busy = false })
  }
}
