import {
  decodeBattery, decodeSession, helloFrame, parseFrame, REFUSED, replyCmd,
  TENS_BATTERY_CHAR, TENS_COMMAND_CHAR, TENS_REPLY_CHAR, TENS_SERVICE, TENS_SESSION_CHAR, TENS_STATUS_SERVICE,
  type TensBattery, type TensSession,
} from './protocol'

// The Web Bluetooth link with the TENS. It lives in the BROWSER, never on the server: only the
// paired machine can drive the device (see the `tens` store).
//
// The Web Bluetooth types are redeclared as tightly as possible rather than pulled from `@types/web-bluetooth`:
// we only use a handful, and test doubles imitate them with nothing else.

export interface BleCharacteristic extends EventTarget {
  readonly value?: DataView | null
  readValue(): Promise<DataView>
  writeValueWithResponse(data: Uint8Array): Promise<void>
  startNotifications(): Promise<unknown>
}
export interface BleService { getCharacteristic(uuid: string): Promise<BleCharacteristic> }
export interface BleServer {
  readonly connected: boolean
  getPrimaryService(uuid: string): Promise<BleService>
  disconnect(): void
}
export interface BleDevice extends EventTarget {
  readonly id: string
  readonly name?: string
  readonly gatt?: { connect(): Promise<BleServer> }
}
export interface BleRequestOptions {
  filters?: { namePrefix?: string }[]
  acceptAllDevices?: boolean
  optionalServices: string[]
}
export interface BleBluetooth {
  requestDevice(options: BleRequestOptions): Promise<BleDevice>
  /** The already authorized devices — absent from some browsers, hence the option. */
  getDevices?(): Promise<BleDevice[]>
}

/** The browser's Bluetooth, or `null`: Firefox, Safari, or a page outside a secure context. */
export function browserBluetooth(): BleBluetooth | null {
  const nav = globalThis.navigator as (Navigator & { bluetooth?: BleBluetooth }) | undefined
  return nav?.bluetooth ?? null
}

export const TENS_NAME_PREFIX = 'acTENS'

/**
 * The browser's picker. The TENS announces neither its name nor its services (its advertisement only carries
 * flags and power): the name filter only finds it once the SYSTEM knows
 * that name — after a Windows pairing or a first connection. `all` lifts the filter (full
 * list, where an unknown TENS is called "Unknown device (00:30:3A:…)").
 */
export function requestTens(bt: BleBluetooth, all = false): Promise<BleDevice> {
  const optionalServices = [TENS_SERVICE, TENS_STATUS_SERVICE]
  return bt.requestDevice(all ? { acceptAllDevices: true, optionalServices } : { filters: [{ namePrefix: TENS_NAME_PREFIX }], optionalServices })
}

export interface TensLinkHandlers {
  onBattery(b: TensBattery): void
  onSession(s: TensSession): void
  onDisconnect(): void
}

const REPLY_TIMEOUT_MS = 2500
const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ')
/** Trace of each frame in the console (protocol diagnostics, as long as it is not validated on the device). */
const trace = (dir: string, b: Uint8Array) => console.info(`[tens] ${dir} ${hexOf(b)}`)
const bytesOf = (v: DataView) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength)

export class TensLink {
  private server: BleServer | null = null
  private command: BleCharacteristic | null = null
  private waiting = new Map<number, { resolve(p: Uint8Array): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>()
  /** Writes go one by one: the TENS answers in order, and the app never overlaps two. */
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(readonly device: BleDevice, private readonly handlers: TensLinkHandlers) {}

  get connected(): boolean { return !this.closed && !!this.server?.connected }

  /** Opens the link; an error says at which step it occurred ("services: …"), for diagnostics. */
  async open(): Promise<void> {
    let stage = 'gatt'
    try { await this.openSteps((s) => { stage = s }) } catch (e) {
      throw new Error(`${stage}: ${(e as Error)?.message ?? String(e)}`)
    }
  }

  private async openSteps(at: (stage: string) => void): Promise<void> {
    if (!this.device.gatt) throw new Error('no-gatt')
    this.device.addEventListener('gattserverdisconnected', this.onGone)
    at('connect')
    this.server = await this.device.gatt.connect()
    at('services')
    const main = await this.server.getPrimaryService(TENS_SERVICE)
    const status = await this.server.getPrimaryService(TENS_STATUS_SERVICE)
    this.command = await main.getCharacteristic(TENS_COMMAND_CHAR)
    const reply = await main.getCharacteristic(TENS_REPLY_CHAR)
    const battery = await status.getCharacteristic(TENS_BATTERY_CHAR)
    const session = await status.getCharacteristic(TENS_SESSION_CHAR)

    at('notifications')
    reply.addEventListener('characteristicvaluechanged', () => { if (reply.value) this.onReply(bytesOf(reply.value)) })
    battery.addEventListener('characteristicvaluechanged', () => { if (battery.value) this.emitBattery(bytesOf(battery.value)) })
    session.addEventListener('characteristicvaluechanged', () => { if (session.value) this.emitSession(bytesOf(session.value)) })
    await reply.startNotifications()
    await battery.startNotifications()
    await session.startNotifications()
    at('read')
    // The state right away, without waiting for the first notification (5 s for the battery).
    this.emitBattery(bytesOf(await battery.readValue()))
    this.emitSession(bytesOf(await session.readValue()))
    // The app always starts there; without a reply, we continue anyway.
    await this.send(helloFrame()).catch(() => undefined)
  }

  /** Writes a frame and returns the data of the reply with the same number. */
  send(frame: Uint8Array): Promise<Uint8Array> {
    const run = this.queue.then(() => this.write(frame))
    this.queue = run.catch(() => undefined)
    return run
  }

  close(): void {
    this.closed = true
    this.device.removeEventListener('gattserverdisconnected', this.onGone)
    this.failAll('closed')
    if (this.server?.connected) this.server.disconnect()
  }

  private async write(frame: Uint8Array): Promise<Uint8Array> {
    if (!this.command || !this.connected) throw new Error('disconnected')
    const cmd = replyCmd(frame[2]!)
    const reply = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(cmd); console.warn(`[tens] no reply to ${hexOf(frame)}`); reject(new Error('timeout')) }, REPLY_TIMEOUT_MS)
      this.waiting.set(cmd, { resolve, reject, timer })
    })
    try {
      trace('→', frame)
      await this.command.writeValueWithResponse(frame)
    } catch (e) {
      const w = this.waiting.get(cmd)
      if (w) { clearTimeout(w.timer); this.waiting.delete(cmd) }
      throw e
    }
    return reply
  }

  private onReply(bytes: Uint8Array): void {
    trace('←', bytes)
    const f = parseFrame(bytes)
    if (!f || f.kind !== 'reply') return
    // a refusal names the refused command: it is the one that fails, without waiting for the timeout
    const refused = f.cmd === REFUSED && f.payload.length >= 2
    const key = refused ? replyCmd(f.payload[0]!) : f.cmd
    const w = this.waiting.get(key)
    if (!w) return
    clearTimeout(w.timer)
    this.waiting.delete(key)
    if (refused) w.reject(new Error(`refused:${f.payload[1]}`))
    else w.resolve(f.payload)
  }

  private emitBattery(bytes: Uint8Array): void { const b = decodeBattery(bytes); if (b) this.handlers.onBattery(b) }
  private emitSession(bytes: Uint8Array): void { const s = decodeSession(bytes); if (s) this.handlers.onSession(s) }

  private failAll(reason: string): void {
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error(reason)) }
    this.waiting.clear()
  }

  private onGone = (): void => {
    this.failAll('disconnected')
    if (!this.closed) this.handlers.onDisconnect()
  }
}
