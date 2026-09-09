import { describe, expect, it } from 'vitest'
import { GATEWAY, IO_AWNING, IO_SHUTTER, IO_VENETIAN, RTS_GATE, RTS_SHUTTER, THERMOSTAT } from './__fixtures__/box'
import {
  assumedPosition, coverClass, coverCommands, deviceUrlToExternalId, hasPositionFeedback, isCover,
  readStates, toAction, toAvailability, toCoverPatch, toDescriptor,
} from './mapping'
import { overkizDeviceSchema } from './types'

const dev = (raw: unknown) => overkizDeviceSchema.parse(raw)
const ioShutter = dev(IO_SHUTTER)
const ioVenetian = dev(IO_VENETIAN)
const ioAwning = dev(IO_AWNING)
const rtsShutter = dev(RTS_SHUTTER)
const rtsGate = dev(RTS_GATE)

describe('tahoma mapping', () => {
  it('keeps only the covers', () => {
    expect([ioShutter, ioVenetian, ioAwning, rtsShutter, rtsGate].every(isCover)).toBe(true)
    expect(isCover(dev(GATEWAY))).toBe(false)
    expect(isCover(dev(THERMOSTAT))).toBe(false)
  })

  it('resolves the command names each family uses', () => {
    expect(coverCommands(ioShutter)).toEqual({
      open: 'open', close: 'close', stop: 'stop', position: 'setClosure',
      preset: 'my', presetSet: 'setMemorized1Position',
    })
    expect(coverCommands(ioVenetian)).toMatchObject({ position: 'setClosure', tilt: 'setOrientation' })
    // store banne : déployer = fermer
    expect(coverCommands(ioAwning)).toEqual({ open: 'undeploy', close: 'deploy', stop: 'stop', position: 'setDeployment' })
    // `my` sans `setClosure` : le moteur rejoint sa position favorite sans savoir en viser une autre
    expect(coverCommands(rtsShutter)).toEqual({ open: 'up', close: 'down', stop: 'stop', preset: 'my' })
    expect(coverCommands(rtsGate)).toEqual({ open: 'open', close: 'close' })
  })

  it('tells apart bidirectional io from one-way RTS, from the LIVE states', () => {
    // piege : la box renvoie toujours `definition.states` vide, seul `states` est exploitable
    expect((ioShutter.definition as { states?: unknown }).states).toBeUndefined()
    expect(hasPositionFeedback(ioShutter)).toBe(true)
    expect(hasPositionFeedback(ioAwning)).toBe(true)
    expect(rtsShutter.states).toEqual([])
    expect(hasPositionFeedback(rtsShutter)).toBe(false)
  })

  it('externalId: no colon, slash or hash', () => {
    expect(deviceUrlToExternalId('io://1234-5678-9012/11110001')).toBe('io.1234-5678-9012.11110001')
    expect(deviceUrlToExternalId('io://1234-5678-9012/11110001#2')).toBe('io.1234-5678-9012.11110001.2')
    expect(deviceUrlToExternalId(GATEWAY.deviceURL)).not.toMatch(/[:/#\s]/)
  })

  it('classe l ouvrant d apres la uiClass de la box', () => {
    expect(coverClass(ioShutter)).toBe('shutter')
    expect(coverClass(ioVenetian)).toBe('blind')
    expect(coverClass(ioAwning)).toBe('awning')
    expect(coverClass(rtsGate)).toBe('gate')
    expect(coverClass(dev(THERMOSTAT))).toBeUndefined()
    // la classe voyage dans le descripteur : c'est elle qui decide du vocabulaire affiche
    expect(toDescriptor(ioAwning).meta.cover).toEqual({ deviceClass: 'awning' })
    expect(toDescriptor(rtsGate).meta.cover).toEqual({ deviceClass: 'gate' })
  })

  it('descriptor: capabilities follow the declared commands', () => {
    expect(toDescriptor(ioShutter)).toMatchObject({
      id: 'tahoma:io.1234-5678-9012.11110001', kind: 'cover', name: 'Volet salon',
      capabilities: ['open_close', 'position', 'stop', 'preset', 'preset_set'],
      meta: { manufacturer: 'Somfy', model: 'io:RollerShutterGenericIOComponent' },
    })
    // l'API locale n'expose aucune pièce : le rattachement vient de house.json
    expect(toDescriptor(ioShutter).meta.room).toBeUndefined()
    expect(toDescriptor(ioVenetian).capabilities).toEqual(['open_close', 'position', 'tilt', 'stop'])
    // RTS : pas de `position`, donc pas de curseur côté UI ; pas de `stop` pour le portail
    expect(toDescriptor(rtsShutter).capabilities).toEqual(['open_close', 'stop', 'preset'])
    expect(toDescriptor(rtsGate).capabilities).toEqual(['open_close'])
  })

  it('state patch: closure and deployment are inverted into an opening', () => {
    // l'appareil porte aussi un etat a valeur tableau et des etats hors sujet : ignores sans bruit
    expect(toCoverPatch(readStates(ioShutter.states))).toEqual({ position: 70, presetPosition: 27, motion: 'stopped' })
    expect(toCoverPatch(readStates(ioVenetian.states))).toEqual({ position: 0, tilt: 40, motion: 'stopped' })
    // store rentré (déploiement 0) = ouvert
    expect(toCoverPatch(readStates(ioAwning.states))).toEqual({ position: 100, motion: 'stopped' })
    expect(toCoverPatch(readStates(rtsShutter.states))).toEqual({})
  })

  it('state patch: motion follows the announced target, values may be strings', () => {
    const closing = readStates([
      { name: 'core:ClosureState', value: '60' },
      { name: 'core:TargetClosureState', value: '100' },
      { name: 'core:MovingState', value: 'true' },
    ])
    expect(toCoverPatch(closing)).toEqual({ position: 40, motion: 'closing' })
    // sans cible annoncée, le sens vient de la position précédente
    const noTarget = readStates([{ name: 'core:ClosureState', value: 20 }, { name: 'core:MovingState', value: true }])
    expect(toCoverPatch(noTarget, 50).motion).toBe('opening')
    expect(toCoverPatch(noTarget, 90).motion).toBe('closing')
    // fragment sans information de mouvement : la clé est omise (l'état précédent survit)
    expect(toCoverPatch(readStates([{ name: 'core:ClosureState', value: 20 }]))).toEqual({ position: 80 })
  })

  it('availability from core:StatusState then from the setup flags', () => {
    expect(toAvailability(ioShutter, readStates(ioShutter.states))).toBe(true)
    expect(toAvailability(ioShutter, readStates([{ name: 'core:StatusState', value: 'unavailable' }]))).toBe(false)
    expect(toAvailability(dev({ ...RTS_SHUTTER, available: false }), new Map())).toBe(false)
  })

  it('actions: position is sent back as a closure, unsupported commands yield nothing', () => {
    const io = coverCommands(ioShutter)
    expect(toAction(ioShutter.deviceURL, { type: 'cover.close' }, io))
      .toEqual({ deviceURL: ioShutter.deviceURL, commands: [{ name: 'close', parameters: [] }] })
    expect(toAction(ioShutter.deviceURL, { type: 'cover.set_position', position: 70 }, io)?.commands)
      .toEqual([{ name: 'setClosure', parameters: [30] }])
    expect(toAction(ioAwning.deviceURL, { type: 'cover.open' }, coverCommands(ioAwning))?.commands)
      .toEqual([{ name: 'undeploy', parameters: [] }])
    expect(toAction(ioVenetian.deviceURL, { type: 'cover.set_tilt', tilt: 25 }, coverCommands(ioVenetian))?.commands)
      .toEqual([{ name: 'setOrientation', parameters: [25] }])
    expect(toAction(rtsShutter.deviceURL, { type: 'cover.up' } as never, coverCommands(rtsShutter))).toBeUndefined()
    // position favorite : `my`, sans parametre — la valeur vit dans le moteur, pas dans la commande
    expect(toAction(ioShutter.deviceURL, { type: 'cover.preset' }, io)?.commands)
      .toEqual([{ name: 'my', parameters: [] }])
    expect(toAction(rtsShutter.deviceURL, { type: 'cover.preset' }, coverCommands(rtsShutter))?.commands)
      .toEqual([{ name: 'my', parameters: [] }])
    // le BSO et le portail ne declarent pas `my` : la commande n'existe pas pour eux
    expect(toAction(ioVenetian.deviceURL, { type: 'cover.preset' }, coverCommands(ioVenetian))).toBeUndefined()
    expect(toAction(rtsGate.deviceURL, { type: 'cover.preset' }, coverCommands(rtsGate))).toBeUndefined()
    // reecrire la memoire : meme inversion que setClosure, la box stocke une FERMETURE
    expect(toAction(ioShutter.deviceURL, { type: 'cover.set_preset', position: 27 }, io)?.commands)
      .toEqual([{ name: 'setMemorized1Position', parameters: [73] }])
    // un RTS rappelle sa position favorite sans savoir la lire ni la reecrire : trois niveaux
    expect(coverCommands(rtsShutter).presetSet).toBeUndefined()
    expect(toDescriptor(rtsShutter).capabilities).not.toContain('preset_set')
    expect(toAction(rtsShutter.deviceURL, { type: 'cover.set_preset', position: 50 }, coverCommands(rtsShutter))).toBeUndefined()
    expect(toAction(rtsShutter.deviceURL, { type: 'cover.set_position', position: 50 }, coverCommands(rtsShutter))).toBeUndefined()
    expect(toAction(rtsGate.deviceURL, { type: 'cover.stop' }, coverCommands(rtsGate))).toBeUndefined()
  })

  it('assumed position for one-way devices', () => {
    expect(assumedPosition({ type: 'cover.open' })).toBe(100)
    expect(assumedPosition({ type: 'cover.close' })).toBe(0)
    expect(assumedPosition({ type: 'cover.stop' })).toBeUndefined()
  })
})
