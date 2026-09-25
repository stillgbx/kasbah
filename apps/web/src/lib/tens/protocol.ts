// Protocole Bluetooth de l'actiTENS mini (Sublimed, `acTENSv2_…`), relevé par capture le 2026-09-25 :
// voir `_generated-ai-doc/tens/protocole.md`. Pur — ni Bluetooth ni Vue — pour se tester sans l'appareil.
//
// Une trame : `1b 40 <commande> <longueur> <données…> <crc>` de Kasbah vers le TENS, et
// `1b c0 <commande & 0x7f> <longueur> <données…> <crc>` en réponse (`1b e0 …` : événement spontané).
// Le contrôle est un CRC-8/MAXIM sur toute la trame, vérifié sur les 74 trames capturées.

export const TENS_SERVICE = '59994ce0-ba92-4fe6-be82-84b98195945b'
export const TENS_COMMAND_CHAR = '59994ce1-ba92-4fe6-be82-84b98195945b'
export const TENS_REPLY_CHAR = '59994ce2-ba92-4fe6-be82-84b98195945b'
export const TENS_STATUS_SERVICE = '9c7786c0-fbcb-11e5-a837-0800200c9a66'
export const TENS_BATTERY_CHAR = '9c7786c2-fbcb-11e5-a837-0800200c9a66'
export const TENS_SESSION_CHAR = '9c7786c4-fbcb-11e5-a837-0800200c9a66'

export const CMD = {
  hello: 0x85,
  program: 0xa0,
  start: 0xa1,
  intensity: 0xa2,
  stop: 0xa3,
  pause: 0xa4,
  resume: 0xa5,
  check: 0xa6,
  register: 0x93,
} as const

/**
 * Le jeton de 4 octets que l'appli joint à chaque commande. Aucune réponse du TENS ne le contient :
 * c'est peut-être un identifiant de séance choisi par l'appli, peut-être une valeur liée au compte.
 * On rejoue celui de la capture ; le premier essai en direct dira si une autre valeur passe.
 */
export const TENS_TOKEN = Uint8Array.of(0x2a, 0x11, 0x5b, 0x4a)

/** CRC-8/MAXIM (Dallas 1-Wire) : polynôme 0x31 réfléchi (0x8c), init 0, sans xor final. */
export function crc8Maxim(bytes: Uint8Array): number {
  let crc = 0
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0x8c : crc >>> 1
  }
  return crc
}

export function encodeFrame(cmd: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const out = new Uint8Array(payload.length + 5)
  out.set([0x1b, 0x40, cmd, payload.length])
  out.set(payload, 4)
  out[out.length - 1] = crc8Maxim(out.subarray(0, -1))
  return out
}

export interface TensReply { kind: 'reply' | 'event'; cmd: number; payload: Uint8Array }

/** Une trame reçue sur le canal de réponse, ou `null` si elle est tronquée ou corrompue. */
export function parseFrame(bytes: Uint8Array): TensReply | null {
  if (bytes.length < 5 || bytes[0] !== 0x1b) return null
  const kind = bytes[1] === 0xc0 ? 'reply' : bytes[1] === 0xe0 ? 'event' : null
  if (!kind) return null
  const len = bytes[3]!
  if (bytes.length !== len + 5) return null
  if (crc8Maxim(bytes.subarray(0, -1)) !== bytes[bytes.length - 1]) return null
  return { kind, cmd: bytes[2]!, payload: bytes.slice(4, 4 + len) }
}

/** La réponse attendue à une commande : même numéro, bit de poids fort retiré (a2 → 22). */
export const replyCmd = (cmd: number) => cmd & 0x7f

/** Réponse de REFUS : `1b c0 7f 02 <commande refusée> <code>` (code 5 pour un programme mal formé). */
export const REFUSED = 0x7f

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff]

/** Canaux 1, 2 ou les deux — le masque que porte la vérification des électrodes. */
export type TensChannels = 1 | 2 | 3

/**
 * Vérification automatique des électrodes (le TENS y fait passer 0,5 mA), premier temps de chaque
 * lancement. La queue `64 00 00 00 10 27 00 00` est rejouée telle quelle : identique dans toutes
 * les captures, sens inconnu.
 */
export const checkFrame = (channels: TensChannels) =>
  encodeFrame(CMD.check, Uint8Array.of(channels, ...TENS_TOKEN, 0x64, 0, 0, 0, 0x10, 0x27, 0, 0))

/**
 * Un segment de programme : `<identifiant de séance> <nombre de segments> <corps capturé>`. Le
 * nombre de segments se lit dans toutes les captures (01 pour P1-P4 et P12, 02 pour P5-P8, P10,
 * P11, 04 pour P9) ; un mauvais nombre est refusé (`1b c0 7f 02 a0 05`, relevé en direct).
 */
export const programFrame = (sessionTag: number, segmentCount: number, segment: Uint8Array) =>
  encodeFrame(CMD.program, Uint8Array.of(sessionTag & 0xff, segmentCount, ...segment))

export const startFrame = (durationS: number) => encodeFrame(CMD.start, Uint8Array.of(...u16(durationS), ...TENS_TOKEN))

/** Intensité ABSOLUE d'un canal, en dixièmes de milliampère (50 = 5,0 mA). */
export const intensityFrame = (channel: 1 | 2, tenths: number) =>
  encodeFrame(CMD.intensity, Uint8Array.of(channel, ...u16(tenths), ...TENS_TOKEN))

export const pauseFrame = () => encodeFrame(CMD.pause, TENS_TOKEN)
export const resumeFrame = () => encodeFrame(CMD.resume, TENS_TOKEN)
export const stopFrame = () => encodeFrame(CMD.stop, TENS_TOKEN)
export const helloFrame = () => encodeFrame(CMD.hello)
/** Registre 0x3c : l'appli l'arme (`ff`) juste après le démarrage et le remet à 0 après l'arrêt. */
export const sessionFlagFrame = (on: boolean) => encodeFrame(CMD.register, Uint8Array.of(0x3c, on ? 0xff : 0))

export interface TensBattery {
  charging: boolean
  millivolts: number
  /** Déduit de la tension par l'appareil : un faux 100 % dès qu'il est sur le câble. */
  percent: number
}

/** Caractéristique batterie (`c2`) : `[en charge][?][mV LE16][%]`. */
export function decodeBattery(bytes: Uint8Array): TensBattery | null {
  if (bytes.length < 5) return null
  return { charging: bytes[0] === 1, millivolts: bytes[2]! | (bytes[3]! << 8), percent: bytes[4]! }
}

export type TensSessionState = 'idle' | 'ready' | 'running' | 'paused'
const SESSION_STATES: Record<number, TensSessionState> = { 0: 'idle', 1: 'ready', 2: 'running', 3: 'paused' }

export interface TensSession {
  state: TensSessionState
  /** Octet 1 : `02` après un arrêt demandé — raison de fin présumée, gardée brute. */
  reason: number
  /** Octet bas de l'identifiant de séance envoyé avec le programme. */
  sessionTag: number
  remainingS: number
  /** Intensités en dixièmes de mA. */
  ch1: number
  ch2: number
}

/** Caractéristique séance (`c4`) : `[état][raison][séance][s restantes LE16][c1 LE16][c2 LE16]`. */
export function decodeSession(bytes: Uint8Array): TensSession | null {
  if (bytes.length < 9) return null
  return {
    state: SESSION_STATES[bytes[0]!] ?? 'idle',
    reason: bytes[1]!,
    sessionTag: bytes[2]!,
    remainingS: bytes[3]! | (bytes[4]! << 8),
    ch1: bytes[5]! | (bytes[6]! << 8),
    ch2: bytes[7]! | (bytes[8]! << 8),
  }
}

/** Pas des boutons + / − de l'appli, et de sa montée progressive : 0,5 mA. */
export const INTENSITY_STEP = 5

/**
 * Les paliers pour aller d'une intensité à une autre, comme le fait l'appli : jamais de saut, un
 * pas de 0,5 mA à la fois en montée. La descente, elle, est immédiate — baisser le courant ne
 * doit jamais attendre.
 */
export function rampSteps(from: number, to: number, step = INTENSITY_STEP): number[] {
  if (to <= from) return to === from ? [] : [to]
  const out: number[] = []
  let v = from
  while (v < to) {
    v = Math.min(to, (Math.floor(v / step) + 1) * step)
    out.push(v)
  }
  return out
}
