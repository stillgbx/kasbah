import { describe, expect, it } from 'vitest'
import { StreamProxy } from './stream'

// Décalage servi à chaque `GET /stream` d'une même session : lancement, sonde du Sonos, reprise
// après transfert, reconnexion pendant la lecture, reprise après pause. Horloge manuelle.

function proxy() {
  let t = 1_000_000
  const p = new StreamProxy({ ffmpegPath: 'ffmpeg', now: () => t })
  return { p, tick: (ms: number) => { t += ms } }
}
const LEAD = 1.1

describe('StreamProxy.startFor', () => {
  it('serves the probe at the same offset, then continues while the connection stays open', () => {
    const { p, tick } = proxy()
    const s = p.open('vid', 'dev', 'http://src')
    expect(p.startFor(s, LEAD)).toEqual({ startS: 0, why: 'start' })
    // la sonde se referme aussitôt, la vraie lecture arrive 300 ms plus tard : même décalage
    p.noteClosed(s, s.servedAt!, LEAD)
    tick(300)
    expect(p.startFor(s, LEAD)).toEqual({ startS: 0, why: 'probe' })
    // le lecteur redemande le flux 10 s plus tard SANS avoir fermé : il en est à 10 s
    tick(10_000)
    expect(p.startFor(s, LEAD)).toEqual({ startS: 10, why: 'reconnect' })
  })

  it('resumes a paused stream where it was heard when the connection closed', () => {
    const { p, tick } = proxy()
    const s = p.open('vid', 'dev', 'http://src', { startS: 40, resumeAt: 1_000_000 })
    tick(500)
    // reprise après transfert : position + délai de commande + avance de tampon
    expect(p.startFor(s, LEAD).startS).toBeCloseTo(40.5 + LEAD, 6)
    const servedAt = s.servedAt!
    // écoute pendant 20 s, puis le Sonos arrête (pause) : le premier son était venu LEAD après le service
    tick(20_000)
    p.noteClosed(s, servedAt, LEAD)
    expect(s.playedS).toBeCloseTo(40.5 + LEAD + 20 - LEAD, 6)
    // reprise deux minutes plus tard : là où l'écoute en était, pas deux minutes plus loin
    tick(120_000)
    expect(p.startFor(s, LEAD)).toEqual({ startS: expect.closeTo(60.5, 6), why: 'reconnect' })
    expect(s.playedS).toBeUndefined()
    // le Sonos a reposé l'URI : sonde refermée aussitôt, puis la vraie lecture, toujours à 60,5
    p.noteClosed(s, s.servedAt!, LEAD)
    tick(300)
    expect(p.startFor(s, LEAD)).toEqual({ startS: expect.closeTo(60.5, 6), why: 'probe' })
  })

  it('ignores the close of an older connection (the probe closing after the real request)', () => {
    const { p, tick } = proxy()
    const s = p.open('vid', 'dev', 'http://src')
    p.startFor(s, LEAD)
    const probeServedAt = s.servedAt!
    tick(300)
    p.startFor(s, LEAD)               // la vraie lecture
    tick(100)
    p.noteClosed(s, probeServedAt, LEAD)   // la sonde se ferme ensuite
    expect(s.playedS).toBeUndefined()
  })
})
