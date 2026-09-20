import { describe, expect, it, vi } from 'vitest'
import type { FetchLike } from '../../core/sse'
import { EnlightenClient, probeEvRaw, sitesOf } from './cloud'

const response = (text: string, status = 200) => ({
  ok: status < 400, status, body: null,
  json: async () => JSON.parse(text) as unknown,
  text: async () => text,
})

describe('sitesOf', () => {
  it('lit l\'emballage `sites` + `id` / `title` (forme vue dans l\'appli)', () => {
    expect(sitesOf({ sites: [{ id: 1234567, title: 'Maison' }] })).toEqual([{ id: '1234567', title: 'Maison' }])
  })

  it('accepte les autres enveloppes et clés d\'id, sans inventer un site', () => {
    expect(sitesOf({ systems: [{ system_id: '99', name: 'Toit' }] })).toEqual([{ id: '99', title: 'Toit' }])
    expect(sitesOf({ data: [{ siteId: 1 }] })).toEqual([{ id: '1' }])
    expect(sitesOf({ nope: [] })).toEqual([])
    expect(sitesOf(null)).toEqual([])
  })
})

describe('probeEvRaw', () => {
  it('sonde chaque chemin et porte l\'échec d\'un seul sans tomber', async () => {
    const fetchImpl = vi.fn<FetchLike>(async (url) => {
      if (url.includes('/ev_chargers/status') && !url.includes('/api/v2/')) return response('<html>', 404)
      if (url.includes('search_sites')) return response(JSON.stringify({ sites: [{ id: 42, title: 'Maison' }] }))
      return response('{"ok":true}')
    })
    const client = new EnlightenClient({ fetchImpl, session: { sessionId: 'sess-1', siteId: '42' } })
    const raw = await probeEvRaw(client, '42')
    expect(raw.siteId).toBe('42')
    expect(raw['/app-api/search_sites.json?searchText=&favourite=false']).toMatchObject({ sites: [{ id: 42 }] })
    expect(raw['/service/evse_controller/42/ev_chargers/status']).toMatchObject({ error: expect.stringContaining('404') as unknown as string })
  })

  it('sans id de site, les chemins qui en ont besoin se disent au lieu d\'être appelés', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => response('{"ok":true}'))
    const client = new EnlightenClient({ fetchImpl, session: { sessionId: 'sess-1' } })
    const raw = await probeEvRaw(client, undefined)
    expect(raw['/service/evse_controller/{site}/ev_chargers/status']).toMatchObject({ error: expect.stringContaining('no Enlighten site id') as unknown as string })
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/ev_chargers/'))).toBe(false)
    expect(raw.hasCookie).toBe(false)
  })

  it('envoie le cookie Rails, pas le session_id d\'entrez', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => response('{"sites":[]}'))
    const client = new EnlightenClient({
      fetchImpl,
      session: { sessionId: 'sess-json', cookie: 'rails-cookie', siteId: '42' },
    })
    await client.readSites()
    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers.cookie).toBe('_enlighten_4_session=rails-cookie')
  })
})
