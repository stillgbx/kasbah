import { Duplex, PassThrough } from 'node:stream'
import { ManualClock } from '@kasbah/mock-sim'
import { describe, expect, it } from 'vitest'
import { readOnce, type SocketFactory } from './socket'

const REQUEST = { '1234567': { msgId: 5, read: ['status'] } }
const REPLY = { '1234567': { msgId: 5, read: { status: { warning: 0, defect: 0, uvc: 1, mode: 1 } } } }

/**
 * Fabrique une paire de tuyaux en mémoire, et rejoue `chunks` sur `fromStation` un par un, chacun
 * sur son propre `setImmediate` — pour de vrai forcer des évènements `data` SÉPARÉS (des écritures
 * synchrones avant tout abonnement seraient livrées en un seul chunk, et ne testeraient rien).
 */
function stationThatSends(chunks: string[]): SocketFactory {
  return async () => {
    const toStation = new PassThrough(), fromStation = new PassThrough()
    const socket = Duplex.from({ writable: toStation, readable: fromStation })
    let i = 0
    const pump = () => {
      if (i >= chunks.length) return
      fromStation.write(chunks[i++])
      setImmediate(pump)
    }
    setImmediate(pump)
    return socket
  }
}

const read = (connect: SocketFactory) => readOnce({
  host: '192.168.1.92', port: 23, request: REQUEST, connect, clock: new ManualClock(0),
  signal: new AbortController().signal, timeoutMs: 5000,
})

describe('comap socket framing', () => {
  // Bug réel du 2026-09-16 : la station ne termine JAMAIS ses réponses par un saut de ligne
  // (capture `dialogue-app-station.log` : `}}}}` puis rien). Avec l'ancien cadrage
  // (`buffer.indexOf('\n')`), cette trame ne résout jamais et le sondage expire à chaque fois.
  it('resolves a reply with no trailing newline at all (the real station)', async () => {
    await expect(read(stationThatSends([JSON.stringify(REPLY)]))).resolves.toEqual(REPLY)
  })

  it('still resolves a reply terminated by \\n, in case a firmware variant adds one', async () => {
    await expect(read(stationThatSends([`${JSON.stringify(REPLY)}\n`]))).resolves.toEqual(REPLY)
  })

  it('waits for the second chunk instead of resolving on a JSON truncated mid-object', async () => {
    const full = JSON.stringify(REPLY)
    const cut = Math.floor(full.length / 2) // coupe en plein milieu d'une clé/valeur, jamais sur une frontière
    await expect(read(stationThatSends([full.slice(0, cut), full.slice(cut)]))).resolves.toEqual(REPLY)
  })
})
