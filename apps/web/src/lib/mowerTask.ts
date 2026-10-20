import type { StateFor } from '@kasbah/shared'
import { formatAgo } from './format'

// What the mower is doing, in one sentence: "Heading to Back", "Mowing · Front",
// "Returning to the station". The activity alone ("Mowing") does not say WHERE: it is the current zone
// (`workAreaId`) and the departure (`leaving`) that specify it. Empty when there is nothing to add to
// the activity — a robot without zones that is mowing, a parked robot.

type Translate = (key: string, values?: Record<string, unknown>) => string
type WorkArea = NonNullable<StateFor<'mower'>['workAreas']>[number]

/** A zone's name; zone `0` without a name is the whole terrain (Husqvarna publishes it that way). */
export function workAreaLabel(a: Pick<WorkArea, 'id' | 'name'>, t: Translate): string {
  return a.name || (a.id === 0 ? t('mower.wholeLawn') : t('mower.areaUnnamed', { id: a.id }))
}

export function mowerTask(s: StateFor<'mower'>, t: Translate): string {
  if (s.activity === 'returning') return t('mower.task.returning')
  if (s.activity !== 'mowing') return ''
  const id = s.workAreaId
  // a DRAWN zone (other than the whole terrain): it is the one we name
  const traced = id !== undefined && id !== 0
  const zone = traced ? workAreaLabel(s.workAreas?.find((a) => a.id === id) ?? { id, name: '' }, t) : ''
  if (s.leaving) return traced ? t('mower.task.leavingTo', { zone }) : t('mower.task.leaving')
  if (traced) return t('mower.task.mowingIn', { zone })
  // whole terrain: to be said only for a robot that has zones, otherwise the activity is enough
  return (s.workAreas ?? []).some((a) => a.id !== 0) ? t('mower.task.mowingAll') : ''
}

/**
 * The status line under the gauge: the vendor's ERROR when there is one ("Error 2 · No loop
 * signal · 3 h ago"), otherwise why the robot is not mowing (schedule, rain, frost, setpoint), otherwise
 * what it does and where (`mowerTask`). Shared by the Robots view card and the scene panel.
 */
export function mowerStatus(s: StateFor<'mower'>, t: Translate, now: number, locale: string): string {
  if (s.activity === 'error' || s.errorCode !== undefined) {
    const parts = [s.errorCode === undefined ? t('mower.activities.error') : t('mower.error', { code: s.errorCode })]
    if (s.errorMessage) parts.push(s.errorMessage)
    if (s.errorAt) parts.push(formatAgo(s.errorAt, now, locale))
    return parts.join(' · ')
  }
  if (s.restrictedReason && s.activity !== 'mowing' && s.activity !== 'returning') return t(`mower.restrictions.${s.restrictedReason}`)
  // otherwise what it does, and where: "Heading to Back", "Mowing · Front", "Returning to the station"
  return mowerTask(s, t)
}
