import { describe, expect, it, vi } from 'vitest'
import { BRAVIA_FORBIDDEN, BRAVIA_INPUTS_ARC_SOUNDBAR, BRAVIA_SOUND_AUDIO_SYSTEM, BRAVIA_SOUND_SPEAKER } from './__fixtures__/bravia'
import { isBravia, parseArcDeviceName, parseSoundOutput, probeBravia, type BraviaFetch } from './bravia'

describe('bravia (sortie son d une TV Sony)', () => {
  it('reconnaît une BRAVIA à son modèle mDNS, et rien d autre', () => {
    expect(isBravia('BRAVIA 4K VH22')).toBe(true)
    expect(isBravia('BRAVIA 4K 2015')).toBe(true)
    expect(isBravia('Chromecast')).toBe(false)
    expect(isBravia('Flexus Core 300')).toBe(false)
    expect(isBravia(undefined)).toBe(false)
  })

  it('lit où part le son (capture réelle), et ne devine rien sur une réponse d erreur', () => {
    expect(parseSoundOutput(BRAVIA_SOUND_AUDIO_SYSTEM)).toBe('external')
    expect(parseSoundOutput(BRAVIA_SOUND_SPEAKER)).toBe('internal')
    expect(parseSoundOutput({ result: [[{ target: 'outputTerminal', currentValue: 'speaker_hdmi' }]] })).toBe('both')
    expect(parseSoundOutput({ result: [[{ target: 'outputTerminal', currentValue: 'bluetooth?' }]] })).toBeUndefined()
    expect(parseSoundOutput(BRAVIA_FORBIDDEN)).toBeUndefined()
  })

  it('nomme l appareil branché sur l entrée ARC par son nom CEC, à défaut par l étiquette de l entrée', () => {
    expect(parseArcDeviceName(BRAVIA_INPUTS_ARC_SOUNDBAR)).toBe('Flexus 300')
    // sans appareil CEC déclaré sur ce port : l'étiquette de l'entrée, sans son espace final
    const noCec = { result: [[...BRAVIA_INPUTS_ARC_SOUNDBAR.result[0]!.filter((i) => !i.uri.startsWith('extInput:cec'))]] }
    expect(parseArcDeviceName(noCec)).toBe('Barre de son')
    // entrée ARC débranchée : rien
    const off = { result: [[...BRAVIA_INPUTS_ARC_SOUNDBAR.result[0]!.map((i) => (i.uri === 'extInput:hdmi?port=3' ? { ...i, connection: false } : i))]] }
    expect(parseArcDeviceName(off)).toBeUndefined()
    expect(parseArcDeviceName(BRAVIA_FORBIDDEN)).toBeUndefined()
  })

  it('sonde en deux requêtes, la seconde seulement si le son sort de la TV', async () => {
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
    expect(fetchImpl).toHaveBeenCalledTimes(3)                       // pas besoin des entrées

    // TV éteinte ou API fermée : erreur, pas de valeur inventée
    const down: BraviaFetch = async () => { throw new Error('ECONNREFUSED') }
    await expect(probeBravia('192.168.1.87', down)).rejects.toThrow('ECONNREFUSED')
    const forbidden: BraviaFetch = async () => ({ ok: true, status: 200, json: async () => BRAVIA_FORBIDDEN })
    expect(await probeBravia('192.168.1.87', forbidden)).toBeUndefined()
  })
})
