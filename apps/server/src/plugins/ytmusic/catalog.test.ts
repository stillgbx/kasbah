import { afterEach, describe, expect, it, vi } from 'vitest'
import { musicHostFetch } from './catalog'

// www.youtube.com holds back an album's explicit tracks (5 tracks out of 8 for "Paradise"):
// InnerTube requests go to music.youtube.com, the rest is not touched.
describe('musicHostFetch', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('redirects InnerTube to music.youtube.com, keeping the request', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await musicHostFetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', body: '{}' })
    expect(fetchMock).toHaveBeenCalledWith('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', body: '{}' })
    await musicHostFetch(new Request('https://www.youtube.com/youtubei/v1/next', { method: 'POST', body: '{}' }))
    expect((fetchMock.mock.calls.at(-1) as unknown as [Request])[0].url).toBe('https://music.youtube.com/youtubei/v1/next')
  })

  it('lets through what is not InnerTube', async () => {
    const fetchMock = vi.fn(async () => new Response(''))
    vi.stubGlobal('fetch', fetchMock)
    await musicHostFetch('https://www.youtube.com/sw.js_data')
    expect(fetchMock).toHaveBeenCalledWith('https://www.youtube.com/sw.js_data', undefined)
  })
})
