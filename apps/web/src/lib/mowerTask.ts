import type { StateFor } from '@kasbah/shared'
import { formatAgo } from './format'

// Ce que la tondeuse est en train de faire, en une phrase : « En route vers Fond », « Tonte · Devant »,
// « Retour à la station ». L'activité seule (« Tonte ») ne dit pas OÙ : c'est la zone en cours
// (`workAreaId`) et le départ (`leaving`) qui le précisent. Vide quand il n'y a rien à ajouter à
// l'activité — un robot sans zones qui tond, un robot garé.

type Translate = (key: string, values?: Record<string, unknown>) => string
type WorkArea = NonNullable<StateFor<'mower'>['workAreas']>[number]

/** Le nom d'une zone ; la zone `0` sans nom est tout le terrain (Husqvarna la publie ainsi). */
export function workAreaLabel(a: Pick<WorkArea, 'id' | 'name'>, t: Translate): string {
  return a.name || (a.id === 0 ? t('mower.wholeLawn') : t('mower.areaUnnamed', { id: a.id }))
}

export function mowerTask(s: StateFor<'mower'>, t: Translate): string {
  if (s.activity === 'returning') return t('mower.task.returning')
  if (s.activity !== 'mowing') return ''
  const id = s.workAreaId
  // une zone TRACÉE (autre que tout le terrain) : c'est elle qu'on nomme
  const traced = id !== undefined && id !== 0
  const zone = traced ? workAreaLabel(s.workAreas?.find((a) => a.id === id) ?? { id, name: '' }, t) : ''
  if (s.leaving) return traced ? t('mower.task.leavingTo', { zone }) : t('mower.task.leaving')
  if (traced) return t('mower.task.mowingIn', { zone })
  // tout le terrain : à dire seulement chez un robot qui a des zones, sinon l'activité suffit
  return (s.workAreas ?? []).some((a) => a.id !== 0) ? t('mower.task.mowingAll') : ''
}

/**
 * La ligne d'état sous la jauge : l'ERREUR du fabricant quand il y en a une (« Erreur 2 · No loop
 * signal · il y a 3 h »), sinon pourquoi le robot ne tond pas (planning, pluie, gel, consigne), sinon
 * ce qu'il fait et où (`mowerTask`). Partagée par la carte de la vue Robots et le panneau de la scène.
 */
export function mowerStatus(s: StateFor<'mower'>, t: Translate, now: number, locale: string): string {
  if (s.activity === 'error' || s.errorCode !== undefined) {
    const parts = [s.errorCode === undefined ? t('mower.activities.error') : t('mower.error', { code: s.errorCode })]
    if (s.errorMessage) parts.push(s.errorMessage)
    if (s.errorAt) parts.push(formatAgo(s.errorAt, now, locale))
    return parts.join(' · ')
  }
  if (s.restrictedReason && s.activity !== 'mowing' && s.activity !== 'returning') return t(`mower.restrictions.${s.restrictedReason}`)
  // sinon ce qu'il fait, et où : « En route vers Fond », « Tonte · Devant », « Retour à la station »
  return mowerTask(s, t)
}
