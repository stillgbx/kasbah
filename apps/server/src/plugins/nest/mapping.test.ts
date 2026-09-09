import { deviceDescriptorSchema } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import { DOORBELL, NAMED_CAMERA, THERMOSTAT, UNNAMED_CAMERA, WEBRTC_CAMERA } from './__fixtures__/sdm'
import { authorizationUrl, deviceNameToExternalId, isCamera, streamProtocols, toDescriptor } from './mapping'
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

  it('an empty customName (the common case) falls back to "<room> <type>"', () => {
    const d = toDescriptor(parse(UNNAMED_CAMERA))
    expect(d.name).toBe('Garage Camera')
    expect(d.capabilities).toEqual(['live_stream'])
    expect(d.meta.camera).toEqual({ deviceClass: 'camera', protocols: ['rtsp'] })
  })

  it('prefers the custom name when present', () => {
    expect(toDescriptor(parse(NAMED_CAMERA)).name).toBe('Caméra Salon')
  })

  it('maps WEB_RTC to webrtc, and a display to class display', () => {
    expect(toDescriptor(parse(WEBRTC_CAMERA)).meta.camera).toEqual({ deviceClass: 'camera', protocols: ['webrtc'] })
    const display = parse({ ...UNNAMED_CAMERA, type: 'sdm.devices.types.DISPLAY' })
    expect(toDescriptor(display)).toMatchObject({ name: 'Garage Display', meta: { camera: { deviceClass: 'display' } } })
  })

  it('ignores unknown protocols and duplicates, tolerates a missing trait', () => {
    const d = parse({ ...DOORBELL, traits: { 'sdm.devices.traits.CameraLiveStream': { supportedProtocols: ['RTSP', 'RTSP', 'HLS'] } } })
    expect(streamProtocols(d)).toEqual(['rtsp'])
    const bare = parse({ name: 'enterprises/p/devices/x', type: 'sdm.devices.types.CAMERA' })
    expect(streamProtocols(bare)).toEqual([])
    const bareDescriptor = toDescriptor(bare)
    expect(bareDescriptor.name).toBe('Camera')
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
