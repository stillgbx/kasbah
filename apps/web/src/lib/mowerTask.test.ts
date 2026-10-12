import { describe, expect, it } from 'vitest'
import type { StateFor } from '@kasbah/shared'
import { mowerTask, workAreaLabel } from './mowerTask'

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
