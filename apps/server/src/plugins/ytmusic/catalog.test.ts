import { afterEach, describe, expect, it, vi } from 'vitest'
import { musicHostFetch } from './catalog'

// www.youtube.com retient les titres explicit d'un album (5 titres sur 8 pour « Paradise ») :
// les requêtes InnerTube partent vers music.youtube.com, le reste n'est pas touché.
describe('musicHostFetch', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('redirige InnerTube vers music.youtube.com, en gardant la requête', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await musicHostFetch('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', body: '{}' })
    expect(fetchMock).toHaveBeenCalledWith('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', body: '{}' })
    await musicHostFetch(new Request('https://www.youtube.com/youtubei/v1/next', { method: 'POST', body: '{}' }))
    expect((fetchMock.mock.calls.at(-1) as unknown as [Request])[0].url).toBe('https://music.youtube.com/youtubei/v1/next')
  })

  it("laisse passer ce qui n'est pas InnerTube", async () => {
    const fetchMock = vi.fn(async () => new Response(''))
    vi.stubGlobal('fetch', fetchMock)
    await musicHostFetch('https://www.youtube.com/sw.js_data')
    expect(fetchMock).toHaveBeenCalledWith('https://www.youtube.com/sw.js_data', undefined)
  })
})
