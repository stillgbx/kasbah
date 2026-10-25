import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { HeatingPoint } from '../../api/transport'
import HeatingHistoryChart from './HeatingHistoryChart.vue'

// The four windows of the operating history: 48 h in hours, week and month in days, year in
// months summed from the days. What must hold: each window reserves its number of steps whatever
// the data, and the run hours add up what each step stands for (an hour, a day, a month).

const NOW = new Date(2026, 9, 21, 9, 30).getTime()
const point = (t: number, share: number, outdoorC: number | null = 9): HeatingPoint =>
  ({ t, n: 60, heating: Math.round(60 * share), defrost: 0, booster: 0, outdoorC, flowC: null, returnC: null })
const day = (offset: number) => new Date(2026, 9, 21 + offset).getTime()

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

async function show(range: string, props: { points?: HeatingPoint[]; daily?: HeatingPoint[] }) {
  const w = mount(HeatingHistoryChart, { props: { points: props.points ?? [], daily: props.daily ?? [], pollMs: 60_000 } })
  const tab = w.findAll('.segmented__item').find((b) => b.text() === range)!
  await tab.trigger('click')
  return w
}

describe('HeatingHistoryChart', () => {
  it('reserves the steps of each window, data or not', async () => {
    const daily = [point(day(-1), 0.5), point(day(0), 0.25)]
    const points = [point(Math.floor(NOW / 3_600_000) * 3_600_000, 1)]
    expect((await show('48 h', { points, daily })).findAll('.hist__bar')).toHaveLength(48)
    // the 48 h window reads the HOURS: with none, it says the history is filling up, no plot
    expect((await show('48 h', { daily })).find('.hist__empty').exists()).toBe(true)
    expect((await show('Semaine', { daily })).findAll('.hist__bar')).toHaveLength(7)
    expect((await show('Mois', { daily })).findAll('.hist__bar')).toHaveLength(31)
    expect((await show('Année', { daily })).findAll('.hist__bar')).toHaveLength(12)
  })

  it('counts a day as 24 hours of which its share heated', async () => {
    const w = await show('Semaine', { daily: [point(day(-1), 0.5), point(day(0), 0.25)] })
    expect(w.find('.hist__value').text()).toBe('18 h 00')   // 12 h + 6 h
  })

  /** The year in months: two days of September and one of October make two bars, and their hours. */
  it('sums the days into months for the year', async () => {
    const daily = [point(new Date(2026, 8, 10).getTime(), 0.5), point(new Date(2026, 8, 11).getTime(), 0.5), point(day(0), 0.25)]
    const w = await show('Année', { daily })
    expect(w.findAll('.hist__bar').filter((b) => b.attributes('style')?.includes('display: none') !== true)).toHaveLength(2)
    expect(w.find('.hist__value').text()).toBe('1 j 6 h')   // 12 + 12 + 6 hours
  })

  /** Calendar cut: the week from Monday, the year from January (months still summed from the days);
   * a step before today without data is a dash, a step still to come is left empty. */
  it('cuts the calendar week from Monday and the year from January', async () => {
    const shown = (w: Awaited<ReturnType<typeof show>>, sel: string) =>
      w.findAll(sel).filter((e) => e.attributes('style')?.includes('display: none') !== true).length
    const calendar = async (range: string, daily: HeatingPoint[]) => {
      const w = await show(range, { daily })
      await w.findAll('.segmented__item').find((b) => b.text() === 'Calendaire')!.trigger('click')
      return w
    }
    // Sunday 18 belongs to last week; Monday 19 and Wednesday 21 (today) to this one
    const week = await calendar('Semaine', [point(day(-3), 1), point(day(-2), 0.5), point(day(0), 0.25)])
    expect(week.find('.hist__head .small').text()).toBe('Cette semaine')
    expect(shown(week, '.hist__bar')).toBe(2)
    expect(shown(week, '.hist__gap')).toBe(1)             // Tuesday; Thursday to Sunday are to come
    expect(week.find('.hist__value').text()).toBe('18 h 00')
    // December 2025 is last year; January and October 2026 make two bars, February to September dashes
    const year = await calendar('Année', [point(new Date(2025, 11, 15).getTime(), 1), point(new Date(2026, 0, 10).getTime(), 0.5), point(day(0), 0.25)])
    expect(year.find('.hist__head .small').text()).toBe('2026')
    expect(shown(year, '.hist__bar')).toBe(2)
    expect(shown(year, '.hist__gap')).toBe(8)
    expect(year.find('.hist__value').text()).toBe('18 h 00')
  })

  it('keeps the 48 h window on the hours', async () => {
    const hour = Math.floor(NOW / 3_600_000) * 3_600_000
    const w = await show('48 h', { points: [point(hour, 1), point(hour - 3_600_000, 0.5)] })
    expect(w.find('.hist__value').text()).toBe('1 h 30')
  })
})
