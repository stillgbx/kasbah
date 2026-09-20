import { describe, expect, it } from 'vitest'
import { hasRequiredCookie, toNetscape } from './cookie'
import { healthFrom } from './index'
import { mapPlaylist, mapTrack, mapTracks } from './mapping'

describe('ytmusic cookie', () => {
  it('requires __Secure-3PAPISID', () => {
    expect(hasRequiredCookie('a=1; b=2')).toBe(false)
    expect(hasRequiredCookie('__Secure-3PAPISID=xyz; other=1')).toBe(true)
  })

  it('converts to Netscape without logging values in the format itself', () => {
    const n = toNetscape('__Secure-3PAPISID=secret; VISITOR_INFO1_LIVE=abc')
    expect(n).toContain('# Netscape HTTP Cookie File')
    expect(n).toContain('.youtube.com\tTRUE\t/\tTRUE\t0\t__Secure-3PAPISID\tsecret')
    expect(n).toContain('VISITOR_INFO1_LIVE\tabc')
  })
})

describe('ytmusic mapping', () => {
  it('maps a song fixture', () => {
    expect(mapTrack({
      videoId: 'abc123',
      title: 'Terracotta',
      artists: [{ name: 'Artist' }, 'Feat'],
      artUrl: 'https://i.ytimg.com/x.jpg',
      durationS: 187,
      album: { name: 'EP' },
    })).toEqual({
      videoId: 'abc123',
      title: 'Terracotta',
      artists: ['Artist', 'Feat'],
      artUrl: 'https://i.ytimg.com/x.jpg',
      durationS: 187,
      album: 'EP',
    })
  })

  it('drops tracks without id', () => {
    expect(mapTracks([{ title: 'no id' }, { id: 'x', title: 'ok' }])).toEqual([
      { videoId: 'x', title: 'ok', artists: [], artUrl: null, durationS: null, album: null },
    ])
  })

  it('maps a playlist fixture', () => {
    expect(mapPlaylist({ id: 'PL1', title: 'Soirée', item_count: '12 titres', thumbnail: 'https://i.ytimg.com/p.jpg' })).toEqual({
      id: 'PL1',
      title: 'Soirée',
      artUrl: 'https://i.ytimg.com/p.jpg',
      trackCount: 12,
    })
  })
})

describe('ytmusic health', () => {
  const keys = ['YTM_COOKIE_FILE']
  it('needs pairing without cookie', () => {
    expect(healthFrom(false, true, null, keys).status).toBe('needs_pairing')
  })
  it('degrades when PO Token is down', () => {
    expect(healthFrom(true, false, null, keys).status).toBe('degraded')
  })
  it('is ok when linked and PO reachable', () => {
    expect(healthFrom(true, true, null, keys)).toMatchObject({ status: 'ok' })
  })
})
