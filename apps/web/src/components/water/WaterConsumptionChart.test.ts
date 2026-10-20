import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceConsumption } from '@kasbah/shared'
import WaterConsumptionChart from './WaterConsumptionChart.vue'

// The measured SVG (width/height via ResizeObserver) does not trigger under happy-dom (mute
// stub, cf. test/setup.ts): these tests therefore cover the content that does NOT depend on the measurement —
// the "history that starts" state (the most important rule of this card) and the summary for
// screen readers. The bars' rendering is checked in the real browser (see the task report).

const hourStart = (): number => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime() }
const monthStart = (): number => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() }
const consumption = (over: Partial<DeviceConsumption> = {}): DeviceConsumption =>
  ({ deviceId: 'comap:station', hourly: [], daily: [], monthly: [], ...over })

const clickTab = async (w: ReturnType<typeof mount>, label: string) => {
  await w.findAll('.segmented__item').find((b) => b.text() === label)!.trigger('click')
}

describe('WaterConsumptionChart — consumption history', () => {
  it("without history: a message saying the measurement is filling up, never an empty frame nor an error", () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: null } })
    expect(w.find('.chart__empty').exists()).toBe(true)
    expect(w.find('.chart__empty').text()).toContain('suivi horaire')
    expect(w.find('.chart__stage').exists()).toBe(false)
  })

  it("a single point is enough to leave the empty state — but ONLY for the period whose series has a point", async () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: [{ t: hourStart(), litres: 12 }] }) } })
    expect(w.find('.chart__empty').exists()).toBe(false)
    // week and month read `daily`, which stayed empty: switching to it must show the message again, with the right word
    await clickTab(w, 'Semaine')
    expect(w.find('.chart__empty').exists()).toBe(true)
    expect(w.find('.chart__empty').text()).toContain('quotidien')
    await clickTab(w, 'Année')
    expect(w.find('.chart__empty').text()).toContain('mensuel')
  })

  it('the total and the screen-reader summary follow the chosen period, never 0 L for an unmeasured step', () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: [{ t: hourStart(), litres: 250 }] }) } })
    expect(w.find('.chart__total').text()).toContain('250 L')
    // 24 reserved columns, only one measured: the other 23 do not count as zeros
    // (real unit and singular agreement: "1 heure ... mesurée", never the word "pas" — see the
    // pitfall documented in measuredFragment: "X/24 pas mesurés" reads as a negation)
    expect(w.find('.chart__sr').text()).toContain('1 heure sur 24 mesurée')
  })

  it('when everything is measured, the visible mention disappears (nothing to explain) without moving the total', () => {
    const points = Array.from({ length: 24 }, (_, i) => ({ t: hourStart() - i * 3600_000, litres: 10 }))
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: points }) } })
    expect(w.find('.chart__totalNote').exists()).toBe(false)
    // the screen-reader summary, for its part, keeps saying it (no visual clutter at that level)
    expect(w.find('.chart__sr').text()).toContain('24 heures sur 24 mesurées')
  })

  it('the total comes from the station\'s EXACT COUNTER (todayL), never from the sum of the hours already measured alone', () => {
    // reproduces the reported bug: the station shows 154 L since midnight, but the history only has
    // 3 points (13+0+3=16 L) because it just started at 8 a.m. — the card must say 154, not 16
    const w = mount(WaterConsumptionChart, {
      props: {
        consumption: consumption({ hourly: [{ t: hourStart(), litres: 13 }, { t: hourStart() - 3600_000, litres: 0 }, { t: hourStart() - 7200_000, litres: 3 }] }),
        todayL: 154,
      },
    })
    expect(w.find('.chart__total').text()).toContain('154 L')
    expect(w.find('.chart__total').text()).not.toContain('16 L')
    // the chart stays PARTIAL and says so clearly, on screen (not only for a screen reader)
    expect(w.find('.chart__total').text()).toContain('3 heures sur 24 mesurées')
  })

  it('week and month read weekL and monthL respectively, not the sum of the daily steps', async () => {
    const w = mount(WaterConsumptionChart, {
      props: { consumption: consumption({ daily: [{ t: hourStart(), litres: 100 }] }), weekL: 1495, monthL: 7545 },
    })
    await clickTab(w, 'Semaine')
    expect(w.find('.chart__total').text()).toContain('495 L')
    await clickTab(w, 'Mois')
    expect(w.find('.chart__total').text()).toContain('545 L')
  })

  it("the year has no equivalent at the station: it keeps the sum of the monthly points (already complete)", async () => {
    const w = mount(WaterConsumptionChart, {
      props: { consumption: consumption({ monthly: [{ t: monthStart(), litres: 500 }] }), todayL: 999, weekL: 999, monthL: 999 },
    })
    await clickTab(w, 'Année')
    expect(w.find('.chart__total').text()).toContain('500 L')
    expect(w.find('.chart__total').text()).not.toContain('999 L')
  })

  it("without a known exact counter, the total falls back on the sum of the measured steps (historical behavior)", () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: [{ t: hourStart(), litres: 250 }] }) } })
    expect(w.find('.chart__total').text()).toContain('250 L')
  })

  it('the French-average marker legend only depends on the household, never on the period or the measured data', async () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption(), householdSize: 4 } })
    const legend = () => w.find('.chart__reference').text()
    expect(legend()).toContain('580 L') // 4 x 145
    expect(legend()).toContain('SISPEA 2023')
    const before = legend()
    await clickTab(w, 'Semaine')
    expect(legend()).toBe(before)
    await clickTab(w, 'Année')
    expect(legend()).toBe(before)
  })
})
