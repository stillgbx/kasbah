import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import ClimateControl from './ClimateControl.vue'

// Deux appareils très différents partagent ce contrôle :
//
//  - un thermostat qu'on PILOTE (la simulation) : boutons de consigne et choix du mode ;
//  - une zone de pompe à chaleur air-eau LUE SEULEMENT (MELCloud) : les mêmes chiffres, aucun
//    geste. Et l'une de ses zones se règle sur l'eau de DÉPART, pas sur l'air d'une pièce : 45 °C
//    y est une consigne de circuit, que le vocabulaire du thermostat ferait lire comme un salon.
//
// Ce contrôle était le seul à ne pas consulter les capacités — rien ne l'y obligeait tant que le
// seul appareil `climate` était simulé, et qu'il déclarait tout.

const thermostat: DeviceDescriptor = {
  id: 'mock:c', pluginId: 'mock', externalId: 'c', kind: 'climate', name: 'Salon',
  capabilities: ['hvac_mode', 'target_temp', 'current_temp'],
  meta: { targetTempC: [16, 28], climate: { modes: ['off', 'heat'] } },
}
const state: StateFor<'climate'> = { kind: 'climate', updatedAt: 0, available: true, mode: 'heat', action: 'idle', currentTempC: 23, targetTempC: 19.5 }

/** La zone 2 de l'Ecodan : lue seulement, et réglée sur la température de départ. */
const flowZone: DeviceDescriptor = {
  id: 'melcloud:1-z2', pluginId: 'melcloud', externalId: '1-z2', kind: 'climate', name: 'Chauffage zone 2',
  capabilities: ['current_temp'],
  meta: { targetTempC: [30, 60], climate: { modes: ['off', 'heat', 'eco'], control: 'flow' } },
}

describe('ClimateControl', () => {
  it('offre les gestes quand l’appareil les déclare', () => {
    const w = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    expect(w.findAll('.v-btn')).toHaveLength(2)      // moins / plus
    expect(w.find('.v-chip-group').exists()).toBe(true)
  })

  /** Le cœur du sujet : une capacité non déclarée ne doit pas produire un bouton qui échouerait. */
  it('n’offre AUCUN geste sur un appareil en lecture seule', () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(w.findAll('.v-btn')).toHaveLength(0)
    expect(w.find('.v-chip-group').exists()).toBe(false)
  })

  it('montre quand même la consigne et le mode, qui sont de l’état', () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(w.text()).toContain('19,5')                // la consigne reste lisible
    expect(w.text()).toContain('Chauffage')           // le mode aussi, en simple étiquette
  })

  it('parle d’eau de départ, pas de température ambiante, sur une zone en loi d’eau', () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(w.text()).toContain('Eau de départ')
    expect(w.text()).toContain('Consigne de départ')
    expect(w.text()).not.toContain('Température')
  })

  it('garde le vocabulaire du thermostat quand la zone se règle sur la pièce', () => {
    const w = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    expect(w.text()).toContain('Température')
    expect(w.text()).not.toContain('Eau de départ')
  })
})

describe('ClimateControl — alignement de la consigne', () => {
  /** Sans boutons, un nombre centré sous un libellé aligné à gauche flotte au milieu de rien. */
  it('aligne la consigne à gauche quand il n’y a pas de boutons autour', () => {
    const readOnly = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    expect(readOnly.find('.justify-start').exists()).toBe(true)

    const pilotable = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    expect(pilotable.find('.justify-center').exists()).toBe(true)
  })

  // Le panneau GARDE ce composant quand on passe d'une zone à l'autre : tout ce qui dépend de
  // l'appareil doit suivre le nouveau descripteur, pas celui du premier montage.
  it('suit l’appareil quand le panneau passe d’un thermostat à une zone en départ d’eau', async () => {
    const w = mount(ClimateControl, { props: { descriptor: thermostat, state } })
    await w.setProps({ descriptor: flowZone })
    expect(w.findAll('.v-btn')).toHaveLength(0)
    expect(w.find('.v-chip-group').exists()).toBe(false)
    expect(w.text()).toContain('départ')
  })
  it('borne la consigne sur la plage du NOUVEL appareil', async () => {
    const w = mount(ClimateControl, { props: { descriptor: flowZone, state } })
    const wide: DeviceDescriptor = { ...thermostat, meta: { ...thermostat.meta, targetTempC: [5, 35] } }
    await w.setProps({ descriptor: wide, state: { ...state, targetTempC: 20 } })
    await w.findAll('.v-btn')[0]!.trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'climate.set_target_temp', targetTempC: 19.5 }]])
  })
})

