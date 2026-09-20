import { describe, expect, it } from 'vitest'
import { fromNetscape, hasRequiredCookie, toNetscape } from './cookie'
import { isAuthError } from './browserCookies'
import { healthFrom } from './index'
import { mapPlaylist, mapTrack, mapTracks, upgradeArtUrl } from './mapping'

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

  it('round-trips Netscape to Cookie header', () => {
    const n = toNetscape('__Secure-3PAPISID=secret; VISITOR_INFO1_LIVE=abc')
    expect(fromNetscape(n)).toContain('__Secure-3PAPISID=secret')
    expect(fromNetscape(n)).toContain('VISITOR_INFO1_LIVE=abc')
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

  it('upgrades googleusercontent thumbs to 544px', () => {
    expect(upgradeArtUrl('https://yt3.googleusercontent.com/abc=w60-h60-l90-rj')).toBe(
      'https://yt3.googleusercontent.com/abc=w544-h544-l90-rj',
    )
    expect(upgradeArtUrl('//lh3.googleusercontent.com/xyz')).toBe(
      'https://lh3.googleusercontent.com/xyz=w544-h544-l90-rj',
    )
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
    expect(healthFrom(false, false, true, null, keys).status).toBe('needs_pairing')
  })
  it('needs pairing when cookie expired', () => {
    expect(healthFrom(true, true, true, null, keys)).toMatchObject({
      status: 'needs_pairing',
      detail: expect.stringContaining('expired'),
    })
  })
  it('degrades when PO Token is down', () => {
    expect(healthFrom(true, false, false, null, keys).status).toBe('degraded')
  })
  it('is ok when linked and PO reachable', () => {
    expect(healthFrom(true, false, true, null, keys)).toMatchObject({ status: 'ok' })
  })
})

describe('ytmusic auth errors', () => {
  it('detects typical auth failures', () => {
    expect(isAuthError(new Error('HTTP 401 Unauthorized'))).toBe(true)
    expect(isAuthError(new Error('login_required'))).toBe(true)
    expect(isAuthError(new Error('format not available'))).toBe(false)
  })
})

describe('ytmusic browser import errors', () => {
  it('explains Chrome cookie DB lock', async () => {
    const { browserImportFailureMessage } = await import('./browserCookies')
    const msg = browserImportFailureMessage(
      'chrome',
      'ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info\n'
      + 'ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info\n',
    )
    expect(msg).toMatch(/quit chrome completely/i)
    expect(msg).toMatch(/paste the cookie manually/i)
    expect(msg).not.toMatch(/7271/)
  })

  it('explains Windows DPAPI / App-Bound Encryption', async () => {
    const { browserImportFailureMessage } = await import('./browserCookies')
    const msg = browserImportFailureMessage(
      'chrome',
      'ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927 for more info\n',
    )
    expect(msg).toMatch(/paste the Cookie header/i)
    expect(msg).toMatch(/firefox/i)
    expect(msg).not.toMatch(/10927/)
  })
})
