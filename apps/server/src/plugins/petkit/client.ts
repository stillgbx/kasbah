import type { Logger } from 'pino'
import { PluginError } from '../../core/plugin'
import type { FetchLike } from '../../core/sse'
import { PetkitAuth } from './auth'
import { detailPath } from './mapping'
import { petkitEnvelopeSchema } from './types'

// Client HTTP de PetKit. Ce qu'il traduit :
//  - un refus de session (code 5, en HTTP 200) → la session est JETÉE et l'erreur remonte en
//    `NEEDS_PAIRING`. Sans mot de passe, il n'y a rien à retenter tout seul : la carte des Réglages
//    doit redemander un code. Garder une session morte ferait échouer chaque appel en silence,
//    pendant toute la durée du bail — le bug connu qu'on refuse de reproduire ;
//  - 429 → `RATE_LIMITED` ;
//  - le reste en `UPSTREAM_ERROR`.
//
// Aucun seau à jetons : PetKit ne publie pas de quota. Ce qui protège ici est la CADENCE (cinq
// minutes pour les mangeoires, dix pour les fontaines), pas un compteur. À revoir le jour où le
// fabricant se met à répondre 429 — ce que `RATE_LIMITED` rendra visible dans les Réglages.

export const REQUEST_TIMEOUT_MS = 30_000

export interface PetkitClientOptions {
  auth: PetkitAuth
  fetchImpl: FetchLike
  logger?: Logger
  requestTimeoutMs?: number
}

export class PetkitClient {
  constructor(private readonly opts: PetkitClientOptions) {}

  /**
   * Les « familles » du compte. Étape OBLIGATOIRE avant l'inventaire : le roster se demande par
   * groupe, il n'existe pas de vue « tout le compte ». C'est aussi par là que passent les appareils
   * qu'un autre compte a partagés — le cas de cette maison, puisque le compte est dédié.
   */
  families(signal?: AbortSignal): Promise<unknown> {
    return this.post('group/family/list', {}, signal)
  }

  /**
   * L'inventaire d'UN groupe. `day` et `groupId` sont exigés : sans eux, PetKit répond
   * « Request is incorrect. » — vérifié sur le vrai compte le 21/09.
   */
  roster(groupId: string, day: string, signal?: AbortSignal): Promise<unknown> {
    return this.post('discovery/device_roster_v2', { day, groupId }, signal)
  }

  /**
   * L'état d'un appareil. Le chemin dépend de la FAMILLE, pas seulement du modèle : une mangeoire
   * répond sur `<type>/device_detail`, une fontaine Bluetooth sur `<type>/deviceData` (voir
   * `detailPath`). Pour une fontaine, ce que rend le cloud est la DERNIÈRE SYNCHRO — ouvrir un
   * relais avant cet appel est ce qui la rafraîchit.
   */
  deviceDetail(type: string, deviceId: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(detailPath(type), { id: deviceId }, signal)
  }

  /**
   * Servir une ration. `amount` en grammes pour une mangeoire à une seule trémie (`d4`) ; les
   * modèles à deux trémies veulent `amount1`/`amount2`, et ne sont pas couverts ici.
   *
   * `day` : PetKit range la ration dans le plan du JOUR courant, au format AAAAMMJJ. Sans lui, la
   * ration part dans un jour indéterminé selon les bibliothèques tierces.
   */
  manualFeed(type: string, deviceId: string, grams: number, day: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(`${type}/saveDailyFeed`, { deviceId, day, time: '-1', amount: String(grams) }, signal)
  }

  /**
   * Les PASSAGES du jour à une fontaine. Trois paramètres exigés, dont l'identifiant de
   * l'UTILISATEUR propriétaire — que porte l'appareil lui-même (`userId` de son relevé) : sans
   * lui, « L'appareil n'a pas été trouvé. (code 703) ».
   */
  workRecord(o: { type: string; deviceId: string; userId: string }, day: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(`${o.type}/getWorkRecord`, { day, deviceId: o.deviceId, userId: o.userId }, signal)
  }

  /** Jouer le son enregistré pour appeler l'animal. */
  callPet(type: string, deviceId: string, signal?: AbortSignal): Promise<unknown> {
    return this.post(`${type}/callPet`, { deviceId }, signal)
  }

  /**
   * Requête authentifiée. `ensureFresh` d'abord : la session se prolonge avant d'être utilisée,
   * jamais après un échec — sans mot de passe, un échec est déjà trop tard.
   */
  async post(path: string, form: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    await this.opts.auth.ensureFresh(signal)
    const url = `${this.opts.auth.gateway.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => { ctrl.abort() }, this.opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
    try {
      const res = await this.opts.fetchImpl(url, {
        method: 'POST',
        headers: {
          // Le jeu COMPLET, comme sur les appels non authentifiés : `X-Api-Version`, `X-Client`,
          // `X-TimezoneId`… Les omettre ici faisait répondre « Request is incorrect. » à
          // `discovery/device_roster_v2` alors même que la session était valide (vérifié le 21/09).
          ...this.opts.auth.baseHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
          ...this.opts.auth.headers(),
        },
        body: new URLSearchParams(form).toString(),
        signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal,
      })
      if (res.status === 429) throw new PluginError('RATE_LIMITED', `PetKit ${path}: rate limited`)
      if (res.status === 401 || res.status === 403) {
        await this.opts.auth.invalidate()
        throw new PluginError('NEEDS_PAIRING', `PetKit ${path}: session refused (HTTP ${res.status})`)
      }
      if (!res.ok) throw new PluginError('UPSTREAM_ERROR', `PetKit ${path}: HTTP ${res.status}`)
      const body = (await res.json()) as unknown
      if (PetkitAuth.isSessionError(body)) {
        await this.opts.auth.invalidate()
        throw new PluginError('NEEDS_PAIRING', `PetKit ${path}: session expired`)
      }
      const env = petkitEnvelopeSchema.safeParse(body)
      if (env.success && env.data.error) {
        // Le CODE dans le message : « Request is incorrect. » seul ne dit pas quoi corriger, alors
        // que « (code 3) » désigne des en-têtes incomplets et « (code 5) » une session morte.
        const code = env.data.error.code === undefined ? '' : ` (code ${String(env.data.error.code)})`
        throw new PluginError('UPSTREAM_ERROR', `PetKit ${path}: ${String(env.data.error.msg ?? 'refused')}${code}`)
      }
      return env.success && env.data.result !== undefined ? env.data.result : body
    } finally { clearTimeout(timer) }
  }
}

/** Le jour courant au format que PetKit attend pour ranger une ration (AAAAMMJJ, heure locale). */
export function petkitDay(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
