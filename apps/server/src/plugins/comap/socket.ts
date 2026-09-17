import type { Duplex } from 'node:stream'
import { createConnection } from 'node:net'
import type { Clock } from '../../core/clock'
import { PluginError } from '../../core/plugin'

// Transport TCP texte de la station Proteo 2 : JSON en clair, UNE ligne par message, requête
// terminée par `\r\n`, sans authentification. Ni HTTP ni Modbus — le seul précédent de socket brut
// du projet est TLS (`google_cast/channel.ts`), dont ce fichier reprend le patron de fabrique
// injectable pour rester testable sans vraie station.
//
// La station n'accepte qu'UNE connexion TCP à la fois (vérifié le 2026-09-16 : une lecture faite
// pendant que l'appli mobile du fabricant tenait la connexion a été acceptée puis rendue muette,
// sans réponse ni erreur). D'où le choix : une connexion COURTE par lecture, ouverte puis refermée
// aussitôt la réponse reçue — jamais une connexion permanente, qui monopoliserait la station et
// casserait l'appli du propriétaire.

export type SocketFactory = (host: string, port: number) => Promise<Duplex>

/** Socket TCP réelle, résolue une fois la connexion établie. */
export const netSocketFactory: SocketFactory = (host, port) => new Promise((resolve, reject) => {
  const socket = createConnection({ host, port }, () => { socket.off('error', reject); resolve(socket) })
  socket.once('error', reject)
})

export interface ReadOnceOptions {
  host: string
  port: number
  /** Corps de la requête `read`, tel qu'écrit sur le fil (voir `mapping.ts`). */
  request: Record<string, unknown>
  connect: SocketFactory
  clock: Clock
  /** Annulé par `stop()` : une connexion en cours est détruite plutôt que laissée pendre. */
  signal: AbortSignal
  timeoutMs: number
}

/**
 * Une lecture : ouvre la connexion, écrit la requête, attend LA PREMIÈRE ligne de réponse, referme.
 * Bornée par `timeoutMs` ET par `signal` — la station ACCEPTE la connexion même quand elle est déjà
 * occupée par ailleurs, et ne répond alors jamais : sans cette double borne, le socket et le poller
 * resteraient pendus en silence.
 */
export function readOnce(opts: ReadOnceOptions): Promise<unknown> {
  const { host, port, request, connect, clock, signal, timeoutMs } = opts
  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    let socket: Duplex | null = null
    let buffer = ''

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clock.clearTimeout(timeoutHandle)
      signal.removeEventListener('abort', onAbort)
      socket?.destroy()
      fn()
    }
    const onAbort = () => finish(() => reject(new PluginError('DEVICE_UNAVAILABLE', 'connection aborted (plugin stopping)')))
    const timeoutHandle = clock.setTimeout(
      () => finish(() => reject(new PluginError('TIMEOUT', `no answer from ${host}:${port} after ${timeoutMs} ms`))),
      timeoutMs,
    )
    signal.addEventListener('abort', onAbort, { once: true })

    connect(host, port).then((s) => {
      if (settled) { s.destroy(); return }
      socket = s
      s.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8')
        // La vraie station ne termine PAS ses réponses par un saut de ligne (relevé le 2026-09-16 :
        // `}}}}` sans rien derrière, contre `}}\r\n` côté requête) — seul le patron
        // `google_cast/channel.ts` dont ce fichier s'inspire en attendait un. Une réponse complète se
        // reconnaît donc au JSON valide qu'elle forme, `\n` ou pas. Le `\n` reste tenté en premier
        // (gratuit, protège d'une variante de firmware qui en ajouterait un) ; sans lui, on retente le
        // buffer entier — une fois par chunk, jamais par octet — et un JSON encore tronqué (chunk coupé
        // en plein milieu) ne fait qu'attendre la suite au lieu de résoudre sur du partiel.
        const nl = buffer.indexOf('\n')
        const candidate = nl === -1 ? buffer : buffer.slice(0, nl).replace(/\r$/, '')
        let parsed: unknown
        try { parsed = JSON.parse(candidate) } catch (err) {
          if (nl === -1) return // pas de saut de ligne : trame potentiellement encore incomplète, on attend
          finish(() => reject(err as Error))
          return
        }
        finish(() => resolve(parsed))
      })
      s.on('error', (err: Error) => finish(() => reject(err)))
      s.on('close', () => finish(() => reject(new PluginError('DEVICE_UNAVAILABLE', 'connection closed before an answer'))))
      s.write(`${JSON.stringify(request)}\r\n`)
    }).catch((err: Error) => finish(() => reject(err)))
  })
}
