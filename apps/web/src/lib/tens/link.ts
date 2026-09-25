import {
  decodeBattery, decodeSession, helloFrame, parseFrame, REFUSED, replyCmd,
  TENS_BATTERY_CHAR, TENS_COMMAND_CHAR, TENS_REPLY_CHAR, TENS_SERVICE, TENS_SESSION_CHAR, TENS_STATUS_SERVICE,
  type TensBattery, type TensSession,
} from './protocol'

// Le lien Web Bluetooth avec le TENS. Il vit dans le NAVIGATEUR, jamais sur le serveur : seul le
// poste appairé peut piloter l'appareil (voir le store `tens`).
//
// Les types du Web Bluetooth sont redéclarés au plus juste plutôt que tirés de `@types/web-bluetooth` :
// on n'en utilise qu'une poignée, et des doublures de test les imitent sans rien d'autre.

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
  /** Les appareils déjà autorisés — absent de certains navigateurs, d'où l'option. */
  getDevices?(): Promise<BleDevice[]>
}

/** Le Bluetooth du navigateur, ou `null` : Firefox, Safari, ou page hors contexte sécurisé. */
export function browserBluetooth(): BleBluetooth | null {
  const nav = globalThis.navigator as (Navigator & { bluetooth?: BleBluetooth }) | undefined
  return nav?.bluetooth ?? null
}

export const TENS_NAME_PREFIX = 'acTENS'

/**
 * Le sélecteur du navigateur. Le TENS n'annonce ni son nom ni ses services (son annonce ne porte
 * que drapeaux et puissance) : le filtre sur le nom ne le trouve qu'une fois que le SYSTÈME connaît
 * ce nom — après un appairage Windows ou une première connexion. `all` lève le filtre (liste
 * complète, où un TENS inconnu s'appelle « Appareil inconnu (00:30:3A:…) »).
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
/** Trace de chaque trame dans la console (diagnostic du protocole, tant qu'il n'est pas validé sur l'appareil). */
const trace = (dir: string, b: Uint8Array) => console.info(`[tens] ${dir} ${hexOf(b)}`)
const bytesOf = (v: DataView) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength)

export class TensLink {
  private server: BleServer | null = null
  private command: BleCharacteristic | null = null
  private waiting = new Map<number, { resolve(p: Uint8Array): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>()
  /** Les écritures passent une par une : le TENS répond dans l'ordre, et l'appli n'en chevauche jamais deux. */
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(readonly device: BleDevice, private readonly handlers: TensLinkHandlers) {}

  get connected(): boolean { return !this.closed && !!this.server?.connected }

  /** Ouvre le lien ; une erreur dit à quelle étape elle est survenue (« services: … »), pour le diagnostic. */
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
    // L'état tout de suite, sans attendre la première notification (5 s pour la batterie).
    this.emitBattery(bytesOf(await battery.readValue()))
    this.emitSession(bytesOf(await session.readValue()))
    // L'appli commence toujours par là ; sans réponse, on continue quand même.
    await this.send(helloFrame()).catch(() => undefined)
  }

  /** Écrit une trame et rend les données de la réponse du même numéro. */
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
      const timer = setTimeout(() => { this.waiting.delete(cmd); console.warn(`[tens] pas de réponse à ${hexOf(frame)}`); reject(new Error('timeout')) }, REPLY_TIMEOUT_MS)
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
    // un refus nomme la commande refusée : c'est elle qui échoue, sans attendre le délai
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
