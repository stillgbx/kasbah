import type { DeviceKind } from './kinds'
import type { DeviceState } from './state'

// Les ALERTES d'un appareil, tirées de son seul état : rien de neuf sur le fil, et la même règle
// servira au serveur le jour où une automatisation ou une notification en aura besoin.
//
// L'id porte ce qui rend l'alerte NOUVELLE (la version proposée, le code et l'heure de la panne) :
// une alerte fermée ne revient pas tant qu'elle est la même, la suivante réapparaît d'elle-même.

/**
 * `info` : à savoir (une mise à jour attend), vue dès qu'on ouvre sa page.
 * `problem` : quelque chose ne va pas (robot en panne, vigilance orange), tenue jusqu'à ce qu'on la ferme ou qu'elle se règle.
 * `critical` : ne se ferme pas, disparaît avec sa cause (vigilance rouge).
 */
export const ALERT_SEVERITIES = ['info', 'problem', 'critical'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export interface DeviceAlert {
  id: string
  deviceId: string
  kind: DeviceKind
  severity: AlertSeverity
  type: 'software_update' | 'device_error' | 'vigilance'
}

/**
 * Les alertes en cours d'un appareil, ou `null` quand son état ne permet pas de le dire (appareil
 * injoignable, véhicule jamais lu). `null` n'est PAS « aucune alerte » : une alerte fermée ne
 * s'oublie que sur une lecture qui dit qu'elle est finie. Pur.
 */
export function deviceAlerts(deviceId: string, state: DeviceState): DeviceAlert[] | null {
  if (!state.available) return null
  const alert = (severity: AlertSeverity, type: DeviceAlert['type'], key: string): DeviceAlert =>
    ({ id: `${deviceId}|${type}|${key}`, deviceId, kind: state.kind, severity, type })
  switch (state.kind) {
    case 'vehicle': {
      if (state.readAt === undefined) return null
      // en attente sous tous ses statuts (programmée, en téléchargement…) : la même mise à jour,
      // la même alerte — la fermer vaut pour toute sa vie
      const up = state.softwareUpdate
      return up ? [alert('info', 'software_update', up.version ?? '')] : []
    }
    case 'mower':
      // même règle que la ligne d'état de la vue Robots : un code d'erreur suffit
      return state.activity === 'error' || state.errorCode !== undefined
        ? [alert('problem', 'device_error', `${state.errorCode ?? ''}@${state.errorAt ?? ''}`)]
        : []
    case 'vacuum':
      return state.activity === 'error' ? [alert('problem', 'device_error', state.errorMessage ?? '')] : []
    case 'weather':
      // le jaune reste sur la page Météo ; l'orange se signale, le rouge ne se ferme pas. Un épisode
      // = un phénomène, un niveau, un début : passer d'orange à rouge en fait une nouvelle alerte.
      if (!state.vigilance) return null
      return state.vigilance.flatMap((w) => w.level === 'yellow' ? [] : [alert(w.level === 'red' ? 'critical' : 'problem', 'vigilance', `${w.type}:${w.level}@${w.onset}`)])
    default:
      return []
  }
}
