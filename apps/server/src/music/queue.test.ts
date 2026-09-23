import { describe, expect, it } from 'vitest'
import { afterEnd, insert, jumpTo, removeAt, upcoming, type PlayQueue } from './queue'

const q = (index: number, repeat: PlayQueue['repeat'] = 'off', n = 3): PlayQueue => ({
  items: Array.from({ length: n }, (_, i) => ({ source: 'ytmusic', id: `v${i}` })),
  index,
  repeat,
})

describe('ytmusic play queue', () => {
  it('moves on at the end of a track, and stops after the last one', () => {
    expect(afterEnd(q(0))).toEqual({ index: 1, repeat: 'off' })
    expect(afterEnd(q(2))).toBeNull()
  })

  it('replays the track once, then carries on; loops it for good', () => {
    expect(afterEnd(q(1, 'once'))).toEqual({ index: 1, repeat: 'off' })
    expect(afterEnd(q(2, 'once'))).toEqual({ index: 2, repeat: 'off' })
    expect(afterEnd(q(2, 'loop'))).toEqual({ index: 2, repeat: 'loop' })
  })

  it('prepares the next different track only', () => {
    expect(upcoming(q(0))?.id).toBe('v1')
    expect(upcoming(q(0, 'loop'))).toBeNull()
    expect(upcoming(q(2))).toBeNull()
  })

  it('drops a pending single repeat when jumping, keeps the loop', () => {
    expect(jumpTo(q(0, 'once'), 2)).toEqual({ index: 2, repeat: 'off' })
    expect(jumpTo(q(0, 'loop'), 1)).toEqual({ index: 1, repeat: 'loop' })
    expect(jumpTo(q(0), 3)).toBeNull()
    expect(jumpTo(q(0), -1)).toBeNull()
  })

  it('inserts after the current track or at the end', () => {
    expect(insert(q(0), [{ source: 'ytmusic', id: 'x' }], 'next').items.map((t) => t.id)).toEqual(['v0', 'x', 'v1', 'v2'])
    expect(insert(q(0), [{ source: 'ytmusic', id: 'x' }], 'end').items.map((t) => t.id)).toEqual(['v0', 'v1', 'v2', 'x'])
  })

  it('removes a waiting track and keeps pointing at the current one', () => {
    const r = removeAt(q(2), 0)!
    expect(r.items.map((t) => t.id)).toEqual(['v1', 'v2'])
    expect(r.index).toBe(1)
    expect(removeAt(q(2), 2)).toBeNull()
  })
})
