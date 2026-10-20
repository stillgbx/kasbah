import { describe, expect, it } from 'vitest'
import type { StateFor } from '@kasbah/shared'
import { mowerStatus, mowerTask, workAreaLabel } from './mowerTask'

// The task phrase says WHERE the robot mows, which the activity alone does not say. Fake translation:
// the key and its values, to read what would be displayed.

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}(${Object.values(values).join(',')})` : key)
const AREAS = [{ id: 0, name: '', enabled: true }, { id: 757, name: 'Devant', enabled: true }, { id: 758, name: 'Fond', enabled: true }]
const mower = (over: Partial<StateFor<'mower'>>): StateFor<'mower'> =>
  ({ kind: 'mower', updatedAt: 0, available: true, activity: 'parked', battery: 80, workAreas: AREAS, ...over })

describe('mowerTask', () => {
  it('heading to a drawn zone, then mowing in it', () => {
    expect(mowerTask(mower({ activity: 'mowing', leaving: true, workAreaId: 758 }), t)).toBe('mower.task.leavingTo(Fond)')
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 757 }), t)).toBe('mower.task.mowingIn(Devant)')
  })
  it('whole terrain: said only for a robot that has drawn zones', () => {
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 0 }), t)).toBe('mower.task.mowingAll')
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 0, workAreas: [AREAS[0]!] }), t)).toBe('')
    expect(mowerTask(mower({ activity: 'mowing', leaving: true, workAreaId: 0 }), t)).toBe('mower.task.leaving')
  })
  it('return to the station; parked, charging, paused: nothing to add to the activity', () => {
    expect(mowerTask(mower({ activity: 'returning', workAreaId: 757 }), t)).toBe('mower.task.returning')
    for (const activity of ['parked', 'charging', 'paused', 'stopped', 'error'] as const) expect(mowerTask(mower({ activity }), t)).toBe('')
  })
  it('a zone the list does not know (not yet re-read) keeps its number', () => {
    expect(mowerTask(mower({ activity: 'mowing', workAreaId: 999 }), t)).toBe('mower.task.mowingIn(mower.areaUnnamed(999))')
    expect(workAreaLabel({ id: 0, name: '' }, t)).toBe('mower.wholeLawn')
  })
})

describe('mowerStatus', () => {
  const NOW = 10 * 3600_000
  it("the vendor's error prevails: code, text, age", () => {
    const s = mowerStatus(mower({ activity: 'error', errorCode: 2, errorMessage: 'No loop signal', errorAt: NOW - 3 * 3600_000, workAreaId: 757 }), t, NOW, 'fr')
    expect(s.startsWith('mower.error(2) · No loop signal · ')).toBe(true)
    expect(mowerStatus(mower({ activity: 'error' }), t, NOW, 'fr')).toBe('mower.activities.error')
  })
  it('otherwise what holds the robot back, otherwise the task', () => {
    expect(mowerStatus(mower({ activity: 'parked', restrictedReason: 'week_schedule' }), t, NOW, 'fr')).toBe('mower.restrictions.week_schedule')
    expect(mowerStatus(mower({ activity: 'mowing', workAreaId: 757 }), t, NOW, 'fr')).toBe('mower.task.mowingIn(Devant)')
  })
})
