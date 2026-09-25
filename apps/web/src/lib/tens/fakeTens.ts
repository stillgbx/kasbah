import type { BleBluetooth, BleCharacteristic, BleDevice, BleServer, BleService } from './link'
import {
  CMD, crc8Maxim, TENS_BATTERY_CHAR, TENS_COMMAND_CHAR, TENS_REPLY_CHAR, TENS_SERVICE, TENS_SESSION_CHAR, TENS_STATUS_SERVICE,
} from './protocol'

// Doublure de test : un actiTENS mini qui répond comme l'appareil capturé le 2026-09-25 — une
// réponse `1b c0 <cmd & 0x7f> 00 <crc>` par commande, et la caractéristique séance qui suit l'état.
// Pour les tests seulement (aucun import depuis l'appli).

class FakeChar extends EventTarget implements BleCharacteristic {
  value: DataView | null = null
  onWrite: ((b: Uint8Array) => void) | null = null
  constructor(private bytes: Uint8Array = new Uint8Array()) { super() }
  async readValue() { return new DataView(this.bytes.slice().buffer) }
  async writeValueWithResponse(data: Uint8Array) { this.onWrite?.(new Uint8Array(data)) }
  async startNotifications() { return this }
  notify(bytes: Uint8Array) {
    this.bytes = bytes
    this.value = new DataView(bytes.slice().buffer)
    this.dispatchEvent(new Event('characteristicvaluechanged'))
  }
}

export class FakeTens extends EventTarget implements BleDevice {
  readonly id = 'fake-tens'
  readonly name = 'acTENSv2_015A9F'
  /** Toutes les trames reçues, dans l'ordre. */
  readonly written: Uint8Array[] = []
  /** Commandes auxquelles le faux appareil ne répond pas (délai dépassé côté Kasbah). */
  readonly silent = new Set<number>()
  connected = false
  state = 0
  ch = { 1: 0, 2: 0 } as Record<1 | 2, number>
  remaining = 0
  /** Électrodes posées sur la peau ; sinon le programme est refusé, code 0x11, comme en vrai. */
  electrodes = true
  /** Nombre de prochaines intensités à refuser « trop tôt » (code 0x33). */
  refuseIntensity = 0
  /** Instant (horloge du test) de chaque intensité acceptée. */
  readonly intensityAt: number[] = []
  /** Octet bas de l'identifiant de séance reçu avec le programme, renvoyé dans la séance comme le vrai. */
  tag = 0
  private reply = new FakeChar()
  private command = new FakeChar()
  private battery = new FakeChar(Uint8Array.of(0, 0, 0xa0, 0x0f, 0x59))
  private session = new FakeChar(new Uint8Array(9))

  readonly gatt = { connect: async (): Promise<BleServer> => { this.connected = true; return this.server } }

  private server: BleServer = {
    get connected() { return true },
    getPrimaryService: async (uuid: string): Promise<BleService> => {
      const chars: Record<string, FakeChar> = uuid === TENS_SERVICE
        ? { [TENS_COMMAND_CHAR]: this.command, [TENS_REPLY_CHAR]: this.reply }
        : uuid === TENS_STATUS_SERVICE ? { [TENS_BATTERY_CHAR]: this.battery, [TENS_SESSION_CHAR]: this.session } : {}
      return { getCharacteristic: async (c: string) => { const ch = chars[c]; if (!ch) throw new Error(`no ${c}`); return ch } }
    },
    disconnect: () => this.drop(),
  }

  constructor() {
    super()
    this.command.onWrite = (b) => this.handle(b)
  }

  /** Simule une coupure radio (hors de portée, appareil éteint). */
  drop() {
    if (!this.connected) return
    this.connected = false
    this.dispatchEvent(new Event('gattserverdisconnected'))
  }

  pushBattery(bytes: Uint8Array) { this.battery.notify(bytes) }

  frames(cmd: number) { return this.written.filter((f) => f[2] === cmd) }

  private handle(frame: Uint8Array) {
    this.written.push(frame)
    const cmd = frame[2]!
    if (this.silent.has(cmd)) return
    // comme le vrai : un programme qui annonce plus de 4 segments est refusé (code 5), un TENS non
    // posé refuse le programme (0x11), une intensité trop rapprochée est refusée (0x33)
    const code = cmd === CMD.program && frame[5]! > 4 ? 5
      : cmd === CMD.program && !this.electrodes ? 0x11
      : cmd === CMD.intensity && this.refuseIntensity > 0 ? (this.refuseIntensity--, 0x33)
      : 0
    if (code) {
      const r = Uint8Array.of(0x1b, 0xc0, 0x7f, 2, cmd, code, 0)
      r[6] = crc8Maxim(r.subarray(0, 6))
      queueMicrotask(() => this.reply.notify(r))
      return
    }
    if (cmd === CMD.intensity) this.intensityAt.push(Date.now())
    if (cmd === CMD.program) this.tag = frame[4]!
    if (cmd === CMD.start) { this.state = 2; this.remaining = frame[4]! | (frame[5]! << 8) }
    if (cmd === CMD.intensity) this.ch[frame[4] as 1 | 2] = frame[5]! | (frame[6]! << 8)
    if (cmd === CMD.pause) { this.state = 3; this.ch = { 1: 0, 2: 0 } }
    if (cmd === CMD.resume) this.state = 2
    if (cmd === CMD.stop) { this.state = 0; this.ch = { 1: 0, 2: 0 }; this.remaining = 0 }
    const r = Uint8Array.of(0x1b, 0xc0, cmd & 0x7f, 0, 0)
    r[4] = crc8Maxim(r.subarray(0, 4))
    queueMicrotask(() => {
      this.reply.notify(r)
      if ([CMD.start, CMD.intensity, CMD.pause, CMD.resume, CMD.stop].includes(cmd as never)) this.pushSession()
    })
  }

  private pushSession() {
    const r = this.remaining
    this.session.notify(Uint8Array.of(this.state, 0, this.tag, r & 0xff, r >> 8, this.ch[1], 0, this.ch[2], 0))
  }
}

export function fakeBluetooth(device: FakeTens, known = false): BleBluetooth {
  return {
    requestDevice: async () => device,
    ...(known ? { getDevices: async () => [device] } : {}),
  }
}
