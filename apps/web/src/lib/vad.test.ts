import { describe, expect, it } from 'vitest'
import { createEndpointer, NO_SPEECH_MS, rms, SILENCE_MS } from './vad'

// La fin de la phrase devinée au niveau sonore : des niveaux inventés, une trame toutes les 50 ms.

const FRAME = 50

/** Joue une suite de `[niveau, durée en ms]` et rend le premier événement, avec son instant. */
function play(...parts: [level: number, ms: number][]) {
  const vad = createEndpointer()
  let at = 0
  for (const [level, ms] of parts) {
    for (let end = at + ms; at < end; at += FRAME) {
      const event = vad.push(level, at)
      if (event) return { event, at }
    }
  }
  return null
}

describe('createEndpointer', () => {
  it('parole puis silence : envoie après le silence voulu, pas avant', () => {
    const r = play([0.002, 300], [0.1, 1500], [0.002, 3000])
    expect(r?.event).toBe('end')
    expect(r!.at - 1800).toBe(SILENCE_MS)
  })

  it('une hésitation plus courte que le silence voulu ne coupe pas la phrase', () => {
    const r = play([0.002, 300], [0.1, 800], [0.002, SILENCE_MS - 200], [0.1, 800], [0.002, 3000])
    expect(r?.event).toBe('end')
    expect(r!.at).toBeGreaterThan(300 + 800 + SILENCE_MS - 200 + 800)
  })

  it('personne ne parle : rien entendu au bout du délai', () => {
    expect(play([0.002, 10_000])).toEqual({ event: 'nothing', at: NO_SPEECH_MS })
  })

  it('un bruit bref (porte, claquement) ne compte pas comme parole', () => {
    expect(play([0.002, 300], [0.3, 100], [0.002, 10_000])?.event).toBe('nothing')
  })

  it('une musique de fond constante devient le plancher : la voix s\'en détache, la fin se voit', () => {
    const r = play([0.03, 1000], [0.2, 1500], [0.03, 3000])
    expect(r?.event).toBe('end')
    expect(r!.at - 2500).toBe(SILENCE_MS)
  })

  it('une parole dès le premier instant est entendue (le plancher redescend au premier blanc)', () => {
    const r = play([0.1, 600], [0.003, 100], [0.1, 800], [0.003, 3000])
    expect(r?.event).toBe('end')
  })

  it('les trames nulles du micro qui s\'ouvre ne faussent pas le plancher', () => {
    const r = play([0, 200], [0.02, 500], [0.15, 1000], [0.02, 3000])
    expect(r?.event).toBe('end')
  })

  it('rien après le premier événement', () => {
    const vad = createEndpointer()
    let at = 0
    for (; at <= NO_SPEECH_MS; at += FRAME) vad.push(0.002, at)
    expect(vad.push(0.5, at)).toBeNull()
  })
})

describe('rms', () => {
  it('niveau efficace d\'une trame', () => {
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5)
    expect(rms(new Float32Array(0))).toBe(0)
  })
})
