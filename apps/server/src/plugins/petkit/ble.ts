import type { Logger } from 'pino'
import { sleep, type Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'
import type { PetkitClient } from './client'
import type { PetPumpMode } from '@kasbah/shared'
import { bleRelaysSchema } from './types'

// Relais Bluetooth : comment on atteint une fontaine qui n'a PAS de Wi-Fi.
//
// Une Eversweet Max ne parle qu'en Bluetooth. Pour la lire ou lui commander quelque chose, le
// cloud demande à un appareil PetKit Wi-Fi VOISIN (ici la mangeoire posée à côté d'elle) d'ouvrir
// une liaison vers elle. La séquence est toujours la même :
//
//   ownSupportBleDevices → qui peut relayer ?   (vide = renoncer, ce n'est pas une panne)
//   connect              → la demande est-elle acceptée ?
//   poll × n             → la liaison est-elle établie ?   (0 en cours, 1 connecté, -1 échec)
//   … lecture ou commande …
//   cancel               → refermer
//
// Les 4 s entre deux `poll` sont un délai d'ÉTABLISSEMENT, pas une cadence de rafraîchissement :
// c'est le temps que met une radio à accrocher, et il ne se règle pas. Ce qui se règle, c'est la
// fréquence à laquelle on rouvre une session (dix minutes, voir `PETKIT_FOUNTAIN_SYNC_MS`).
//
// Conséquence à ne pas perdre de vue : une lecture de fontaine peut coûter DEUX MINUTES au pire.
// L'appelant ne doit jamais l'attendre en tenant une commande utilisateur.

export const BLE_POLL_INTERVAL_MS = 4000
export const BLE_CONNECT_ATTEMPTS = 32

/** Entête et pied que PetKit attend autour de chaque trame de commande. */
const FRAME_START = [250, 252, 253]
const FRAME_END = [251]

/** États rendus par `ble/poll`. */
const CONNECTING = 0, CONNECTED = 1, FAILED = -1

/**
 * La trame d'un ordre de pompe, MESUREE sur la vraie fontaine le 21/09.
 *
 *   [250,252,253]  en-tete
 *   220            code de l'ordre « regler la pompe »
 *   1, <compteur>  numero de sequence : deux trames identiques passeraient pour un doublon
 *   3, 0           longueur de la charge utile
 *   <marche>       1 = la pompe tourne, 0 = en pause
 *   <mode>, <mode> 1 = continu, 2 = intermittent — **REPETE deux fois**
 *   [251]          pied
 *
 * Le mode repete est ce que la table de la bibliotheque de reference avait faux : elle donne
 * `…,1,2,1` pour l'intermittent, et cette trame-la est ACCEPTEE (accuse « 1 ») sans rien changer.
 * Seul `…,1,2,2` fait passer la machine en intermittent. Un accuse ne prouve donc rien ici — c'est
 * la relecture du mode qui tranche, et c'est ainsi qu'on l'a trouve.
 *
 * L'ARRÊT est vérifié lui aussi : `marche: 0` fait passer `status.powerStatus` à 0 **et laisse le
 * mode intact** (2 avant, 2 après), puis la remise en route revient à 1 du premier coup. C'est
 * exactement ce que le motif annonçait, et la raison pour laquelle le mode ne se code pas en dur
 * dans la trame d'arrêt : une constante figée ferait repasser la fontaine en continu à chaque
 * extinction.
 */
export function pumpFrame(o: { on: boolean; mode: PetPumpMode; counter: number }): number[] {
  const m = o.mode === 'intermittent' ? 2 : 1
  return [220, 1, o.counter, 3, 0, o.on ? 1 : 0, m, m]
}

export interface BleTarget {
  /** Identifiant PetKit de la fontaine. */
  bleId: string
  /**
   * Code NUMÉRIQUE du modèle (24 pour une Ctw3), pris dans le roster. La chaîne (`"ctw3"`) est
   * refusée par « Vous n'avez pas de permission. (code 4) », ce qui ne ressemble pourtant en rien
   * à une erreur de paramètre — vérifié le 21/09.
   */
  type: string
  mac: string
  /** Groupe (« famille ») auquel elle appartient : c'est par groupe qu'on cherche un relais. */
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
   * Compteur de trames, par fontaine. PetKit l'insère dans la commande ; deux commandes portant le
   * même compteur passeraient pour un doublon.
   */
  private counters = new Map<string, number>()

  constructor(private readonly opts: BleRelayOptions) {}

  /**
   * Y a-t-il un appareil capable de relayer vers cette fontaine, ET en ligne ? Non ≠ panne : le
   * relais peut être débranché ou hors de portée. `pim` est ce qui distingue les deux — un relais
   * listé mais éteint accepterait la demande et ne relaierait rien.
   */
  async hasRelay(target: BleTarget): Promise<boolean> {
    const body = await this.opts.client.post('ble/ownSupportBleDevices', { groupId: target.groupId }, this.opts.signal)
    const parsed = bleRelaysSchema.safeParse(body)
    return parsed.success && parsed.data.some((r) => r.pim === undefined || r.pim === 1)
  }

  /**
   * Ouvre une liaison et la garde le temps de `run`, puis la referme QUOI QU'IL ARRIVE — une
   * liaison laissée ouverte immobilise le relais, donc la mangeoire, pour les appels suivants.
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
   * Règle la pompe : marche/arrêt ET régime, en une trame — les deux voyagent ensemble, on ne peut
   * pas en changer un sans redire l'autre. La liaison doit être ouverte (`withConnection`).
   */
  async setPump(target: BleTarget, o: { on: boolean; mode: PetPumpMode }): Promise<void> {
    const counter = (this.counters.get(target.bleId) ?? 0) + 1
    this.counters.set(target.bleId, counter)
    const body = pumpFrame({ ...o, counter })
    const data = encodeURIComponent(Buffer.from([...FRAME_START, ...body, ...FRAME_END]).toString('base64'))
    const ack = await this.opts.client.post('ble/controlDevice', {
      ...this.frameTarget(target), cmd: String(body[0]), data,
    }, this.opts.signal)
    // L'accusé dit « trame déposée », jamais « la pompe a obéi » — VÉRIFIÉ ici au sens fort : une
    // trame au mauvais dernier octet est accusée « 1 » et ne change rien. C'est la relecture qui
    // tranche, jamais l'accusé (même leçon que sur le Roomba).
    if (!isAccepted(ack)) throw new PluginError('UPSTREAM_ERROR', 'PetKit refused the Bluetooth frame')
  }

  private frameTarget(t: BleTarget): Record<string, string> {
    return { bleId: t.bleId, type: t.type, mac: t.mac }
  }
}

/** `1`, `{state:1}` ou `{"result":1}` selon les points d'entrée : tous veulent dire « accepté ». */
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
