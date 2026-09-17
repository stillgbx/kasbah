import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceConsumption } from '@kasbah/shared'
import WaterConsumptionChart from './WaterConsumptionChart.vue'

// Le SVG mesuré (largeur/hauteur via ResizeObserver) ne se déclenche pas sous happy-dom (stub
// muet, cf. test/setup.ts) : ces tests couvrent donc le contenu qui ne dépend PAS de la mesure —
// l'état « historique qui démarre » (la règle la plus importante de cette carte) et le résumé pour
// lecteur d'écran. Le rendu des barres se vérifie dans le vrai navigateur (voir le rapport de tâche).

const hourStart = (): number => { const d = new Date(); d.setMinutes(0, 0, 0); return d.getTime() }
const monthStart = (): number => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime() }
const consumption = (over: Partial<DeviceConsumption> = {}): DeviceConsumption =>
  ({ deviceId: 'comap:station', hourly: [], daily: [], monthly: [], ...over })

const clickTab = async (w: ReturnType<typeof mount>, label: string) => {
  await w.findAll('.segmented__item').find((b) => b.text() === label)!.trigger('click')
}

describe('WaterConsumptionChart — historique de consommation', () => {
  it("sans historique : un message qui dit que la mesure se remplit, jamais un cadre vide ni une erreur", () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: null } })
    expect(w.find('.chart__empty').exists()).toBe(true)
    expect(w.find('.chart__empty').text()).toContain('suivi horaire')
    expect(w.find('.chart__stage').exists()).toBe(false)
  })

  it("un seul point suffit à sortir de l'état vide — mais SEULEMENT pour la période dont la série a un point", async () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: [{ t: hourStart(), litres: 12 }] }) } })
    expect(w.find('.chart__empty').exists()).toBe(false)
    // semaine et mois lisent `daily`, resté vide : basculer dessus doit remontrer le message, avec le bon mot
    await clickTab(w, 'Semaine')
    expect(w.find('.chart__empty').exists()).toBe(true)
    expect(w.find('.chart__empty').text()).toContain('quotidien')
    await clickTab(w, 'Année')
    expect(w.find('.chart__empty').text()).toContain('mensuel')
  })

  it('le total et le résumé pour lecteur d’écran suivent la période choisie, jamais 0 L pour un pas non mesuré', () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: [{ t: hourStart(), litres: 250 }] }) } })
    expect(w.find('.chart__total').text()).toContain('250 L')
    // 24 colonnes réservées, une seule mesurée : les 23 autres ne comptent pas comme des zéros
    // (unité réelle et accord singulier : "1 heure ... mesurée", jamais le mot "pas" — voir le
    // piège documenté dans measuredFragment : "X/24 pas mesurés" se lit comme une négation)
    expect(w.find('.chart__sr').text()).toContain('1 heure sur 24 mesurée')
  })

  it('quand tout est mesuré, la mention visible disparaît (rien à expliquer) sans faire bouger le total', () => {
    const points = Array.from({ length: 24 }, (_, i) => ({ t: hourStart() - i * 3600_000, litres: 10 }))
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: points }) } })
    expect(w.find('.chart__totalNote').exists()).toBe(false)
    // le résumé pour lecteur d'écran, lui, continue de le dire (pas de clutter visuel à ce niveau)
    expect(w.find('.chart__sr').text()).toContain('24 heures sur 24 mesurées')
  })

  it('le total vient du COMPTEUR EXACT de la station (todayL), jamais de la somme des seules heures déjà mesurées', () => {
    // reproduit le bug rapporté : la station affiche 154 L depuis minuit, mais l'historique n'a que
    // 3 points (13+0+3=16 L) parce qu'il vient de démarrer à 8h — la carte doit dire 154, pas 16
    const w = mount(WaterConsumptionChart, {
      props: {
        consumption: consumption({ hourly: [{ t: hourStart(), litres: 13 }, { t: hourStart() - 3600_000, litres: 0 }, { t: hourStart() - 7200_000, litres: 3 }] }),
        todayL: 154,
      },
    })
    expect(w.find('.chart__total').text()).toContain('154 L')
    expect(w.find('.chart__total').text()).not.toContain('16 L')
    // le graphique reste PARTIEL et le dit clairement, à l'écran (pas seulement pour un lecteur d'écran)
    expect(w.find('.chart__total').text()).toContain('3 heures sur 24 mesurées')
  })

  it('semaine et mois lisent respectivement weekL et monthL, pas la somme des pas quotidiens', async () => {
    const w = mount(WaterConsumptionChart, {
      props: { consumption: consumption({ daily: [{ t: hourStart(), litres: 100 }] }), weekL: 1495, monthL: 7545 },
    })
    await clickTab(w, 'Semaine')
    expect(w.find('.chart__total').text()).toContain('495 L')
    await clickTab(w, 'Mois')
    expect(w.find('.chart__total').text()).toContain('545 L')
  })

  it("l'année n'a pas d'équivalent chez la station : elle garde la somme des points mensuels (déjà complète)", async () => {
    const w = mount(WaterConsumptionChart, {
      props: { consumption: consumption({ monthly: [{ t: monthStart(), litres: 500 }] }), todayL: 999, weekL: 999, monthL: 999 },
    })
    await clickTab(w, 'Année')
    expect(w.find('.chart__total').text()).toContain('500 L')
    expect(w.find('.chart__total').text()).not.toContain('999 L')
  })

  it("sans compteur exact connu, le total retombe sur la somme des pas mesurés (comportement historique)", () => {
    const w = mount(WaterConsumptionChart, { props: { consumption: consumption({ hourly: [{ t: hourStart(), litres: 250 }] }) } })
    expect(w.find('.chart__total').text()).toContain('250 L')
  })

  it('la légende du repère français ne dépend que du foyer, jamais de la période ni de la donnée mesurée', async () => {
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
