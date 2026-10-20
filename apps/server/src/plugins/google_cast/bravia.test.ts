import { describe, expect, it, vi } from 'vitest'
import { BRAVIA_FORBIDDEN, BRAVIA_INPUTS_ARC_SOUNDBAR, BRAVIA_SOUND_AUDIO_SYSTEM, BRAVIA_SOUND_SPEAKER } from './__fixtures__/bravia'
import { isBravia, parseArcDeviceName, parseSoundOutput, probeBravia, type BraviaFetch } from './bravia'

describe('bravia (sound output of a Sony TV)', () => {
  it('recognizes a BRAVIA by its mDNS model, and nothing else', () => {
    expect(isBravia('BRAVIA 4K VH22')).toBe(true)
    expect(isBravia('BRAVIA 4K 2015')).toBe(true)
    expect(isBravia('Chromecast')).toBe(false)
    expect(isBravia('Flexus Core 300')).toBe(false)
    expect(isBravia(undefined)).toBe(false)
  })

  it('reads where the sound goes (real capture), and guesses nothing on an error response', () => {
    expect(parseSoundOutput(BRAVIA_SOUND_AUDIO_SYSTEM)).toBe('external')
    expect(parseSoundOutput(BRAVIA_SOUND_SPEAKER)).toBe('internal')
    expect(parseSoundOutput({ result: [[{ target: 'outputTerminal', currentValue: 'speaker_hdmi' }]] })).toBe('both')
    expect(parseSoundOutput({ result: [[{ target: 'outputTerminal', currentValue: 'bluetooth?' }]] })).toBeUndefined()
    expect(parseSoundOutput(BRAVIA_FORBIDDEN)).toBeUndefined()
  })

  it('names the device plugged into the ARC input by its CEC name, failing that by the input label', () => {
    expect(parseArcDeviceName(BRAVIA_INPUTS_ARC_SOUNDBAR)).toBe('Flexus 300')
    // without a CEC device declared on that port: the input label, without its trailing space
    const noCec = { result: [[...BRAVIA_INPUTS_ARC_SOUNDBAR.result[0]!.filter((i) => !i.uri.startsWith('extInput:cec'))]] }
    expect(parseArcDeviceName(noCec)).toBe('Barre de son')
    // ARC input unplugged: nothing
    const off = { result: [[...BRAVIA_INPUTS_ARC_SOUNDBAR.result[0]!.map((i) => (i.uri === 'extInput:hdmi?port=3' ? { ...i, connection: false } : i))]] }
    expect(parseArcDeviceName(off)).toBeUndefined()
    expect(parseArcDeviceName(BRAVIA_FORBIDDEN)).toBeUndefined()
  })

  it('probes in two requests, the second only if the sound leaves the TV', async () => {
    const replies: Record<string, unknown> = { getSoundSettings: BRAVIA_SOUND_AUDIO_SYSTEM, getCurrentExternalInputsStatus: BRAVIA_INPUTS_ARC_SOUNDBAR }
    const fetchImpl: BraviaFetch = vi.fn(async (url, init) => {
      const { method } = JSON.parse(init.body) as { method: string }
      expect(url).toBe(method === 'getSoundSettings' ? 'http://192.168.1.87/sony/audio' : 'http://192.168.1.87/sony/avContent')
      return { ok: true, status: 200, json: async () => replies[method] }
    })
    expect(await probeBravia('192.168.1.87', fetchImpl)).toEqual({ terminal: 'external', name: 'Flexus 300' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    replies.getSoundSettings = BRAVIA_SOUND_SPEAKER
    expect(await probeBravia('192.168.1.87', fetchImpl)).toEqual({ terminal: 'internal' })
    expect(fetchImpl).toHaveBeenCalledTimes(3)                       // no need for the inputs

    // TV off or API closed: error, no invented value
    const down: BraviaFetch = async () => { throw new Error('ECONNREFUSED') }
    await expect(probeBravia('192.168.1.87', down)).rejects.toThrow('ECONNREFUSED')
    const forbidden: BraviaFetch = async () => ({ ok: true, status: 200, json: async () => BRAVIA_FORBIDDEN })
    expect(await probeBravia('192.168.1.87', forbidden)).toBeUndefined()
  })
})
