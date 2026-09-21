import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { optimisticPatch } from '../../lib/optimistic'
import PetFeederCard from './PetFeederCard.vue'
import PetFountainCard from './PetFountainCard.vue'

// Ce que ces cartes doivent tenir, et qui vient du CONTRAT plutôt que du dessin :
//
//  - une ration n'est proposée que si l'appareil DIT laquelle il accepte. Sans
//    `meta.petFeeder.portionsG`, aucun bouton — un curseur ou une valeur par défaut servirait
//    autre chose que ce que l'utilisateur croit demander ;
//  - une section suit sa CAPACITÉ : pas de ligne « filtre » sur une fontaine qui n'en déclare pas ;
//  - une valeur inconnue s'écrit « — » et ne fait pas disparaître sa ligne (« rien ne bouge »).

const feeder: DeviceDescriptor = {
  id: 'petkit:d4-1', pluginId: 'petkit', externalId: 'd4-1', kind: 'pet_feeder', name: 'Mangeoire',
  capabilities: ['feed', 'consumables', 'battery'],
  meta: { manufacturer: 'PetKit', model: 'Fresh Element Solo', petFeeder: { portions: [1, 2, 3, 4, 5], unit: 'cup' as const } },
}
const feederState: StateFor<'pet_feeder'> = {
  kind: 'pet_feeder', updatedAt: 0, available: true, foodLow: false, servedToday: 4, plannedToday: 5, desiccantDays: 18,
}

const fountain: DeviceDescriptor = {
  id: 'petkit:ctw3-2', pluginId: 'petkit', externalId: 'ctw3-2', kind: 'pet_fountain', name: 'Fontaine',
  capabilities: ['on_off', 'pump_mode', 'consumables', 'battery', 'water_usage'],
  meta: { manufacturer: 'PetKit', model: 'Eversweet Max' },
}
const fountainState: StateFor<'pet_fountain'> = {
  kind: 'pet_fountain', updatedAt: 0, available: true, on: true, mode: 'intermittent', filterPct: 78, drinksToday: 6, drinkAvgS: 26,
}

describe('PetFeederCard', () => {
  it('propose une ration par valeur acceptée, et rien d’autre', () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: feederState } })
    // En TASSES, l'unité que CETTE machine déclare — avec la contrepartie en grammes en dessous,
    // ESTIMÉE d'après le poids d'une tasse (100 g par défaut). L'appli du fabricant écrit
    // « 1/2 (environ 50 g) » : 10 g par dixième, le même compte.
    const labels = w.findAll('button').map((b) => b.text()).filter((t) => t.includes('tasse'))
    expect(labels).toEqual(['0,1 tasse~ 10 g', '0,2 tasse~ 20 g', '0,3 tasse~ 30 g', '0,4 tasse~ 40 g', '0,5 tasse~ 50 g'])
  })

  it('émet la ration demandée, dans l’unité de l’appareil', async () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: feederState } })
    await w.findAll('button').find((b) => b.text().startsWith('0,3 tasse'))!.trigger('click')
    expect(w.emitted('command')?.[0]).toEqual([{ type: 'pet_feeder.feed', amount: 3 }])
  })

  it('ne propose AUCUNE ration quand l’appareil ne dit pas lesquelles il accepte', () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] },
      props: { descriptor: { ...feeder, meta: { manufacturer: 'PetKit' } }, state: feederState },
    })
    expect(w.findAll('button').filter((b) => b.text().includes('tasse'))).toHaveLength(0)
  })

  it('garde la ligne du dessiccant, avec un tiret, quand la valeur est inconnue', () => {
    const w = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: { ...feederState, desiccantDays: undefined } } })
    expect(w.text()).toContain('Dessiccant')
    expect(w.text()).toContain('—')
  })
})

describe('PetFountainCard', () => {
  it('bascule la pompe sur l’état INVERSE de celui qu’elle montre', async () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState } })
    await w.findAll('button')[0]!.trigger('click')
    expect(w.emitted('command')?.[0]).toEqual([{ type: 'pet_fountain.set_power', on: false }])
  })

  it('grise les régimes quand la pompe est à l’arrêt : les régler n’aurait pas de sens', () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: { ...fountainState, on: false } } })
    const modes = w.findAll('button').slice(1)
    expect(modes.length).toBe(2)
    expect(modes.every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('compte des PASSAGES, pas des millilitres : une Eversweet Max ne mesure aucun volume', () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState } })
    expect(w.text()).toContain('Passages aujourd')
    expect(w.text()).toContain('26 s en moyenne')
    expect(w.text()).not.toContain('mL')
  })

  it('n’affiche pas la ligne du filtre quand la capacité n’est pas déclarée', () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] },
      props: { descriptor: { ...fountain, capabilities: ['on_off'] }, state: fountainState },
    })
    expect(w.text()).not.toContain('Filtre')
  })

  it('dit toujours l’ÂGE du relevé — une fontaine Bluetooth n’est jamais en temps réel', () => {
    const fresh = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: { ...fountainState, syncedAt: Date.now() } } })
    expect(fresh.text()).toContain('Relevé')
    const never = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState } })
    expect(never.text()).toContain('Date du relevé inconnue')
  })
})

describe('animaux — retour immédiat sur une commande', () => {
  // Trois choses doivent se voir quand on appuie, sinon on ne sait pas si le geste est parti :
  // l'état bascule TOUT DE SUITE (le store revient en arrière si le fabricant refuse), le bouton
  // poussé — et lui seul — tourne, et rien ne change de taille pendant l'attente.

  it('bascule l’état sans attendre le fabricant', () => {
    expect(optimisticPatch(fountainState, { type: 'pet_fountain.set_power', on: false })).toEqual({ on: false })
    // régler le régime rallume : c'est la MÊME trame qui porte les deux
    expect(optimisticPatch(fountainState, { type: 'pet_fountain.set_mode', mode: 'continuous' }))
      .toEqual({ mode: 'continuous', on: true })
    // la ration ne s'ajoute PAS au servi : la machine peut verser moins que demandé
    expect(optimisticPatch(feederState, { type: 'pet_feeder.feed', amount: 3 })).toEqual({ feeding: true })
  })

  it('ne fait tourner QUE le bouton poussé', async () => {
    const w = mount(PetFountainCard, { global: { plugins: [createPinia()] }, props: { descriptor: fountain, state: fountainState, pending: false } })
    const modeBtn = w.findAll('button').find((b) => b.text().includes('Continu'))!
    await modeBtn.trigger('click')
    await w.setProps({ pending: true })
    const loading = w.findAll('.v-btn--loading')
    expect(loading).toHaveLength(1)
    expect(loading[0]!.text()).toContain('Continu')
    // commande réglée : plus rien ne tourne
    await w.setProps({ pending: false })
    expect(w.findAll('.v-btn--loading')).toHaveLength(0)
  })

  it('un message d’erreur REMPLACE la ligne d’alerte, il n’en ajoute pas', () => {
    const calm = mount(PetFeederCard, { global: { plugins: [createPinia()] }, props: { descriptor: feeder, state: feederState } })
    const angry = mount(PetFeederCard, { global: { plugins: [createPinia()] },
      props: { descriptor: feeder, state: { ...feederState, errorMessage: 'Porte obstruée, retirez les croquettes coincées et relancez la distribution' } },
    })
    // même nombre de lignes : la carte ne grandit pas d'un pouce
    expect(angry.findAll('.line')).toHaveLength(calm.findAll('.line').length)
    expect(angry.find('.line').text()).toContain('Porte obstru')
    expect(calm.find('.line').text()).toContain('Trémie garnie')
  })
})
