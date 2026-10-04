import { describe, expect, it } from 'vitest'
import type { SchoolData, SchoolHomework } from '../api/transport'
import { badges, daysBetween, homeworkDays, isVisible, levelOptions, nextDueDate } from './school'

const hw = (id: number, date: string, over: Partial<SchoolHomework> = {}): SchoolHomework => ({
  id, journalId: 'j', date, title: null, subject: null, author: null, text: '', levels: [], files: [], done: false, siteAck: null, ...over,
})
const NONE = { hiddenJournals: [], hiddenLevels: [] }

function data(over: Partial<SchoolData> = {}): SchoolData {
  return {
    linked: true, username: 'u', sessionLost: false, fetchedAt: 0, error: null,
    journals: [{ id: 'j', name: 'CE1-CE2', years: null, students: [] }],
    homework: [], messages: [], posts: [], filters: NONE, postsSeen: 0, ...over,
  }
}

describe('school filters', () => {
  it('keeps what speaks to the whole class, and what names at least one kept level', () => {
    const f = { hiddenJournals: [], hiddenLevels: ['CE1'] }
    expect(isVisible({ journalId: 'j', levels: [] }, f)).toBe(true)
    expect(isVisible({ journalId: 'j', levels: ['CE1'] }, f)).toBe(false)
    expect(isVisible({ journalId: 'j', levels: ['CE1', 'CE2'] }, f)).toBe(true)
    expect(isVisible({ journalId: 'j', levels: [] }, { hiddenJournals: ['j'], hiddenLevels: [] })).toBe(false)
  })

  it('offers the levels of the class names and of the entries, in school order', () => {
    expect(levelOptions(data({ homework: [hw(1, '2026-10-05', { levels: ['CM1'] })] }))).toEqual(['CE1', 'CE2', 'CM1'])
    expect(levelOptions(data({ journals: [{ id: 'j', name: 'Classe de CP', years: null, students: [] }] }))).toEqual(['CP'])
  })
})

describe('school homework days', () => {
  it('splits past days (latest first) from today and after', () => {
    const { past, upcoming } = homeworkDays([hw(3, '2026-10-08'), hw(1, '2026-10-01'), hw(2, '2026-10-05'), hw(4, '2026-10-02'), hw(5, '2026-10-05')], '2026-10-05')
    expect(past.map((d) => d.date)).toEqual(['2026-10-02', '2026-10-01'])
    expect(upcoming.map((d) => [d.date, d.items.map((i) => i.id)])).toEqual([['2026-10-05', [2, 5]], ['2026-10-08', [3]]])
  })

  it('finds the next day something is due, after today', () => {
    expect(nextDueDate([hw(1, '2026-10-04'), hw(2, '2026-10-08'), hw(3, '2026-10-05')], '2026-10-04')).toBe('2026-10-05')
    expect(nextDueDate([hw(1, '2026-10-01')], '2026-10-04')).toBeNull()
  })

  it('counts calendar days across a month and a DST change', () => {
    expect(daysBetween('2026-10-04', '2026-10-05')).toBe(1)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2)
  })
})

describe('school badges', () => {
  it('counts what is left for the next due day, unread messages and new posts, after filters', () => {
    const d = data({
      homework: [hw(1, '2026-10-05'), hw(2, '2026-10-05', { done: true }), hw(3, '2026-10-05', { levels: ['CE1'] }), hw(4, '2026-10-08')],
      messages: [
        { id: 1, journalId: 'j', at: '', title: null, author: null, text: '', levels: [], files: [], read: false, responses: 0 },
        { id: 2, journalId: 'j', at: '', title: null, author: null, text: '', levels: [], files: [], read: true, responses: 0 },
      ],
      posts: [
        { id: 30, journalId: 'j', at: '', title: null, author: null, text: '', levels: [], files: [], comments: 0 },
        { id: 20, journalId: 'j', at: '', title: null, author: null, text: '', levels: [], files: [], comments: 0 },
      ],
      postsSeen: 25,
      filters: { hiddenJournals: [], hiddenLevels: ['CE1'] },
    })
    expect(badges(d, '2026-10-04')).toEqual({ homework: 1, messages: 1, posts: 1 })
  })
})
