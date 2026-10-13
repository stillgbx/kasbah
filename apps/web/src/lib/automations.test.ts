import { beforeEach, describe, expect, it } from 'vitest'
import type { AutomationBody } from '@kasbah/shared'
import { i18n } from '../i18n'
import {
  blankAction, blankAutomation, blankPredicate, choiceOf, COMMAND_CHOICES, describeAutomation, involvedDeviceIds, involvedRoomIds, missingPart, type NameContext,
} from './automations'

const t = i18n.global.t as unknown as (key: string, named?: Record<string, unknown> | number, plural?: number) => string

const names: NameContext = {
  deviceName: (id) => ({ 'mock:vehicle-tesla': 'Tesla', 'mock:cover-gate': 'Portail', 'mock:light-living': 'Plafonnier salon' })[id] ?? id,
  roomName: (id) => ({ salon: 'Salon', terrasse: 'Terrasse' })[id] ?? id,
  levelName: (id) => ({ rdc: 'Rez-de-chaussée' })[id] ?? id,
  zoneName: (id) => id,
  parkingName: (id) => id,
  sceneName: (id) => id,
}

const dusk: AutomationBody = {
  name: 'Volets au crépuscule', enabled: true,
  trigger: { type: 'time', at: { kind: 'sun', event: 'dusk', offsetMin: -15, notAfter: '22:00' }, days: [1, 2, 3, 4, 5] },
  unless: [{ type: 'anyInRoom', roomId: 'terrasse', kind: 'media_player' }, { type: 'anyInRoom', roomId: 'terrasse', kind: 'light' }],
  actions: [{ type: 'command', target: { type: 'selector', kind: 'cover', deviceClass: 'shutter', levelIds: ['rdc'] }, command: { type: 'cover.close' } }],
}

describe('describeAutomation', () => {
  beforeEach(() => { i18n.global.locale.value = 'fr' })

  it('reads the dusk shutters rule as one sentence', () => {
    expect(describeAutomation(dusk, names, t, 'fr')).toBe(
      'Lun–ven · 15 min avant la fin du crépuscule · pas après 22:00 → Fermer · chaque volet · Rez-de-chaussée · sauf si Lecteur en marche · Terrasse ou Lumière en marche · Terrasse',
    )
  })

  it('reads a state trigger with a hold time, a named device and a plural target', () => {
    const a: AutomationBody = {
      ...dusk,
      trigger: { type: 'state', when: { type: 'vehicleOnSite', deviceId: 'mock:vehicle-tesla' }, forMin: 2 },
      unless: [{ type: 'timeWindow', from: '23:00', to: '06:00', not: true }],
      actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:cover-gate', 'mock:light-living'] }, command: { type: 'cover.open' } }],
    }
    expect(describeAutomation(a, names, t, 'fr')).toBe('Quand Tesla à la maison depuis 2 min → Ouvrir · 2 appareils · sauf si pas (entre 23:00 et 06:00)')
  })

  it('says how long a light fades, before the hold time', () => {
    const a: AutomationBody = {
      ...dusk, unless: [],
      actions: [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:light-living'] }, command: { type: 'light.set', on: true, transitionMs: 600_000 }, forMin: 120 }],
    }
    expect(describeAutomation(a, names, t, 'fr')).toBe('Lun–ven · 15 min avant la fin du crépuscule · pas après 22:00 → Allumer · Plafonnier salon · en 10 min · pendant 120 min')
    a.actions = [{ type: 'command', target: { type: 'devices', deviceIds: ['mock:light-living'] }, command: { type: 'light.set', on: false, transitionMs: 90_000 } }]
    expect(describeAutomation(a, names, t, 'fr')).toBe('Lun–ven · 15 min avant la fin du crépuscule · pas après 22:00 → Éteindre · Plafonnier salon · en 90 s')
  })

  it('speaks English too', () => {
    i18n.global.locale.value = 'en'
    const a: AutomationBody = { ...dusk, unless: [], trigger: { type: 'time', at: { kind: 'clock', time: '12:00' }, days: [1, 5] } }
    expect(describeAutomation(a, names, t, 'en')).toBe('Mon, Fri · at 12:00 → Close · every shutter · Rez-de-chaussée')
  })
})

describe('draft helpers', () => {
  it('says what is missing, in the order of the form', () => {
    expect(missingPart(blankAutomation())).toBe('name')
    expect(missingPart({ ...blankAutomation('Nuit') })).toBe('actions')
    expect(missingPart({ ...blankAutomation('Nuit'), actions: [blankAction('command')] })).toBe('actions')   // aucun appareil choisi
    expect(missingPart({ ...dusk, unless: [blankPredicate('deviceOn')] })).toBe('unless')
    expect(missingPart(dusk)).toBeNull()
  })

  it('finds the devices and rooms a rule names, for the search', () => {
    const a: AutomationBody = {
      ...dusk,
      trigger: { type: 'state', when: { type: 'any', of: [{ type: 'deviceOn', deviceId: 'mock:light-living' }] } },
    }
    expect(involvedDeviceIds(a)).toEqual(['mock:light-living'])
    expect(involvedRoomIds(a)).toEqual(['terrasse'])
  })

  it('recognises every command it builds', () => {
    for (const c of COMMAND_CHOICES) expect(choiceOf(c.build(c.param?.type === 'url' ? 'https://x/y.mp3' : undefined))?.key).toBe(c.key)
  })
})
