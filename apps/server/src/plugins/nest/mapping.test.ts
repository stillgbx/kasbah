import { deviceDescriptorSchema } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import { DOORBELL, NAMED_CAMERA, THERMOSTAT, UNNAMED_CAMERA, WEBRTC_CAMERA } from './__fixtures__/sdm'
import {
  authorizationUrl, deviceNameToExternalId, isCamera, streamProtocols, thermostatAvailable, toClimatePatch, toDescriptor,
  toThermostatCommands, toThermostatDescriptor,
} from './mapping'
import { sdmDeviceSchema } from './types'

const parse = (d: unknown) => sdmDeviceSchema.parse(d)

describe('nest mapping', () => {
  it('keeps only cameras and doorbells (a thermostat is not a camera)', () => {
    expect([DOORBELL, UNNAMED_CAMERA, NAMED_CAMERA, WEBRTC_CAMERA, THERMOSTAT].map((d) => isCamera(parse(d)))).toEqual([true, true, true, true, false])
  })

  it('derives a stable external id from the resource name', () => {
    expect(deviceNameToExternalId(DOORBELL.name)).toBe('DEVICE2')
    expect(deviceNameToExternalId('bare')).toBe('bare')
  })

  it('maps the real doorbell: custom name, room as meta.room, chime + live stream, RTSP', () => {
    const d = toDescriptor(parse(DOORBELL))
    expect(deviceDescriptorSchema.safeParse(d).success).toBe(true)
    expect(d).toMatchObject({
      id: 'nest:DEVICE2', kind: 'camera', name: "Porte d'entrée",
      capabilities: ['live_stream', 'chime'],
      meta: { manufacturer: 'Google Nest', model: 'DOORBELL', room: 'Entrée', camera: { deviceClass: 'doorbell', protocols: ['rtsp'] } },
    })
  })

  it('an empty customName (the common case) falls back to "<type> <room>", type first as the house names its devices', () => {
    const d = toDescriptor(parse(UNNAMED_CAMERA))
    expect(d.name).toBe('Caméra Garage')
    expect(d.capabilities).toEqual(['live_stream'])
    expect(d.meta.camera).toEqual({ deviceClass: 'camera', protocols: ['rtsp'] })
  })

  it('prefers the custom name when present', () => {
    expect(toDescriptor(parse(NAMED_CAMERA)).name).toBe('Caméra Salon')
  })

  it('maps WEB_RTC to webrtc, and a display to class display', () => {
    expect(toDescriptor(parse(WEBRTC_CAMERA)).meta.camera).toEqual({ deviceClass: 'camera', protocols: ['webrtc'] })
    const display = parse({ ...UNNAMED_CAMERA, type: 'sdm.devices.types.DISPLAY' })
    expect(toDescriptor(display)).toMatchObject({ name: 'Écran Garage', meta: { camera: { deviceClass: 'display' } } })
  })

  it('ignores unknown protocols and duplicates, tolerates a missing trait', () => {
    const d = parse({ ...DOORBELL, traits: { 'sdm.devices.traits.CameraLiveStream': { supportedProtocols: ['RTSP', 'RTSP', 'HLS'] } } })
    expect(streamProtocols(d)).toEqual(['rtsp'])
    const bare = parse({ name: 'enterprises/p/devices/x', type: 'sdm.devices.types.CAMERA' })
    expect(streamProtocols(bare)).toEqual([])
    const bareDescriptor = toDescriptor(bare)
    expect(bareDescriptor.name).toBe('Caméra')
    expect(bareDescriptor.capabilities).toEqual([])
    expect(bareDescriptor.meta.camera).toEqual({ deviceClass: 'camera' })
  })

  it('builds the Partner Connections URL with offline access and consent', () => {
    const url = new URL(authorizationUrl({ projectId: 'proj-1', clientId: 'cid', redirectUri: 'http://localhost:8787/cb', state: 'xyz' }))
    expect(url.origin + url.pathname).toBe('https://nestservices.google.com/partnerconnections/proj-1/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'cid', redirect_uri: 'http://localhost:8787/cb', response_type: 'code', access_type: 'offline', prompt: 'consent', state: 'xyz',
    })
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/sdm.service')
  })
})

describe('nest thermostat mapping', () => {
  const thermostat = () => parse(THERMOSTAT)
  const withTraits = (patch: Record<string, unknown>) => parse({ ...THERMOSTAT, traits: { ...THERMOSTAT.traits, ...patch } })

  it('maps the real thermostat: climate kind, declared modes only, Google setpoint range', () => {
    const d = toThermostatDescriptor(thermostat())
    expect(deviceDescriptorSchema.safeParse(d).success).toBe(true)
    expect(d).toMatchObject({
      id: 'nest:DEVICE3', kind: 'climate', name: 'Thermostat Palier',
      capabilities: ['hvac_mode', 'target_temp', 'current_temp', 'humidity'],
      meta: { manufacturer: 'Google Nest', model: 'THERMOSTAT', room: 'Palier', targetTempC: [9, 32], climate: { modes: ['heat', 'off', 'eco'] } },
    })
  })

  it('reads a full climate state, rounded to a tenth, idle when HEAT but not heating', () => {
    expect(toClimatePatch(thermostat())).toEqual({ mode: 'heat', action: 'idle', currentTempC: 24.2, targetTempC: 18.8, humidity: 53 })
    expect(thermostatAvailable(thermostat())).toBe(true)
    expect(thermostatAvailable(withTraits({ 'sdm.devices.traits.Connectivity': { status: 'OFFLINE' } }))).toBe(false)
  })

  it('eco overrides the HVAC mode and brings its own setpoint; OFF means off; HEATING means heating', () => {
    const eco = withTraits({ 'sdm.devices.traits.ThermostatEco': { ...THERMOSTAT.traits['sdm.devices.traits.ThermostatEco'], mode: 'MANUAL_ECO' } })
    expect(toClimatePatch(eco)).toMatchObject({ mode: 'eco', action: 'idle', targetTempC: 13.9 })
    // the real Google: when off, the setpoint trait arrives EMPTY. We return the last setpoint seen
    // while heating, and the ambient only for lack of better (server restarted while off).
    const off = withTraits({
      'sdm.devices.traits.ThermostatMode': { mode: 'OFF', availableModes: ['HEAT', 'OFF'] },
      'sdm.devices.traits.ThermostatTemperatureSetpoint': {},
    })
    expect(toClimatePatch(off, 20)).toMatchObject({ mode: 'off', action: 'off', targetTempC: 20 })
    expect(toClimatePatch(off)).toMatchObject({ mode: 'off', targetTempC: 24.2 })
    const heating = withTraits({ 'sdm.devices.traits.ThermostatHvac': { status: 'HEATING' } })
    expect(toClimatePatch(heating)).toMatchObject({ mode: 'heat', action: 'heating' })
    // without an ambient temperature there is no state to publish (the contract requires it)
    expect(toClimatePatch(withTraits({ 'sdm.devices.traits.Temperature': {} }))).toBeUndefined()
  })

  it('translates commands, refuses what the thermostat cannot do in its current state', () => {
    expect(toThermostatCommands(thermostat(), { type: 'climate.set_target_temp', targetTempC: 21.26 }))
      .toEqual([{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat', params: { heatCelsius: 21.3 } }])
    expect(toThermostatCommands(thermostat(), { type: 'climate.set_target_temp', targetTempC: 40 })![0]!.params).toEqual({ heatCelsius: 32 })
    expect(toThermostatCommands(thermostat(), { type: 'climate.set_mode', mode: 'off' }))
      .toEqual([{ command: 'sdm.devices.commands.ThermostatMode.SetMode', params: { mode: 'OFF' } }])
    expect(toThermostatCommands(thermostat(), { type: 'climate.set_mode', mode: 'eco' }))
      .toEqual([{ command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'MANUAL_ECO' } }])
    // this thermostat does not cool
    expect(toThermostatCommands(thermostat(), { type: 'climate.set_mode', mode: 'cool' })).toBeUndefined()
    // in eco: no setpoint, and leaving eco for HEAT takes two commands
    const eco = withTraits({ 'sdm.devices.traits.ThermostatEco': { ...THERMOSTAT.traits['sdm.devices.traits.ThermostatEco'], mode: 'MANUAL_ECO' } })
    expect(toThermostatCommands(eco, { type: 'climate.set_target_temp', targetTempC: 20 })).toBeUndefined()
    expect(toThermostatCommands(eco, { type: 'climate.set_mode', mode: 'heat' })).toEqual([
      { command: 'sdm.devices.commands.ThermostatEco.SetMode', params: { mode: 'OFF' } },
      { command: 'sdm.devices.commands.ThermostatMode.SetMode', params: { mode: 'HEAT' } },
    ])
    // when off: no setpoint either; in HEATCOOL the cooling setpoint keeps its gap
    const off = withTraits({ 'sdm.devices.traits.ThermostatMode': { mode: 'OFF', availableModes: ['HEAT', 'OFF'] } })
    expect(toThermostatCommands(off, { type: 'climate.set_target_temp', targetTempC: 20 })).toBeUndefined()
    const range = withTraits({
      'sdm.devices.traits.ThermostatMode': { mode: 'HEATCOOL', availableModes: ['HEAT', 'COOL', 'HEATCOOL', 'OFF'] },
      'sdm.devices.traits.ThermostatTemperatureSetpoint': { heatCelsius: 18, coolCelsius: 26 },
    })
    expect(toThermostatCommands(range, { type: 'climate.set_target_temp', targetTempC: 25 }))
      .toEqual([{ command: 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange', params: { heatCelsius: 25, coolCelsius: 27 } }])
    expect(toThermostatCommands(thermostat(), { type: 'light.set', on: true })).toBeUndefined()
  })
})
