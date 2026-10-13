import { describe, expect, it } from 'vitest'
import type { StateFor } from '@kasbah/shared'
import { mowerStatus, mowerTask, workAreaLabel } from './mowerTask'

// La phrase de tâche dit OÙ le robot tond, ce que l'activité seule ne dit pas. Traduction factice :
// la clé et ses valeurs, pour lire ce qui serait affiché.

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}(${Object.values(values).join(',')})` : key)
const AREAS = [{ id: 0, name: '', enabled: true }, { id: 757, name: 'Devant', enabled: true }, { id: 758, name: 'Fond', enabled: true }]
const mower = (over: Partial<StateFor<'mower'>>): StateFor<'mower'> =>
  ({ kind: 'mower', updatedAt: 0, available: true, activity: 'parked', battery: 80, workAreas: AREAS, ...over })

describe('mowerTask', () => {
  it('en route vers une zone tracée, puis en tonte dedans', () => {
    expect(mowerTask(mower({ activity: 'mowing', leaving: true, workAreaId: 758 }), t)).toBe('mower.task.leavingTo(Fond)')
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 757 }), t)).toBe('mower.task.mowingIn(Devant)')
  })
  it('tout le terrain : dit seulement chez un robot qui a des zones tracées', () => {
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 0 }), t)).toBe('mower.task.mowingAll')
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 0, workAreas: [AREAS[0]!] }), t)).toBe('')
    expect(mowerTask(mower({ activity: 'mowing', leaving: true, workAreaId: 0 }), t)).toBe('mower.task.leaving')
  })
  it('retour à la station ; garé, en charge, en pause : rien à ajouter à l’activité', () => {
    expect(mowerTask(mower({ activity: 'returning', workAreaId: 757 }), t)).toBe('mower.task.returning')
    for (const activity of ['parked', 'charging', 'paused', 'stopped', 'error'] as const) expect(mowerTask(mower({ activity }), t)).toBe('')
  })
  it('une zone que la liste ne connaît pas (pas encore relue) garde son numéro', () => {
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 999 }), t)).toBe('mower.task.mowingIn(mower.areaUnnamed(999))')
    expect(workAreaLabel({ id: 0, name: '' }, t)).toBe('mower.wholeLawn')
  })
})

describe('mowerStatus', () => {
  const NOW = 10 * 3600_000
  it("l'erreur du fabricant prime : code, texte, âge", () => {
    const s = mowerStatus(mower({ activity: 'error', errorCode: 2, errorMessage: 'No loop signal', errorAt: NOW - 3 * 3600_000, workAreaId: 757 }), t, NOW, 'fr')
    expect(s.startsWith('mower.error(2) · No loop signal · ')).toBe(true)
    expect(mowerStatus(mower({ activity: 'error' }), t, NOW, 'fr')).toBe('mower.activities.error')
  })
  it('sinon ce qui retient le robot, sinon la tâche', () => {
    expect(mowerStatus(mower({ activity: 'parked', restrictedReason: 'week_schedule' }), t, NOW, 'fr')).toBe('mower.restrictions.week_schedule')
    expect(mowerStatus(mower({ activity: 'mowing', workAreaId: 757 }), t, NOW, 'fr')).toBe('mower.task.mowingIn(Devant)')
  })
})
