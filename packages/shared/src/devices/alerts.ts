import type { DeviceKind } from './kinds'
import type { DeviceState } from './state'

// Les ALERTES d'un appareil, tirées de son seul état : rien de neuf sur le fil, et la même règle
// servira au serveur le jour où une automatisation ou une notification en aura besoin.
//
// L'id porte ce qui rend l'alerte NOUVELLE (la version proposée, le code et l'heure de la panne) :
// une alerte vue ne revient pas tant qu'elle est la même, la suivante réapparaît d'elle-même.

/**
 * `info` : à savoir (une mise à jour attend), vue dès qu'on ouvre sa page.
 * `problem` : quelque chose est à faire (robot en panne, croquettes à remettre, vigilance orange), tenue jusqu'à ce qu'elle se règle.
 * `critical` : la même chose en plus grave (vigilance rouge).
 */
export const ALERT_SEVERITIES = ['info', 'problem', 'critical'] as const
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number]

export interface DeviceAlert {
  id: string
  deviceId: string
  kind: DeviceKind
  severity: AlertSeverity
  type: 'software_update' | 'device_error' | 'vigilance' | 'supply_low' | 'consumable' | 'battery_low'
  /**
   * Ce que le texte de l'alerte nomme, selon son type : la version proposée, le message du
   * fabricant, le phénomène de la vigilance, le consommable (`desiccant`, `filter`).
   */
  detail?: string
}

/** Sous ce seuil, le filtre ou la batterie d'une fontaine est à changer — le repère de sa carte. */
const PET_LOW_PCT = 20

/**
 * Les alertes en cours d'un appareil, ou `null` quand son état ne permet pas de le dire (appareil
 * injoignable, véhicule jamais lu). `null` n'est PAS « aucune alerte » : une alerte vue ne
 * s'oublie que sur une lecture qui dit qu'elle est finie. Pur.
 *
 * Un robot ou un appareil pour animaux injoignable garde les alertes de son dernier état : une
 * tondeuse en panne qui a perdu le réseau est toujours en panne, rien ne dit que c'est réglé.
 */
export function deviceAlerts(deviceId: string, state: DeviceState): DeviceAlert[] | null {
  const alert = (severity: AlertSeverity, type: DeviceAlert['type'], key: string, detail?: string): DeviceAlert =>
    ({ id: `${deviceId}|${type}|${key}`, deviceId, kind: state.kind, severity, type, ...(detail ? { detail } : {}) })
  switch (state.kind) {
    case 'vehicle': {
      if (!state.available || state.readAt === undefined) return null
      // en attente sous tous ses statuts (programmée, en téléchargement…) : la même mise à jour,
      // la même alerte — la voir vaut pour toute sa vie
      const up = state.softwareUpdate
      return up ? [alert('info', 'software_update', up.version ?? '', up.version)] : []
    }
    case 'mower':
      // même règle que la ligne d'état de la vue Robots : un code d'erreur suffit
      return state.activity === 'error' || state.errorCode !== undefined
        ? [alert('problem', 'device_error', `${state.errorCode ?? ''}@${state.errorAt ?? ''}`, state.errorMessage)]
        : []
    case 'vacuum':
      return state.activity === 'error' ? [alert('problem', 'device_error', state.errorMessage ?? '', state.errorMessage)] : []
    case 'pet_feeder': {
      const out: DeviceAlert[] = []
      if (state.errorMessage) out.push(alert('problem', 'device_error', state.errorMessage, state.errorMessage))
      if (state.foodLow) out.push(alert('problem', 'supply_low', 'food'))
      if (state.desiccantDays === 0) out.push(alert('problem', 'consumable', 'desiccant', 'desiccant'))
      return out
    }
    case 'pet_fountain': {
      const out: DeviceAlert[] = []
      if (state.errorMessage) out.push(alert('problem', 'device_error', state.errorMessage, state.errorMessage))
      if (state.waterLow) out.push(alert('problem', 'supply_low', 'water'))
      if (state.filterPct !== undefined && state.filterPct < PET_LOW_PCT) out.push(alert('problem', 'consumable', 'filter', 'filter'))
      if (state.batteryPct !== undefined && state.batteryPct < PET_LOW_PCT) out.push(alert('problem', 'battery_low', ''))
      return out
    }
    case 'weather':
      // le jaune reste sur la page Météo ; l'orange et le rouge se signalent. Un épisode = un
      // phénomène, un niveau, un début : passer d'orange à rouge en fait une nouvelle alerte.
      if (!state.available || !state.vigilance) return null
      return state.vigilance.flatMap((w) => w.level === 'yellow' ? [] : [alert(w.level === 'red' ? 'critical' : 'problem', 'vigilance', `${w.type}:${w.level}@${w.onset}`, w.type)])
    default:
      return []
  }
}
