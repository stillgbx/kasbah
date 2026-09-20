import { describe, expect, it } from 'vitest'
import { DEVICE_KINDS, KIND_CAPABILITIES } from './kinds'
import { deviceDescriptorSchema, type DeviceDescriptor } from './descriptor'
import { deviceStateSchema, type StateFor } from './state'
import { commandSchema, commandKind } from './command'
import type { CommandNotAllowedError} from './rules';
import { assertCommandAllowed, defaultState, estimateChargePowerW, makeDeviceId, mergeState, parseDeviceId } from './rules'

const light: DeviceDescriptor = {
  id: 'mock:light-1', pluginId: 'mock', externalId: 'light-1', kind: 'light', name: 'Lampe',
  capabilities: ['on_off', 'brightness'], meta: {},
}

describe('device ids', () => {
  it('round-trips', () => {
    expect(parseDeviceId(makeDeviceId('hue', 'abc-def'))).toEqual({ pluginId: 'hue', externalId: 'abc-def' })
  })
  it('rejects malformed ids', () => {
    expect(() => parseDeviceId('nocolon')).toThrow()
    expect(() => parseDeviceId('Hue:x')).toThrow()
    expect(() => parseDeviceId('hue:a:b')).toThrow()
  })
})

describe('descriptor schema', () => {
  it('accepts a consistent descriptor', () => {
    expect(deviceDescriptorSchema.parse(light)).toMatchObject({ id: 'mock:light-1' })
  })
  it('rejects id mismatch', () => {
    expect(deviceDescriptorSchema.safeParse({ ...light, id: 'mock:other' }).success).toBe(false)
  })
  it('rejects capability not allowed for kind', () => {
    expect(deviceDescriptorSchema.safeParse({ ...light, capabilities: ['position'] }).success).toBe(false)
  })
})

describe('assertCommandAllowed', () => {
  it('accepts a supported command', () => {
    expect(() => assertCommandAllowed(light, { type: 'light.set', on: true })).not.toThrow()
  })
  it('rejects a command of another kind', () => {
    try { assertCommandAllowed(light, { type: 'cover.open' }); expect.fail('should throw') }
    catch (e) { expect((e as CommandNotAllowedError).code).toBe('KIND_MISMATCH') }
  })
  it('rejects a command whose capability is missing', () => {
    const cover: DeviceDescriptor = { ...light, id: 'mock:c', externalId: 'c', kind: 'cover', capabilities: ['position'] }
    try { assertCommandAllowed(cover, { type: 'cover.stop' }); expect.fail('should throw') }
    catch (e) { expect((e as CommandNotAllowedError).code).toBe('UNSUPPORTED_COMMAND') }
  })
  it('derives kind from the command name', () => {
    expect(commandKind({ type: 'media_player.set_volume', volume: 10 })).toBe('media_player')
  })
  it('accepts play_url only with http(s) and the play_url capability', () => {
    expect(commandSchema.safeParse({ type: 'media_player.play_url', url: 'https://icecast.example/a.mp3' }).success).toBe(true)
    expect(commandSchema.safeParse({
      type: 'media_player.play_url',
      url: 'https://icecast.example/a.mp3',
      title: 'Horizon',
      artist: 'Mira',
      artUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
    }).success).toBe(true)
    expect(commandSchema.safeParse({ type: 'media_player.play_url', url: 'ftp://files.example/a.mp3' }).success).toBe(false)
    const player: DeviceDescriptor = {
      ...light, id: 'mock:p', externalId: 'p', kind: 'media_player', capabilities: ['playback'],
    }
    try { assertCommandAllowed(player, { type: 'media_player.play_url', url: 'https://icecast.example/a.mp3' }); expect.fail('should throw') }
    catch (e) { expect((e as CommandNotAllowedError).code).toBe('UNSUPPORTED_COMMAND') }
    expect(() => assertCommandAllowed({ ...player, capabilities: ['playback', 'play_url'] }, { type: 'media_player.play_url', url: 'https://icecast.example/a.mp3' })).not.toThrow()
  })
  it('every command type parses with its prefix as a known kind', () => {
    for (const opt of commandSchema.options) {
      const type = opt.shape.type.value
      expect(DEVICE_KINDS).toContain(commandKind(type))
    }
  })
})

describe('mergeState', () => {
  const prev: StateFor<'light'> = { kind: 'light', updatedAt: 1, available: true, on: false, brightness: 40 }
  it('returns the same reference when nothing changes', () => {
    expect(mergeState(prev, { on: false, brightness: 40 }, 99)).toBe(prev)
    expect(mergeState(prev, {}, 99)).toBe(prev)
  })
  it('applies changes and stamps updatedAt', () => {
    const next = mergeState(prev, { on: true }, 99)
    expect(next).not.toBe(prev)
    expect(next).toEqual({ ...prev, on: true, updatedAt: 99 })
  })
  it('efface un champ optionnel avec `null`, sans bruit inutile', () => {
    // Seul moyen de repasser une valeur a « inconnue » : rappeler la position favorite d'un moteur
    // unidirectionnel le deplace vers une position qu'on ne connait pas.
    const cover: StateFor<'cover'> = { kind: 'cover', updatedAt: 1, available: true, position: 40, motion: 'stopped' }
    const cleared = mergeState(cover, { position: null }, 99)
    expect('position' in cleared).toBe(false)
    expect(cleared).toEqual({ kind: 'cover', updatedAt: 99, available: true, motion: 'stopped' })
    // effacer ce qui est deja absent ne change rien : meme reference, donc rien sur le WebSocket
    expect(mergeState(cleared, { position: null }, 123)).toBe(cleared)
  })
  it('compares nested objects structurally', () => {
    const withColor = { ...prev, color: { x: 0.3, y: 0.3 } }
    expect(mergeState(withColor, { color: { x: 0.3, y: 0.3 } }, 5)).toBe(withColor)
    expect(mergeState(withColor, { color: { x: 0.4, y: 0.3 } }, 5).color).toEqual({ x: 0.4, y: 0.3 })
  })
  it('ignores undefined patch values', () => {
    expect(mergeState(prev, { brightness: undefined }, 5)).toBe(prev)
  })
})

describe('defaultState', () => {
  it('produces a valid, unavailable state for every kind', () => {
    for (const kind of DEVICE_KINDS) {
      const s = defaultState(kind, 7)
      expect(deviceStateSchema.parse(s)).toEqual(s)
      expect(s.available).toBe(false)
      expect(s.updatedAt).toBe(7)
      expect(KIND_CAPABILITIES[kind].length).toBeGreaterThan(0)
    }
  })

  it('ne pose AUCUNE position pour un ouvrant', () => {
    // Un `position: 0` par défaut se lit comme un fait : une radio unidirectionnelle n'en publie
    // jamais, et l'interface annonçait « fermé » (compteurs du résumé compris) sans rien savoir.
    const s = defaultState('cover')
    expect(s.kind === 'cover' && s.position).toBeUndefined()
    expect(deviceStateSchema.parse(s)).toEqual(s)
  })
})

/**
 * Aucun fabricant ne donne la capacité de la batterie, et certains (la R5) ne donnent pas non plus
 * la puissance de charge : elle se déduit de ce que la voiture annonce — 6 points à mettre sur
 * 52 kWh en 43 min ≈ 4,4 kW — ou pas du tout.
 */
describe('estimateChargePowerW', () => {
  const charging = (extra: Partial<StateFor<'vehicle'>> = {}): StateFor<'vehicle'> => ({
    kind: 'vehicle', updatedAt: 1, available: true, soc: 74, rangeKm: 276, pluggedIn: true, charging: true,
    chargeLimit: 80, chargeMinutesRemaining: 43, ...extra,
  })

  it('déduit la puissance du temps que la voiture se donne', () => {
    expect(estimateChargePowerW(charging(), 52)).toBe(4400)
    expect(estimateChargePowerW(charging(), 40)).toBe(3300)
  })

  it('se tait quand il n’y a rien à estimer', () => {
    expect(estimateChargePowerW(charging(), undefined)).toBeUndefined()          // capacité jamais saisie
    expect(estimateChargePowerW(charging({ chargePowerW: 7000 }), 52)).toBeUndefined()  // le véhicule la DIT
    expect(estimateChargePowerW(charging({ charging: false }), 52)).toBeUndefined()
    expect(estimateChargePowerW(charging({ chargeLimit: undefined }), 52)).toBeUndefined()
    expect(estimateChargePowerW(charging({ chargeMinutesRemaining: undefined }), 52)).toBeUndefined()
  })

  it('se tait aussi quand le calcul mentirait', () => {
    // fin de charge : le courant s'effondre sur les derniers pourcents, une minute d'erreur y pèse trop
    expect(estimateChargePowerW(charging({ soc: 79 }), 52)).toBeUndefined()
    expect(estimateChargePowerW(charging({ chargeMinutesRemaining: 3 }), 52)).toBeUndefined()
    // 60 points en 5 min feraient 374 kW sur une voiture branchée au garage : invraisemblable
    expect(estimateChargePowerW(charging({ soc: 20, chargeMinutesRemaining: 5 }), 52)).toBeUndefined()
  })
})

describe('weather kind', () => {
  it('has a complete default state that the schema accepts', () => {
    expect(deviceStateSchema.safeParse(defaultState('weather', 1)).success).toBe(true)
  })
  it('accepts a full observation and rejects a foreign condition', () => {
    const state: StateFor<'weather'> = {
      kind: 'weather', updatedAt: 1, available: true, condition: 'rain', tempC: 12.4, feelsLikeC: 10.1, humidity: 88,
      pressureHpa: 1008, windKmh: 22, windGustKmh: 41, windDirDeg: 250, cloudCover: 95, precipMm: 1.2, precipProbability: 80,
      visibilityM: 6000, uvIndex: 1, isDay: true, sunrise: 1, sunset: 2, aqi: 32, aqiLevel: 'fair', pollen: { grass: 2 }, observedAt: 1,
    }
    expect(deviceStateSchema.safeParse(state).success).toBe(true)
    expect(deviceStateSchema.safeParse({ ...state, condition: 'hail' }).success).toBe(false)
  })
  it('only allows its own capabilities', () => {
    const d: DeviceDescriptor = { id: 'open_meteo:home', pluginId: 'open_meteo', externalId: 'home', kind: 'weather', name: 'Météo',
      capabilities: ['forecast', 'air_quality', 'pollen'], meta: { weather: { attribution: 'Open-Meteo' } } }
    expect(deviceDescriptorSchema.safeParse(d).success).toBe(true)
    expect(deviceDescriptorSchema.safeParse({ ...d, capabilities: ['measure'] }).success).toBe(false)
  })
})
