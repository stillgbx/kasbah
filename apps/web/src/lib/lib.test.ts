import { describe, expect, it } from 'vitest'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { optimisticPatch } from './optimistic'
import { fromClosure, toClosure } from './cover'
import type { HouseDevice } from '@kasbah/shared'
import { emitsSound, relayLabel, soundRouting } from './audioRouting'
import { headlineValue, isDeviceBusy, isDeviceOn, isDevicePulsing, statusLabel, toggleChecked, toggleCommand } from './deviceState'
import { formatPower, formatSensor, summarize } from './format'
import { deviceColor, deviceIcon } from './deviceIcons'
import { findBatteries, findEnergySite, isEnergySite } from './energy'
import { isOrientable } from './orientation'
import fr from '../i18n/locales/fr.json'
import en from '../i18n/locales/en.json'

const light: StateFor<'light'> = { kind: 'light', updatedAt: 0, available: true, on: false, brightness: 50 }
const cover: StateFor<'cover'> = { kind: 'cover', updatedAt: 0, available: true, position: 100, motion: 'stopped' }
const sensor: DeviceDescriptor = { id: 'mock:s', pluginId: 'mock', externalId: 's', kind: 'sensor', name: 'T', capabilities: ['measure'], meta: { sensor: { unit: '°C', deviceClass: 'temperature', precision: 1 } } }

describe('optimisticPatch', () => {
  it('light.set', () => {
    expect(optimisticPatch(light, { type: 'light.set', on: true })).toEqual({ on: true })
    expect(optimisticPatch(light, { type: 'light.set', brightness: 0 })).toEqual({ on: false })
    expect(optimisticPatch(light, { type: 'light.set', brightness: 30 })).toEqual({ on: true, brightness: 30 })
    expect(optimisticPatch(light, { type: 'cover.open' })).toBeNull()
  })
  it('cover', () => {
    expect(optimisticPatch(cover, { type: 'cover.close' })).toEqual({ motion: 'closing' })
    expect(optimisticPatch(cover, { type: 'cover.open' })).toEqual({ motion: 'stopped' })
    expect(optimisticPatch(cover, { type: 'cover.set_position', position: 20 })).toEqual({ motion: 'closing' })
    // rappel de la position perso : le sens se lit sur la memoire du moteur, a defaut on parie
    // sur le mouvement plutot que sur un geste sans echo
    expect(optimisticPatch({ ...cover, presetPosition: 20 }, { type: 'cover.preset' })).toEqual({ motion: 'closing' })
    expect(optimisticPatch(cover, { type: 'cover.preset' })).toEqual({ motion: 'opening' })
  })
})

describe('convention d affichage des ouvrants', () => {
  // Le contrat mesure une OUVERTURE, l'interface une FERMETURE. Ces tests epinglent l'inversion :
  // c'est le genre de convention qu'un refactor retourne sans le vouloir.
  const t = ((key: string) => key) as never
  const at = (over: Partial<StateFor<'cover'>>): StateFor<'cover'> => ({ ...cover, ...over })

  it('inverse dans les deux sens', () => {
    expect(toClosure(100)).toBe(0)          // grand ouvert = 0 % de fermeture
    expect(toClosure(0)).toBe(100)
    expect(fromClosure(toClosure(37))).toBe(37)
  })

  it('le libelle donne un pourcentage de FERMETURE', () => {
    expect(statusLabel(sensor, at({ position: 100 }), t, 'fr')).toBe('cover.openClose.open')
    expect(statusLabel(sensor, at({ position: 0 }), t, 'fr')).toBe('cover.openClose.closed')
    expect(statusLabel(sensor, at({ position: 30 }), t, 'fr')).toBe('70 %')
  })

  it('en mouvement, le libelle annonce le mouvement et non une position quittee', () => {
    expect(statusLabel(sensor, at({ position: 100, motion: 'closing' }), t, 'fr')).toBe('cover.openClose.closing')
    expect(statusLabel(sensor, at({ position: 0, motion: 'opening' }), t, 'fr')).toBe('cover.openClose.opening')
  })

  it('occupe = pendant toute la course, pas pendant la requete', () => {
    expect(isDeviceBusy(at({ motion: 'stopped' }))).toBe(false)
    expect(isDeviceBusy(at({ motion: 'closing' }))).toBe(true)
    expect(isDeviceBusy(at({ motion: 'opening' }))).toBe(true)
    // position visee mais moteur pas encore parti : deja occupe
    expect(isDeviceBusy(at({ motion: 'stopped' }), true)).toBe(true)
    expect(isDeviceBusy(light)).toBe(false)          // une lampe n'a pas de course
  })

  it('un store bascule sur l autre vocabulaire', () => {
    const store = { ...sensor, kind: 'cover' as const, meta: { cover: { deviceClass: 'awning' as const } } }
    expect(statusLabel(store, at({ position: 0 }), t, 'fr')).toBe('cover.upDown.closed')
    expect(statusLabel(store, at({ position: 100 }), t, 'fr')).toBe('cover.upDown.open')
    expect(statusLabel(store, at({ position: 40, motion: 'closing' }), t, 'fr')).toBe('cover.upDown.closing')
    // le pourcentage intermediaire reste un pourcentage, quel que soit le vocabulaire
    expect(statusLabel(store, at({ position: 40 }), t, 'fr')).toBe('60 %')
  })

  it('interrupteur : coche = FERME, alors que isDeviceOn garde ouvert = actif', () => {
    expect(toggleChecked(at({ position: 0 }))).toBe(true)
    expect(toggleChecked(at({ position: 100 }))).toBe(false)
    expect(toggleChecked(at({ position: 0, available: false }))).toBe(false)
    expect(toggleChecked(light)).toBe(false)          // une lampe eteinte reste non cochee
  })

  it('bascule : on peut INVERSER un mouvement en cours', () => {
    // volet a 75, on ferme : sans la cible la bascule renverrait encore « fermer »
    expect(toggleCommand(at({ position: 75 }))).toEqual({ type: 'cover.close' })
    expect(toggleCommand(at({ position: 75 }), 0)).toEqual({ type: 'cover.open' })
    // et pendant une ouverture, elle doit pouvoir refermer
    expect(toggleCommand(at({ position: 25 }), 100)).toEqual({ type: 'cover.close' })
  })

  it('interrupteur : la cible visee fait basculer tout de suite', () => {
    // volet a 75 (25 % de fermeture) donc interrupteur eteint ; on vise la fermeture
    expect(toggleChecked(at({ position: 75 }))).toBe(false)
    expect(toggleChecked(at({ position: 75 }), 0)).toBe(true)
    // et dans l'autre sens : ferme, on vise l'ouverture
    expect(toggleChecked(at({ position: 0 }))).toBe(true)
    expect(toggleChecked(at({ position: 0 }), 100)).toBe(false)
  })

  it('position INCONNUE : rien n est affirme', () => {
    // radio unidirectionnelle (RTS) qui n'a jamais recu de commande : `position` est absente.
    // Le piege repare ici : `defaultState` posait 0, et l'interface annoncait « Ferme » / « Baisse »
    // pour deux stores en realite remontes, compteur du resume compris.
    const unknown: StateFor<'cover'> = { kind: 'cover', updatedAt: 0, available: true, motion: 'stopped' }
    expect(statusLabel(sensor, unknown, t, 'fr')).toBe('common.unknown')
    expect(headlineValue(sensor, unknown, t, 'fr')).toBe('common.unknown')
    expect(summarize(sensor, unknown, 'fr')).toBe('—')
    expect(isDeviceOn(unknown)).toBe(false)                             // aucune teinte d'icone
    expect(toggleChecked(unknown)).toBe(false)                          // « ferme » n'est pas affirmable
    expect(toggleCommand(unknown)).toEqual({ type: 'cover.close' })     // la bascule reste utile
    // le mouvement, lui, est connu : c'est la seule chose que la box dise d'un RTS
    expect(statusLabel(sensor, { ...unknown, motion: 'closing' }, t, 'fr')).toBe('cover.openClose.closing')
    // le patch optimiste parie sur le mouvement plutot que sur « deja au bout »
    expect(optimisticPatch(unknown, { type: 'cover.open' })).toEqual({ motion: 'opening' })
    expect(optimisticPatch(unknown, { type: 'cover.close' })).toEqual({ motion: 'closing' })
  })
})

describe('lecteur : appli a l ecran (`on`)', () => {
  const t = ((key: string) => key) as never
  const tv = (playback: StateFor<'media_player'>['playback']): StateFor<'media_player'> =>
    ({ kind: 'media_player', updatedAt: 0, available: true, playback, volume: 100, muted: false, nowPlaying: { title: '', source: 'Netflix' } })
  it('compte comme actif et pulse, comme une lecture ; au repos non', () => {
    expect(isDeviceOn(tv('on'))).toBe(true)
    expect(toggleChecked(tv('on'))).toBe(true)
    expect(isDevicePulsing(tv('on'))).toBe(true)
    expect(isDeviceOn(tv('idle'))).toBe(false)
    expect(isDevicePulsing(tv('idle'))).toBe(false)
  })
  it('le libelle nomme l appli ; la bascule FERME l appli (stop), la pause restant a la lecture', () => {
    expect(statusLabel(sensor, tv('on'), t, 'fr')).toBe('media.on · Netflix')
    expect(toggleCommand(tv('on'))).toEqual({ type: 'media_player.stop' })
    expect(toggleCommand(tv('playing'))).toEqual({ type: 'media_player.pause' })
    expect(toggleCommand(tv('idle'))).toEqual({ type: 'media_player.play' })
  })
})

describe('routage du son : une TV en HDMI ARC fait jouer une barre', () => {
  // Le cas relevé le 2026-09-10 : la TV du salon joue YouTube Music, son son part en eARC vers la barre
  // de son, que le protocole Cast voit au repos. Le lien est déclaré dans house.json sur la TV.
  const t = ((key: string, named?: Record<string, unknown>) => `${key}${named ? `(${String(named.name)})` : ''}`) as never
  const tvHouse: HouseDevice = { id: 'tv', deviceId: 'cast:tv', position: [0, 0, 0], meta: { audioOutput: 'bar' } }
  const barHouse: HouseDevice = { id: 'bar', deviceId: 'cast:bar', position: [0, 0, 0] }
  const player = (over: Partial<StateFor<'media_player'>>): StateFor<'media_player'> =>
    ({ kind: 'media_player', updatedAt: 0, available: true, playback: 'idle', volume: 6, muted: false, ...over })
  const tvPlaying = player({ playback: 'playing', nowPlaying: { title: 'Cs60', artist: 'BADBADNOTGOOD' }, audioOutput: { terminal: 'external', name: 'Flexus 300' } })
  const bar = player({})

  it('la barre relaie et fait du bruit, la TV se tait (son son sort ailleurs)', () => {
    const r = soundRouting([tvHouse, barHouse], { 'cast:tv': tvPlaying, 'cast:bar': bar })
    expect(r.relays.get('cast:bar')).toBe('cast:tv')
    expect(emitsSound('cast:bar', bar, r)).toBe(true)
    expect(emitsSound('cast:tv', tvPlaying, r)).toBe(false)
    expect(relayLabel('TV Salon', tvPlaying, t)).toBe('media.relaying(TV Salon) · Cs60')
  })
  it('TV réglée sur ses haut-parleurs : le lien ne joue pas ; TV muette là-dessus : on croit la déclaration', () => {
    const own = { ...tvPlaying, audioOutput: { terminal: 'internal' as const } }
    const r1 = soundRouting([tvHouse, barHouse], { 'cast:tv': own, 'cast:bar': bar })
    expect(r1.relays.size).toBe(0)
    expect(emitsSound('cast:tv', own, r1)).toBe(true)
    expect(emitsSound('cast:bar', bar, r1)).toBe(false)
    const { audioOutput: _o, ...unknown } = tvPlaying
    const r2 = soundRouting([tvHouse, barHouse], { 'cast:tv': unknown, 'cast:bar': bar })
    expect(r2.relays.get('cast:bar')).toBe('cast:tv')
    expect(emitsSound('cast:tv', unknown, r2)).toBe(false)
    // `both` : les deux jouent
    const both = { ...tvPlaying, audioOutput: { terminal: 'both' as const } }
    const r3 = soundRouting([tvHouse, barHouse], { 'cast:tv': both, 'cast:bar': bar })
    expect(emitsSound('cast:tv', both, r3)).toBe(true)
    expect(emitsSound('cast:bar', bar, r3)).toBe(true)
  })
  it('rien ne joue, TV indisponible, ou lien vers un appareil absent : personne ne relaie', () => {
    expect(soundRouting([tvHouse, barHouse], { 'cast:tv': player({ audioOutput: { terminal: 'external' } }), 'cast:bar': bar }).relays.size).toBe(0)
    expect(soundRouting([tvHouse, barHouse], { 'cast:tv': { ...tvPlaying, available: false }, 'cast:bar': bar }).relays.size).toBe(0)
    expect(soundRouting([tvHouse], { 'cast:tv': tvPlaying }).relays.size).toBe(0)
    // sans lien déclaré, une TV qui envoie son son ailleurs se tait quand même : l'image reste chez elle
    const r = soundRouting([{ ...tvHouse, meta: {} }, barHouse], { 'cast:tv': tvPlaying, 'cast:bar': bar })
    expect(emitsSound('cast:tv', tvPlaying, r)).toBe(false)
    expect(emitsSound('cast:bar', bar, r)).toBe(false)
  })
})

describe("site energie vs batterie", () => {
  const entry = (externalId: string, capabilities: DeviceDescriptor['capabilities'], state: Partial<StateFor<'energy'>>) => ({
    descriptor: { id: `enphase:${externalId}`, pluginId: 'enphase', externalId, kind: 'energy' as const, name: externalId, capabilities, meta: {} },
    state: { kind: 'energy' as const, updatedAt: 0, available: true, productionW: 0, consumptionW: 0, gridW: 0, ...state },
  })
  // ordre reel d'une installation Enphase : le site, puis les batteries
  const site = entry('site', ['production', 'consumption', 'grid', 'storage'], { productionW: 6456, consumptionW: 691, gridW: -5765 })
  const battery = entry('b1', ['storage'], { batterySoc: 100, batteryW: -16 })

  it('reconnait le site par la mesure du RESEAU, pas par son rang dans la liste', () => {
    expect(isEnergySite(site.descriptor)).toBe(true)
    expect(isEnergySite(battery.descriptor)).toBe(false)
    // regression : une batterie placee avant le site donnait 0 W de production et 100 % de charge
    expect(findEnergySite([battery, site])?.descriptor.externalId).toBe('site')
    expect(findEnergySite([site, battery])?.descriptor.externalId).toBe('site')
  })

  it('liste les batteries a part, et se rabat sur le premier `energy` sans compteur reseau', () => {
    expect(findBatteries([site, battery, battery]).map((e) => e.descriptor.externalId)).toEqual(['b1', 'b1'])
    const noMeter = entry('sans-compteur', ['production'], { productionW: 12 })
    expect(findEnergySite([noMeter])?.descriptor.externalId).toBe('sans-compteur')
    expect(findEnergySite([])).toBeUndefined()
  })
})

describe("ce qui a une orientation reglable", () => {
  const dev = { id: 'x', position: [0, 0, 0] as [number, number, number] }
  const desc = (kind: DeviceDescriptor['kind'], meta: DeviceDescriptor['meta'] = {}): DeviceDescriptor =>
    ({ id: `p:${kind}`, pluginId: 'p', externalId: kind, kind, name: kind, capabilities: [], meta })

  it('ce qui REGARDE quelque part, et ce qui se pose CONTRE UN MUR', () => {
    // regarde quelque part
    expect(isOrientable(dev, desc('camera'))).toBe(true)
    expect(isOrientable(dev, desc('vehicle'))).toBe(true)
    expect(isOrientable(dev, desc('media_player', { mediaPlayer: { deviceClass: 'tv' } }))).toBe(true)
    // a une face : borne de recharge, batterie, boitier de passerelle
    expect(isOrientable(dev, desc('ev_charger'))).toBe(true)
    expect(isOrientable(dev, desc('energy'))).toBe(true)
  })

  it("ni une enceinte, ni une lampe, ni un capteur n'ont d'orientation utile", () => {
    expect(isOrientable(dev, desc('media_player', { mediaPlayer: { deviceClass: 'speaker' } }))).toBe(false)
    expect(isOrientable(dev, desc('light'))).toBe(false)
    expect(isOrientable(dev, desc('sensor'))).toBe(false)
    // sans descripteur, seul un `yaw` deja pose dans le JSON fait foi
    expect(isOrientable(dev, undefined)).toBe(false)
    expect(isOrientable({ ...dev, yaw: 90 }, undefined)).toBe(true)
  })
})

describe('format & icons', () => {
  it('formats power and sensors', () => {
    expect(formatPower(850, 'en')).toBe('850 W')
    expect(formatPower(2400, 'en')).toBe('2.4 kW')
    expect(formatSensor(sensor, 21.44, 'en')).toBe('21.4 °C')
    expect(summarize(sensor, { kind: 'sensor', updatedAt: 0, available: true, value: 3 }, 'en')).toBe('3.0 °C')
  })
  it('picks icons and colors from state', () => {
    const d: DeviceDescriptor = { ...sensor, kind: 'light', capabilities: ['on_off'], meta: {} }
    expect(deviceIcon(d, { ...light, on: true })).not.toBe(deviceIcon(d, light))
    expect(deviceColor({ ...light, on: true })).toBe('warning')
    expect(deviceColor({ ...light, available: false })).toBe('on-surface-variant')
  })
})

describe('i18n locales', () => {
  const keys = (o: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? keys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]))
  it('fr and en expose the same keys', () => {
    const a = keys(fr).sort(), b = keys(en).sort()
    expect(a).toEqual(b)
  })
})
