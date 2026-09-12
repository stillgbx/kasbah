import { describe, expect, it } from 'vitest'
import { deviceDescriptorSchema, mergeState, defaultState } from '@kasbah/shared'
import {
  ENSEMBLE_INVENTORY, ENSEMBLE_POWER, INVERTERS, LIVEDATA, METERS, PRODUCTION,
} from './__fixtures__/gateway'
import {
  PANEL_STALE_MS, batteriesOf, isBatteryAvailable, isPanelStale, productionW, toBatteryPatch, toDailyPatch,
  toDescriptors, toPanelPatch, toSitePatch,
} from './mapping'
import {
  ensembleInventorySchema, ensemblePowerSchema, invertersSchema, livedataSchema, productionSchema,
} from './types'

// Mappage de la passerelle IQ, éprouvé sur des réponses CAPTUREES sur la vraie (voir
// `__fixtures__/gateway.ts`) : installation triphasée, 20 micro-onduleurs, 2 batteries IQ.

const report = productionSchema.parse(PRODUCTION)
const inverters = invertersSchema.parse(INVERTERS)
const live = livedataSchema.parse(LIVEDATA)
const inventory = ensembleInventorySchema.parse(ENSEMBLE_INVENTORY)
const power = ensemblePowerSchema.parse(ENSEMBLE_POWER)
const batteries = batteriesOf(inventory)

describe('lecture des réponses réelles', () => {
  it('les schémas acceptent ce que la passerelle envoie, clé `devices:` à deux-points comprise', () => {
    expect(report.production).toHaveLength(2)
    expect(inverters).toHaveLength(20)
    expect(live.meters?.enc_agg_soc).toBe(100)
    expect(batteries).toHaveLength(2)
    expect(power['devices:']).toHaveLength(2)
    // deux CT en triphasé : c'est ce qui rend la production et la consommation mesurées disponibles
    const meters = METERS as readonly { measurementType: string; phaseCount: number }[]
    expect(meters.map((m) => m.measurementType)).toEqual(['production', 'net-consumption'])
    expect(meters.every((m) => m.phaseCount === 3)).toBe(true)
  })
})

describe('descripteurs', () => {
  const descriptors = toDescriptors({ report, inverters, batteries })

  it('publie un site, un capteur par onduleur, un appareil par batterie', () => {
    expect(descriptors).toHaveLength(23)
    expect(descriptors.filter((d) => d.kind === 'sensor')).toHaveLength(20)
    expect(descriptors.filter((d) => d.kind === 'energy')).toHaveLength(3)
    for (const d of descriptors) expect(deviceDescriptorSchema.parse(d)).toEqual(d)
  })

  it('le site déclare le stockage parce que l\'installation a des batteries', () => {
    const site = descriptors[0]!
    expect(site).toMatchObject({ id: 'enphase:site', externalId: 'site', kind: 'energy' })
    expect(site.capabilities).toEqual(['production', 'consumption', 'grid', 'storage'])
    // sans batterie, la capacité tombe : l'UI n'affiche pas une tuile batterie vide
    const noBattery = toDescriptors({ report, inverters, batteries: [] })
    expect(noBattery[0]!.capabilities).toEqual(['production', 'consumption', 'grid'])
    expect(noBattery).toHaveLength(21)
  })

  it('un panneau est un capteur de puissance en watts, nommé par la fin de son numéro de série', () => {
    const panel = descriptors.find((d) => d.kind === 'sensor')!
    expect(panel.externalId).toBe(inverters[0]!.serialNumber)
    expect(panel.name).toBe(`Onduleur ${inverters[0]!.serialNumber.slice(-5)}`)
    expect(panel.meta.sensor).toEqual({ unit: 'W', deviceClass: 'power', precision: 0 })
    // les 20 identifiants sont distincts : c'est ce qui permet de lier un champ de panneaux
    expect(new Set(descriptors.filter((d) => d.kind === 'sensor').map((d) => d.id)).size).toBe(20)
  })

  it('une batterie est un `energy` de seul stockage : c\'est ce qui lui donne l\'icône batterie', () => {
    const battery = descriptors.filter((d) => d.kind === 'energy').slice(1)
    expect(battery).toHaveLength(2)
    expect(battery[0]!.capabilities).toEqual(['storage'])
    expect(battery[0]!.name).toBe(`Batterie ${batteries[0]!.serial_num.slice(-5)}`)
    expect(battery[0]!.meta.model).toBe(batteries[0]!.part_num)
  })
})

describe('état du site', () => {
  const patch = toSitePatch(live) as Record<string, number>

  it('lit les compteurs par `livedata`, mille fois plus rapide que `production.json`', () => {
    // mêmes compteurs, à quelques secondes d'échantillonnage près : 6472 W contre 6456 W
    expect(patch.productionW).toBe(6472)
    expect(patch.consumptionW).toBe(725)
    expect(patch.gridW).toBe(-5763)                      // négatif = injection, déjà le signe du contrat
  })

  it('en repli sur `production.json`, prend le COMPTEUR et non la somme des onduleurs', () => {
    const p = toSitePatch(undefined, report) as Record<string, number>
    expect(productionW(report)).toBe(6456)
    const inverterSum = report.production.find((e) => e.type === 'inverters')!.wNow
    expect(inverterSum).toBe(4952)                       // 1,5 kW de retard sur la capture
    expect(p).toMatchObject({ productionW: 6456, consumptionW: 691, gridW: -5765 })
    // ce repli ne connaît pas la batterie : elle n'est que dans `livedata`
    expect(p.batteryW).toBeUndefined()
    expect(p.batterySoc).toBeUndefined()
  })

  it('les Wh du jour viennent du compteur de production et de la consommation TOTALE', () => {
    const day = toDailyPatch(report) as Record<string, number>
    expect(day.todayProductionWh).toBe(47127)
    // `net-consumption` publie un whToday à 0 : le lire aurait donné une consommation nulle
    expect(report.consumption.find((e) => e.measurementType === 'net-consumption')!.whToday).toBe(0)
    expect(day.todayConsumptionWh).toBe(18516)
  })

  it('INVERSE le signe du stockage : le fabricant compte positif en décharge', () => {
    const m = live.meters!
    // le bilan du fabricant ne se ferme qu'avec « storage positif = décharge », et il se ferme au
    // milliwatt : c'est la preuve qui justifie l'inversion
    expect(m.pv!.agg_p_mw + m.storage!.agg_p_mw + m.grid!.agg_p_mw).toBe(m.load!.agg_p_mw)
    expect(m.storage!.agg_p_mw).toBe(16000)              // +16 W chez Enphase = 16 W de DÉCHARGE
    expect(patch.batteryW).toBe(-16)                     // donc négatif au contrat, qui veut positif = charge
    expect(patch.batterySoc).toBe(100)
  })

  it('produit un état `energy` complet et valide, fusionnable par le registre', () => {
    const merged = mergeState(defaultState('energy'), toSitePatch(live, report), 1000)
    expect(merged).toMatchObject({ kind: 'energy', productionW: 6472, consumptionW: 725, gridW: -5763, batterySoc: 100 })
  })

  it('ne descend PAS sous zéro : la pince lit la veille des onduleurs à l\'envers la nuit', () => {
    const night = { ...live, meters: { ...live.meters!, pv: { ...live.meters!.pv!, agg_p_mw: -7000 } } }
    expect((toSitePatch(night) as Record<string, number>).productionW).toBe(0)
    // même règle sur le repli `production.json`
    const negative = { ...report, production: report.production.map((e) => ({ ...e, wNow: -7 })) }
    expect(productionW(negative)).toBe(0)
  })

  it('sans rien à lire, ne dit rien plutôt que d\'affirmer des zéros', () => {
    expect(toSitePatch(undefined)).toEqual({ kind: 'energy' })
  })
})

describe('état d\'un panneau', () => {
  it('rend la puissance du dernier rapport', () => {
    expect(toPanelPatch(inverters[0]!)).toEqual({ kind: 'sensor', value: inverters[0]!.lastReportWatts })
  })

  it('un onduleur muet depuis plus d\'une demi-heure devient indisponible, sans zéro inventé', () => {
    const at = inverters[0]!.lastReportDate * 1000
    expect(isPanelStale(inverters[0]!, at + 60_000)).toBe(false)
    expect(isPanelStale(inverters[0]!, at + PANEL_STALE_MS + 1)).toBe(true)
    // la valeur publiée ne change pas : c'est `available: false` qui dit qu'on ne la connaît plus
    expect(toPanelPatch(inverters[0]!)).toMatchObject({ value: inverters[0]!.lastReportWatts })
  })

  it('les 20 onduleurs de la capture ont tous rapporté dans les cinq dernières minutes', () => {
    const latest = Math.max(...inverters.map((i) => i.lastReportDate)) * 1000
    expect(inverters.every((i) => !isPanelStale(i, latest))).toBe(true)
  })
})

describe('état d\'une batterie', () => {
  it('charge de l\'inventaire, puissance de `ensemble/power`, au signe du contrat', () => {
    const first = toBatteryPatch(batteries[0]!, power) as Record<string, number>
    expect(first).toMatchObject({ kind: 'energy', productionW: 0, consumptionW: 0, gridW: 0, batterySoc: 100, batteryW: 0 })
    const second = toBatteryPatch(batteries[1]!, power) as Record<string, number>
    expect(second.batteryW).toBe(-16)                    // 16000 mW de décharge chez Enphase
    // la somme des batteries redonne le stockage d'ensemble de `livedata`
    const sum = power['devices:'].reduce((s, d) => s + d.real_power_mw, 0)
    expect(sum).toBe(live.meters!.storage!.agg_p_mw)
  })

  it('sans relevé de puissance, la charge suffit', () => {
    const p = toBatteryPatch(batteries[0]!, undefined) as Record<string, number>
    expect(p.batterySoc).toBe(100)
    expect(p.batteryW).toBeUndefined()
  })

  it('une batterie qui ne communique plus est indisponible et garde ses valeurs', () => {
    expect(isBatteryAvailable(batteries[0]!)).toBe(true)
    expect(isBatteryAvailable({ ...batteries[0]!, communicating: false })).toBe(false)
  })
})
