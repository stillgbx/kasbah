import { describe, expect, it } from 'vitest'
import states from './__fixtures__/states.json'
import { artUrlOf, candidatesOf, duplicateOf, isShown, toPatch, toServiceCall, type HaEntityEntry, type HaState, type SelectOptions } from './mapping'

// Fixture: the shape of states captured on a real installation (2026-10), names and values replaced
// by neutral ones. The registries are reduced to what matters (areas, links, integrations).
const all = states as HaState[]
const byId = (id: string) => all.find((s) => s.entity_id === id)!

const entities: HaEntityEntry[] = [
  { entity_id: 'light.lampe_1', area_id: 'salon', platform: 'hue' },
  { entity_id: 'light.chevet_chambre_2', area_id: 'chambre', platform: 'hue', disabled_by: 'user' },
  { entity_id: 'light.camera_1_led', platform: 'reolink', entity_category: 'config' },
  { entity_id: 'cover.volet_1', device_id: 'dev-volet', platform: 'overkiz' },
  { entity_id: 'cover.volet_1_low_speed', device_id: 'dev-volet', platform: 'overkiz' },
  { entity_id: 'cover.volets_groupe', platform: 'group' },
  { entity_id: 'climate.radiateur_1', area_id: 'bureau', platform: 'overkiz' },
  { entity_id: 'climate.poele', area_id: 'salon', platform: 'mqtt' },
  { entity_id: 'sensor.capteur_1_temperature', area_id: 'bureau', platform: 'zha' },
  { entity_id: 'sensor.capteur_1_battery', area_id: 'bureau', platform: 'zha' },
  { entity_id: 'media_player.tv_1', area_id: 'salon', platform: 'dlna_dmr' },
  { entity_id: 'media_player.enceinte_1', area_id: 'salon', platform: 'cast' },
]
const devices = [{ id: 'dev-volet', area_id: 'salon', manufacturer: 'Somfy', model: 'io' }]
const areas = [{ area_id: 'salon', name: 'Salon' }, { area_id: 'bureau', name: 'Bureau' }, { area_id: 'chambre', name: 'Chambre 2' }]
const opts: SelectOptions = {
  pluginId: 'home_assistant', domains: ['light', 'cover', 'climate', 'sensor', 'media_player'],
  sensorClasses: ['temperature', 'humidity'], slowSuffix: '_low_speed',
}
const found = candidatesOf(all, entities, devices, areas, opts)
const get = (id: string) => found.find((t) => t.externalId === id)

describe('candidatesOf', () => {
  it('keeps what Kasbah can translate, drops disabled, config and unwanted sensor classes', () => {
    expect(found.map((t) => t.externalId).sort()).toEqual([
      'climate.poele', 'climate.radiateur_1', 'cover.volet_1', 'cover.volets_groupe', 'light.lampe_1',
      'media_player.enceinte_1', 'media_player.tv_1', 'sensor.capteur_1_temperature',
    ])
  })

  it('absorbs the slow-speed twin as the quiet mode, room taken from the device', () => {
    const v = get('cover.volet_1')!
    expect(v.slowEntityId).toBe('cover.volet_1_low_speed')
    expect(v.integration).toBe('overkiz')
    expect(v.descriptor.capabilities).toEqual(expect.arrayContaining(['open_close', 'position', 'stop', 'quiet']))
    expect(v.descriptor.meta.room).toBe('Salon')
    expect(v.descriptor.meta.cover?.deviceClass).toBe('shutter')
  })

  it('marks a cover group as a group', () => {
    expect(get('cover.volets_groupe')!.descriptor.meta.isGroup).toBe(true)
    expect(get('cover.volets_groupe')!.slowEntityId).toBeUndefined()
  })

  it('a preset-only radiator offers on/off but no set point; a stove has one', () => {
    const r = get('climate.radiateur_1')!.descriptor
    expect(r.capabilities).toContain('hvac_mode')
    expect(r.capabilities).not.toContain('target_temp')
    expect(r.meta.climate?.modes).toEqual(['heat', 'off'])
    expect(get('climate.poele')!.descriptor.capabilities).toEqual(expect.arrayContaining(['hvac_mode', 'target_temp', 'current_temp']))
  })

  it('a dimmable colour-temperature lamp', () => {
    const l = get('light.lampe_1')!.descriptor
    expect(l.capabilities).toEqual(expect.arrayContaining(['on_off', 'brightness', 'color_temp']))
    expect(l.meta.room).toBe('Salon')
  })

  it('the TV is a tv, the speaker a speaker', () => {
    expect(get('media_player.tv_1')!.descriptor.meta.mediaPlayer?.deviceClass).toBe('tv')
    expect(get('media_player.enceinte_1')!.descriptor.meta.mediaPlayer?.deviceClass).toBe('speaker')
  })
})

describe('selection', () => {
  const lamp = get('light.lampe_1')!
  const tv = get('media_player.tv_1')!

  it('an entity whose integration a Kasbah plugin that is on provides is a duplicate', () => {
    expect(duplicateOf(lamp, ['mock', 'hue'])).toBe('hue')
    expect(duplicateOf(lamp, ['mock'])).toBeUndefined()
    expect(duplicateOf(tv, ['hue', 'google_cast'])).toBeUndefined()
    expect(duplicateOf(get('media_player.enceinte_1')!, ['google_cast'])).toBe('google_cast')
  })

  it('shown by default, except a duplicate; an explicit choice wins either way', () => {
    expect(isShown(tv, {}, [])).toBe(true)
    expect(isShown(lamp, {}, ['hue'])).toBe(false)
    expect(isShown(lamp, { 'light.lampe_1': true }, ['hue'])).toBe(true)
    expect(isShown(tv, { 'media_player.tv_1': false }, [])).toBe(false)
  })
})

describe('toPatch', () => {
  it('a lamp that is on: brightness in %, colour temperature in mirek', () => {
    const p = toPatch('light', byId('light.lampe_1')) as Record<string, unknown>
    expect(p.on).toBe(true)
    expect(p.brightness).toBe(60)
    expect(p.colorTempMirek).toBe(250)
  })

  it('a closed shutter is at 0, stopped, and carries the quiet flag', () => {
    expect(toPatch('cover', byId('cover.volet_1'), true)).toMatchObject({ position: 0, motion: 'stopped', quiet: true })
  })

  it('a temperature sensor carries its value', () => {
    expect(toPatch('sensor', byId('sensor.capteur_1_temperature'))).toMatchObject({ value: 21.5, available: true })
  })

  it('unavailable entities are reported unavailable', () => {
    expect(toPatch('light', { entity_id: 'light.x', state: 'unavailable', attributes: {} })).toMatchObject({ available: false })
  })

  it('a playing speaker: the cover goes through the server, never with the HA token', () => {
    const p = toPatch('media_player', byId('media_player.enceinte_1')) as { playback: string; nowPlaying: { title: string; artUrl: string } }
    expect(p.playback).toBe('playing')
    expect(p.nowPlaying.title).toBe('Titre 1')
    expect(p.nowPlaying.artUrl).toBe('/api/plugins/home_assistant/art/media_player.enceinte_1?v=f00d')
    expect(p.nowPlaying.artUrl).not.toContain('abc123')
  })
})

describe('artUrlOf', () => {
  it('follows the image, not the token HA renews', () => {
    const a = artUrlOf('media_player.x', '/api/media_player_proxy/media_player.x?token=one')
    expect(artUrlOf('media_player.x', '/api/media_player_proxy/media_player.x?token=two')).toBe(a)
    expect(a).not.toContain('one')
    expect(artUrlOf('media_player.x', 'https://img.example.org/a.jpg')).not.toBe(artUrlOf('media_player.x', 'https://img.example.org/b.jpg'))
  })
})

describe('toServiceCall', () => {
  const volet = get('cover.volet_1')!
  it('quiet mode drives the slow-speed twin', () => {
    expect(toServiceCall(volet, { type: 'cover.close' }, true).entityId).toBe('cover.volet_1_low_speed')
    expect(toServiceCall(volet, { type: 'cover.close' }, false).entityId).toBe('cover.volet_1')
    expect(toServiceCall(volet, { type: 'cover.set_position', position: 40 }, true))
      .toEqual({ domain: 'cover', service: 'set_cover_position', data: { position: 40 }, entityId: 'cover.volet_1_low_speed' })
  })

  it('light on with brightness, light off', () => {
    const lamp = get('light.lampe_1')!
    expect(toServiceCall(lamp, { type: 'light.set', on: true, brightness: 50 }, false))
      .toMatchObject({ service: 'turn_on', data: { brightness_pct: 50 } })
    expect(toServiceCall(lamp, { type: 'light.set', on: false }, false)).toMatchObject({ service: 'turn_off' })
  })

  it('volume in % becomes a 0-1 level', () => {
    expect(toServiceCall(get('media_player.tv_1')!, { type: 'media_player.set_volume', volume: 25 }, false).data)
      .toEqual({ volume_level: 0.25 })
  })
})
