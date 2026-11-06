import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { useRecentQueries } from './useRecentQueries'

describe('useRecentQueries', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the newest first, without duplicates whatever the case, up to the maximum', () => {
    const r = useRecentQueries('podcasts', 3)
    r.remember('jardin')
    r.remember('  histoire ')
    r.remember('JARDIN')
    expect(r.queries.value).toEqual(['jardin', 'histoire'])
    r.remember('sciences')
    r.remember('cuisine')
    expect(r.queries.value).toEqual(['cuisine', 'sciences', 'jardin'])
    r.remember('')
    r.remove('sciences')
    expect(r.items.value).toEqual([{ key: 'cuisine', label: 'cuisine' }, { key: 'jardin', label: 'jardin' }])
  })

  it('keeps one list per source, YouTube Music under its former key', async () => {
    localStorage.setItem('kasbah.ytmusic.recentQueries', JSON.stringify(['satie']))
    const yt = useRecentQueries('ytmusic')
    const radio = useRecentQueries('radio')
    expect(yt.queries.value).toEqual(['satie'])
    radio.remember('fip')
    expect(yt.queries.value).toEqual(['satie'])
    // the storage is written on the next tick
    await nextTick()
    expect(JSON.parse(localStorage.getItem('kasbah.radio.recentQueries')!)).toEqual(['fip'])
  })
})
