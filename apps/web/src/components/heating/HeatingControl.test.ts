import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceEntry } from '@kasbah/shared'
import HeatingControl from './HeatingControl.vue'

// Les commandes d'un appareil de chauffage, dans la ligne de sa pièce. Ce qu'elles doivent tenir :
//
//  - vivre sur LEUR PROPRE rangée (`grid-column: 1 / -1`) : la version d'avant les posait dans la
//    colonne du statut sans les laisser rétrécir, et elles chevauchaient la pastille de liaison dès
//    que la carte se resserrait ;
//  - parler le vocabulaire de la maison : des touches `.key` carrées de 36 px, celles des vues
//    Ouvrants et Médias, et pas des boutons ronds inventés pour l'occasion ;
//  - garder la consigne ENTRE les deux touches qui la règlent ;
//  - n'offrir aucun geste que le plugin refuserait (les zones MELCloud ne déclarent ni
//    `target_temp` ni `hvac_mode`) et respecter les bornes de l'appareil.

const entry = (over: Partial<DeviceEntry['descriptor']>, state: Record<string, unknown> = {}): DeviceEntry => ({
  descriptor: {
    id: 'x:1', pluginId: 'x', externalId: '1', kind: 'climate', name: 'Zone', capabilities: [], meta: {},
    ...over,
  } as DeviceEntry['descriptor'],
  state: { kind: 'climate', updatedAt: 0, available: true, mode: 'heat', action: 'idle', currentTempC: 22.5, targetTempC: 19.5, ...state } as DeviceEntry['state'],
})

const thermostat = entry({
  capabilities: ['hvac_mode', 'target_temp', 'current_temp'],
  meta: { targetTempC: [10, 30], climate: { modes: ['heat', 'off'] } },
})
const readOnlyZone = entry(
  { capabilities: ['current_temp'], meta: { targetTempC: [30, 60], climate: { modes: ['off', 'heat'], control: 'flow' } } },
  { currentTempC: 20, targetTempC: 45 },
)

describe('HeatingControl', () => {
  it('pose ses commandes sur leur propre rangée, hors des colonnes du statut', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    expect(w.find('.controls').exists()).toBe(true)
  })

  it('emploie les touches de la maison, pas des boutons ronds', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    expect(w.findAll('.key').length).toBeGreaterThan(0)
    expect(w.findAll('.round')).toHaveLength(0)
  })

  it('garde la consigne entre les deux touches qui la règlent', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    const keys = w.find('.keys')
    expect(keys.find('.target').text()).toBe('19,5 °C')
    expect(keys.findAll('.key')).toHaveLength(2)
  })

  /** Une zone lue n'a rien à régler : pas de rangée vide non plus. */
  it('ne montre aucune rangée de commandes sur un appareil en lecture seule', () => {
    expect(mount(HeatingControl, { props: { entry: readOnlyZone } }).find('.controls').exists()).toBe(false)
  })

  it('règle la consigne par pas de 0,5', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    const [minus, plus] = w.findAll('.keys').at(0)!.findAll('.key')
    void plus!.trigger('click')
    void minus!.trigger('click')
    expect(w.emitted('command')).toEqual([
      ['x:1', { type: 'climate.set_target_temp', targetTempC: 20 }],
      ['x:1', { type: 'climate.set_target_temp', targetTempC: 19 }],
    ])
  })

  /** Les bornes viennent de l'appareil : une eau de départ ne descend pas à 10 °C. */
  it('ne sort pas des bornes déclarées', () => {
    const atFloor = entry({ capabilities: ['target_temp'], meta: { targetTempC: [30, 60] } }, { targetTempC: 30 })
    const w = mount(HeatingControl, { props: { entry: atFloor } })
    void w.findAll('.key')[0]!.trigger('click')
    expect(w.emitted('command')![0]![1]).toEqual({ type: 'climate.set_target_temp', targetTempC: 30 })
  })

  it('choisit un mode, et montre celui qui tient', () => {
    const w = mount(HeatingControl, { props: { entry: thermostat } })
    const modes = w.findAll('.key--text')
    expect(modes).toHaveLength(2)
    expect(modes[0]!.attributes('data-on')).toBe('1')   // « Chauffage », le mode en cours
    void modes[1]!.trigger('click')
    expect(w.emitted('command')![0]).toEqual(['x:1', { type: 'climate.set_mode', mode: 'off' }])
  })

  it('grise la consigne quand l’appareil est éteint ou injoignable', () => {
    const off = mount(HeatingControl, { props: { entry: entry({ ...thermostat.descriptor }, { mode: 'off' }) } })
    expect(off.findAll('.keys').at(0)!.findAll('.key').every((b) => b.attributes('disabled') !== undefined)).toBe(true)

    const gone = mount(HeatingControl, { props: { entry: entry({ ...thermostat.descriptor }, { available: false }) } })
    // un appareil injoignable n'obéit à rien : le mode se refuse comme la consigne
    expect(gone.findAll('.key').every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })
})
