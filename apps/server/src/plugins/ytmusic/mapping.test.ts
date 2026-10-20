import { describe, expect, it } from 'vitest'
import { fromNetscape, hasRequiredCookie, toNetscape } from './cookie'
import { isAuthError } from './browserCookies'
import { healthFrom } from './index'
import { mapAlbum, mapArtist, mapPlaylist, mapTrack, mapTracks, parseReleaseType, partitionAlbums, propagateExplicitByTitle, textOf, upgradeArtUrl, bestThumb, ART_PLAY_SIZE } from './mapping'

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
      year: '2021',
    })).toEqual({
      videoId: 'abc123',
      title: 'Terracotta',
      artists: ['Artist', 'Feat'],
      artUrl: 'https://i.ytimg.com/x.jpg',
      durationS: 187,
      album: 'EP',
      year: '2021',
      explicit: false,
    })
  })

  it('upgrades googleusercontent thumbs to catalog size (120px)', () => {
    expect(upgradeArtUrl('https://yt3.googleusercontent.com/abc=w60-h60-l90-rj')).toBe(
      'https://yt3.googleusercontent.com/abc=w120-h120-l90-rj',
    )
    expect(upgradeArtUrl('//lh3.googleusercontent.com/xyz')).toBe(
      'https://lh3.googleusercontent.com/xyz=w120-h120-l90-rj',
    )
  })

  it('upgrades to play size when asked', () => {
    expect(upgradeArtUrl('https://yt3.googleusercontent.com/abc=w60-h60-l90-rj', ART_PLAY_SIZE)).toBe(
      'https://yt3.googleusercontent.com/abc=w544-h544-l90-rj',
    )
  })

  it('picks a lighter ytimg leaf for catalog thumbs', () => {
    expect(upgradeArtUrl('https://i.ytimg.com/vi/x/hqdefault.jpg')).toBe(
      'https://i.ytimg.com/vi/x/default.jpg',
    )
    expect(upgradeArtUrl('https://i.ytimg.com/vi/x/default.jpg', ART_PLAY_SIZE)).toBe(
      'https://i.ytimg.com/vi/x/hqdefault.jpg',
    )
  })

  it('picks the widest thumb from nested MusicThumbnail-like shapes', () => {
    expect(bestThumb([
      { url: 'https://i.ytimg.com/small.jpg', width: 60 },
      { url: 'https://i.ytimg.com/big.jpg', width: 544 },
    ])).toBe('https://i.ytimg.com/big.jpg')
  })

  it('drops tracks without id', () => {
    expect(mapTracks([{ title: 'no id' }, { id: 'x', title: 'ok' }])).toEqual([
      { videoId: 'x', title: 'ok', artists: [], artUrl: null, durationS: null, album: null, year: null, explicit: false },
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

  it('reads youtubei Text titles (library playlists)', () => {
    expect(textOf({ text: 'Mix soirée' })).toBe('Mix soirée')
    expect(textOf({ runs: [{ text: 'Liked ' }, { text: 'Music' }] })).toBe('Liked Music')
    expect(mapPlaylist({ id: 'VLLM', title: { text: 'Titres likés' } })).toMatchObject({
      id: 'VLLM',
      title: 'Titres likés',
    })
  })

  it('maps artist and album fixtures', () => {
    expect(mapArtist({ id: 'UCx', name: 'Radiohead', subscribers: '12M subscribers' })).toEqual({
      id: 'UCx',
      name: 'Radiohead',
      artUrl: null,
      subscribers: '12M subscribers',
    })
    expect(mapAlbum({
      id: 'MPREb_1',
      title: 'OK Computer',
      artists: [{ name: 'Radiohead' }],
      year: '1997',
      subtitleParts: ['Album', 'Radiohead', '1997'],
    })).toEqual({
      id: 'MPREb_1',
      title: 'OK Computer',
      artUrl: null,
      artists: ['Radiohead'],
      year: '1997',
      releaseType: 'album',
      explicit: false,
    })
  })

  it('parses and partitions release types from subtitles', () => {
    expect(parseReleaseType(['Single', 'Artist', '2020'])).toBe('single')
    expect(parseReleaseType(['EP', 'Artist'])).toBe('ep')
    expect(parseReleaseType(['LP', 'Artist'])).toBe('album')
    expect(parseReleaseType(['Compilation', 'Various'])).toBe('compilation')
    expect(mapAlbum({
      id: 'MPREb_best',
      title: 'Best of Radiohead',
      artists: [{ name: 'Radiohead' }],
      subtitleParts: ['Album', 'Radiohead', '2008'],
    })?.releaseType).toBe('compilation')
    // Case ignored + InnerTube releaseType "album" must not block.
    expect(mapAlbum({
      id: 'MPREb_best_of_lower',
      title: 'The Best of Depeche Mode, Vol. 1',
      artists: [{ name: 'Depeche Mode' }],
      subtitleParts: ['Album', '2006'],
      releaseType: 'album',
    })?.releaseType).toBe('compilation')
    expect(mapAlbum({
      id: 'MPREb_best_of_upper',
      title: 'The Best Of Depeche Mode',
      artists: [{ name: 'The Plastic Pepper Band' }],
      subtitleParts: ['Album'],
      releaseType: 'album',
    })?.releaseType).toBe('compilation')
    expect(mapAlbum({
      id: 'MPREb_ed',
      title: 'OK Computer - Edition',
      artists: [{ name: 'Radiohead' }],
      subtitleParts: ['Album'],
    })?.releaseType).toBe('compilation')
    expect(mapAlbum({
      id: 'MPREb_ec',
      title: 'The Essential Collection',
      artists: [{ name: 'Artist' }],
      subtitleParts: ['Album'],
    })?.releaseType).toBe('compilation')
    expect(mapAlbum({
      id: 'MPREb_djk',
      title: 'DJ-Kicks: Four Tet',
      artists: [{ name: 'Four Tet' }],
      subtitleParts: ['Album', 'Four Tet', '2006'],
    })?.releaseType).toBe('compilation')
    // ≥3 artists → compilation even if subtitle / type EP
    expect(mapAlbum({
      id: 'MPREb_radio',
      title: 'whose radio?',
      artists: ['samara', 'Ansh Mehta', 'sudan'],
      subtitleParts: ['EP'],
      releaseType: 'ep',
    })?.releaseType).toBe('compilation')
    expect(mapAlbum({
      id: 'MPREb_x',
      title: 'X',
      artists: [],
      explicit: true,
    })).toMatchObject({ explicit: true })
    // EP without badge + explicit Album of the same title → EP explicit too
    const sexe = [
      mapAlbum({
        id: 'MPREb_sexe_alb',
        title: 'Sexe & the city',
        artists: [{ name: 'Jäde' }],
        subtitleParts: ['Album', 'Jäde', '2026'],
        explicit: true,
      })!,
      mapAlbum({
        id: 'MPREb_sexe_ep',
        title: 'Sexe & the city',
        artists: [{ name: 'Jäde' }],
        subtitleParts: ['EP', 'Jäde', '2025'],
        explicit: false,
      })!,
    ]
    propagateExplicitByTitle(sexe)
    expect(sexe.every((a) => a.explicit)).toBe(true)
    expect(partitionAlbums([
      { id: '1', title: 'A', artUrl: null, artists: [], releaseType: 'album' },
      { id: '2', title: 'S', artUrl: null, artists: [], releaseType: 'single' },
      { id: '3', title: 'C', artUrl: null, artists: [], releaseType: 'compilation' },
      { id: '4', title: 'E', artUrl: null, artists: [], releaseType: 'ep' },
      { id: '5', title: '?', artUrl: null, artists: [], releaseType: null },
    ])).toEqual({
      albums: [
        { id: '1', title: 'A', artUrl: null, artists: [], releaseType: 'album' },
        { id: '5', title: '?', artUrl: null, artists: [], releaseType: null },
      ],
      singles: [
        { id: '2', title: 'S', artUrl: null, artists: [], releaseType: 'single' },
        { id: '4', title: 'E', artUrl: null, artists: [], releaseType: 'ep' },
      ],
      compilations: [{ id: '3', title: 'C', artUrl: null, artists: [], releaseType: 'compilation' }],
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
