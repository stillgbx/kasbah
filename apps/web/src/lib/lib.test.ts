import { describe, expect, it } from 'vitest'
import type { DeviceDescriptor, StateFor } from '@kasbah/shared'
import { optimisticPatch } from './optimistic'
import { fromClosure, toClosure } from './cover'
import { isDeviceBusy, statusLabel, toggleChecked, toggleCommand } from './deviceState'
import { formatPower, formatSensor, summarize } from './format'
import { deviceColor, deviceIcon } from './deviceIcons'
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
    expect(statusLabel(sensor, at({ position: 100 }), t, 'fr')).toBe('cover.open')
    expect(statusLabel(sensor, at({ position: 0 }), t, 'fr')).toBe('cover.closed')
    expect(statusLabel(sensor, at({ position: 30 }), t, 'fr')).toBe('70 %')
  })

  it('en mouvement, le libelle annonce le mouvement et non une position quittee', () => {
    expect(statusLabel(sensor, at({ position: 100, motion: 'closing' }), t, 'fr')).toBe('cover.closing')
    expect(statusLabel(sensor, at({ position: 0, motion: 'opening' }), t, 'fr')).toBe('cover.opening')
  })

  it('occupe = pendant toute la course, pas pendant la requete', () => {
    expect(isDeviceBusy(at({ motion: 'stopped' }))).toBe(false)
    expect(isDeviceBusy(at({ motion: 'closing' }))).toBe(true)
    expect(isDeviceBusy(at({ motion: 'opening' }))).toBe(true)
    // position visee mais moteur pas encore parti : deja occupe
    expect(isDeviceBusy(at({ motion: 'stopped' }), true)).toBe(true)
    expect(isDeviceBusy(light)).toBe(false)          // une lampe n'a pas de course
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
