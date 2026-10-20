import type { DeviceKind } from './kinds'
import type { DeviceState } from './state'

// The ALERTS of a device, drawn from its state alone: nothing new on the wire, and the same rule
// will serve the server the day an automation or a notification needs it.
//
// The id carries what makes the alert NEW (the proposed version, the code and the time of the fault):
// an alert that has been seen does not come back as long as it is the same, the next one reappears on its own.

/**
 * `info`: good to know (an update is waiting), seen as soon as its page is opened.
 * `problem`: something is to be done (robot in fault, kibble to refill, orange warning), held until it is resolved.
 * `critical`: the same thing but more serious (red warning).
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
   * What the alert text names, depending on its type: the proposed version, the
   * vendor's message, the phenomenon of the warning, the consumable (`desiccant`, `filter`).
   */
  detail?: string
}

/** Below this threshold, the filter or the battery of a fountain is to be changed — the mark on its card. */
const PET_LOW_PCT = 20

/**
 * The ongoing alerts of a device, or `null` when its state does not allow saying (unreachable
 * device, vehicle never read). `null` is NOT "no alert": a seen alert is only
 * forgotten on a reading that says it is over. Pure.
 *
 * An unreachable robot or pet device keeps the alerts of its last state: a
 * mower in fault that lost the network is still in fault, nothing says it is resolved.
 */
export function deviceAlerts(deviceId: string, state: DeviceState): DeviceAlert[] | null {
  const alert = (severity: AlertSeverity, type: DeviceAlert['type'], key: string, detail?: string): DeviceAlert =>
    ({ id: `${deviceId}|${type}|${key}`, deviceId, kind: state.kind, severity, type, ...(detail ? { detail } : {}) })
  switch (state.kind) {
    case 'vehicle': {
      if (!state.available || state.readAt === undefined) return null
      // pending under all its statuses (scheduled, downloading…): the same update,
      // the same alert — seeing it holds for its whole life
      const up = state.softwareUpdate
      return up ? [alert('info', 'software_update', up.version ?? '', up.version)] : []
    }
    case 'mower':
      // same rule as the status line of the Robots view: an error code is enough
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
      // yellow stays on the Weather page; orange and red get flagged. An episode = a
      // phenomenon, a level, a start: going from orange to red makes it a new alert.
      if (!state.available || !state.vigilance) return null
      return state.vigilance.flatMap((w) => w.level === 'yellow' ? [] : [alert(w.level === 'red' ? 'critical' : 'problem', 'vigilance', `${w.type}:${w.level}@${w.onset}`, w.type)])
    default:
      return []
  }
}
