import type { Logger } from 'pino'
import { sleep, type Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import type { PetkitClient } from './client'
import type { PetPumpMode } from '@kasbah/shared'
import { bleRelaysSchema } from './types'

// Bluetooth relay: how to reach a fountain that has NO Wi-Fi.
//
// An Eversweet Max only speaks Bluetooth. To read it or command anything, the cloud asks a
// NEARBY Wi-Fi PetKit device (here the feeder standing next to it) to open a link to it. The
// sequence is always the same:
//
//   ownSupportBleDevices → who can relay?           (empty = give up, it's not a failure)
//   connect              → is the request accepted?
//   poll × n             → is the link established?   (0 in progress, 1 connected, -1 failure)
//   … read or command …
//   cancel               → close
//
// The 4 s between two `poll`s are an ESTABLISHMENT delay, not a refresh rate: it's the time a radio
// takes to lock on, and it can't be tuned. What can be tuned is how often a session is reopened
// (ten minutes, see `PETKIT_FOUNTAIN_SYNC_MS`).
//
// A consequence not to lose sight of: a fountain reading can cost TWO MINUTES at worst. The caller
// must never wait for it while holding a user command.

export const BLE_POLL_INTERVAL_MS = 4000
export const BLE_CONNECT_ATTEMPTS = 32

/** Header and footer PetKit expects around each command frame. */
const FRAME_START = [250, 252, 253]
const FRAME_END = [251]

/** States returned by `ble/poll`. */
const CONNECTING = 0, CONNECTED = 1, FAILED = -1

/**
 * The frame of a pump command, MEASURED on the real fountain on 09/21.
 *
 *   [250,252,253]  header
 *   220            code of the "set the pump" command
 *   1, <counter>   sequence number: two identical frames would pass for a duplicate
 *   3, 0           payload length
 *   <on>           1 = the pump runs, 0 = paused
 *   <mode>, <mode> 1 = continuous, 2 = intermittent — **REPEATED twice**
 *   [251]          footer
 *
 * The repeated mode is what the reference library's table had wrong: it gives `…,1,2,1` for
 * intermittent, and that frame is ACCEPTED (acknowledged "1") without changing anything. Only
 * `…,1,2,2` switches the machine to intermittent. So an acknowledgment proves nothing here — it's
 * re-reading the mode that decides, and that's how it was found.
 *
 * STOPPING is verified too: `on: 0` brings `status.powerStatus` to 0 **and leaves the mode
 * untouched** (2 before, 2 after), then restarting goes back to 1 at the first try. That's exactly
 * what the pattern announced, and the reason why the mode isn't hard-coded in the stop frame: a
 * fixed constant would switch the fountain back to continuous at every power-off.
 */
export function pumpFrame(o: { on: boolean; mode: PetPumpMode; counter: number }): number[] {
  const m = o.mode === 'intermittent' ? 2 : 1
  return [220, 1, o.counter, 3, 0, o.on ? 1 : 0, m, m]
}

export interface BleTarget {
  /** PetKit identifier of the fountain. */
  bleId: string
  /**
   * NUMERIC model code (24 for a Ctw3), taken from the roster. The string (`"ctw3"`) is refused
   * with "Vous n'avez pas de permission. (code 4)", which looks nothing like a parameter error —
   * verified on 09/21.
   */
  type: string
  mac: string
  /** Group ("family") it belongs to: relays are looked up per group. */
  groupId: string
}

export interface BleRelayOptions {
  client: PetkitClient
  clock: Clock
  logger?: Logger
  signal: AbortSignal
  pollIntervalMs?: number
  attempts?: number
}

export class BleRelay {
  /**
   * Frame counter, per fountain. PetKit inserts it into the command; two commands carrying the
   * same counter would pass for a duplicate.
   */
  private counters = new Map<string, number>()

  constructor(private readonly opts: BleRelayOptions) {}

  /**
   * Is there a device able to relay to this fountain, AND online? No ≠ failure: the relay may be
   * unplugged or out of range. `pim` is what tells the two apart — a relay listed but switched off
   * would accept the request and relay nothing.
   */
  async hasRelay(target: BleTarget): Promise<boolean> {
    const body = await this.opts.client.post('ble/ownSupportBleDevices', { groupId: target.groupId }, this.opts.signal)
    const parsed = bleRelaysSchema.safeParse(body)
    return parsed.success && parsed.data.some((r) => r.pim === undefined || r.pim === 1)
  }

  /**
   * Opens a link and keeps it for the duration of `run`, then closes it WHATEVER HAPPENS — a link
   * left open ties up the relay, hence the feeder, for the following calls.
   */
  async withConnection<T>(target: BleTarget, run: () => Promise<T>): Promise<T> {
    if (!await this.hasRelay(target)) throw new PluginError('DEVICE_UNAVAILABLE', 'no PetKit device in Bluetooth range to relay')
    const accepted = await this.opts.client.post('ble/connect', this.frameTarget(target), this.opts.signal)
    if (!isAccepted(accepted)) throw new PluginError('DEVICE_UNAVAILABLE', 'PetKit refused to open the Bluetooth relay')
    try {
      await this.waitConnected(target)
      return await run()
    } finally {
      try { await this.opts.client.post('ble/cancel', this.frameTarget(target), this.opts.signal) }
      catch (err) { this.opts.logger?.warn({ err, bleId: target.bleId }, 'could not close the PetKit Bluetooth relay') }
    }
  }

  private async waitConnected(target: BleTarget): Promise<void> {
    const attempts = this.opts.attempts ?? BLE_CONNECT_ATTEMPTS
    for (let i = 0; i < attempts; i++) {
      const state = toState(await this.opts.client.post('ble/poll', this.frameTarget(target), this.opts.signal))
      if (state === CONNECTED) return
      if (state === FAILED) throw new PluginError('DEVICE_UNAVAILABLE', 'PetKit Bluetooth relay failed to connect')
      await sleep(this.opts.clock, this.opts.pollIntervalMs ?? BLE_POLL_INTERVAL_MS, this.opts.signal)
    }
    throw new PluginError('TIMEOUT', 'PetKit Bluetooth relay did not connect in time')
  }

  /**
   * Sets the pump: on/off AND mode, in one frame — both travel together, one can't be changed
   * without restating the other. The link must be open (`withConnection`).
   */
  async setPump(target: BleTarget, o: { on: boolean; mode: PetPumpMode }): Promise<void> {
    const counter = (this.counters.get(target.bleId) ?? 0) + 1
    this.counters.set(target.bleId, counter)
    const body = pumpFrame({ ...o, counter })
    const data = encodeURIComponent(Buffer.from([...FRAME_START, ...body, ...FRAME_END]).toString('base64'))
    const ack = await this.opts.client.post('ble/controlDevice', {
      ...this.frameTarget(target), cmd: String(body[0]), data,
    }, this.opts.signal)
    // The acknowledgment says "frame delivered", never "the pump obeyed" — VERIFIED here in the
    // strong sense: a frame with the wrong last byte is acknowledged "1" and changes nothing. It's
    // the re-read that decides, never the acknowledgment (same lesson as with the Roomba).
    if (!isAccepted(ack)) throw new PluginError('UPSTREAM_ERROR', 'PetKit refused the Bluetooth frame')
  }

  private frameTarget(t: BleTarget): Record<string, string> {
    return { bleId: t.bleId, type: t.type, mac: t.mac }
  }
}

/** `1`, `{state:1}` or `{"result":1}` depending on the endpoint: all mean "accepted". */
function isAccepted(body: unknown): boolean {
  if (body === 1 || body === '1' || body === true) return true
  if (body && typeof body === 'object' && 'state' in body) return Number((body as { state: unknown }).state) === 1
  return false
}

function toState(body: unknown): number {
  if (typeof body === 'number') return body
  if (typeof body === 'string' && body.trim() !== '') return Number(body)
  if (body && typeof body === 'object' && 'state' in body) return Number((body as { state: unknown }).state)
  return CONNECTING
}
