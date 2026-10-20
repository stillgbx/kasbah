import { describe, expect, it } from 'vitest'
import { argbToHex, carouselsOf, parseMoodsPage } from './explore'

// Excerpt in the REAL format of `browse FEmusic_moods_and_genres` (probed on 2026-09-22, fr session).
const button = (text: string, color: number, params: string) => ({
  musicNavigationButtonRenderer: {
    buttonText: { runs: [{ text }] },
    solid: { leftStripeColor: color },
    clickCommand: { browseEndpoint: { browseId: 'FEmusic_moods_and_genres_category', params } },
  },
})
const grid = (title: string, items: unknown[]) => ({
  gridRenderer: { header: { gridHeaderRenderer: { title: { runs: [{ text: title }] } } }, items },
})
const page = (...grids: unknown[]) => ({
  contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: grids } } } }] } },
})

describe('ytmusic "Moods & genres"', () => {
  it('sorts the grids by position: the personalized one, the moods, the genres', () => {
    const r = parseMoodsPage(page(
      grid('Pour vous', [button('Hip-hop & rap', 4293020416, 'p-hiphop')]),
      grid('Humeurs et moments', [button('Calme', 4288988671, 'p-calme'), button('Énergie', 4294961024, 'p-energie')]),
      grid('Genres', [button('Afro', 4278232339, 'p-afro')]),
    ))
    expect(r.forYou).toEqual({ title: 'Pour vous', categories: [{ title: 'Hip-hop & rap', params: 'p-hiphop', color: '#e24b00' }] })
    expect(r.moods.title).toBe('Humeurs et moments')
    expect(r.moods.categories.map((c) => c.title)).toEqual(['Calme', 'Énergie'])
    expect(r.genres.categories).toEqual([{ title: 'Afro', params: 'p-afro', color: '#00a513' }])
  })

  it('does without "For you" when YouTube gives none', () => {
    const r = parseMoodsPage(page(grid('Moods', [button('Chill', 1, 'a')]), grid('Genres', [button('Jazz', 2, 'b')])))
    expect(r.forYou.categories).toEqual([])
    expect(r.moods.categories[0]!.title).toBe('Chill')
    expect(r.genres.categories[0]!.title).toBe('Jazz')
  })

  it('keeps the RGB of the ARGB color, nothing without a color', () => {
    expect(argbToHex(4278227647)).toBe('#0092bf')
    expect(argbToHex(undefined)).toBeNull()
  })

  it('finds the rows of a parsed page, wherever they are', () => {
    const parsed = {
      contents: { type: 'SingleColumnBrowseResults', tabs: [{ type: 'Tab', content: { type: 'SectionList', contents: [
        { type: 'MusicCarouselShelf', header: { title: { text: 'Au calme' } }, contents: [{ id: 'x' }] },
        { type: 'MusicCarouselShelf', header: { title: { text: 'Albums' } }, contents: [] },
      ] } }] },
    }
    expect(carouselsOf(parsed)).toEqual([{ title: 'Au calme', items: [{ id: 'x' }] }, { title: 'Albums', items: [] }])
  })

  it('takes the rows from the youtubei.js index when it exists (real response)', () => {
    const parsed = { contents: {}, contents_memo: new Map([['MusicCarouselShelf', [{ header: { title: { text: 'Titres' } }, contents: [{ id: 'a' }] }]]]) }
    expect(carouselsOf(parsed)).toEqual([{ title: 'Titres', items: [{ id: 'a' }] }])
  })

  it('also takes the grids, first (the new releases page puts its flagship playlists there)', () => {
    const parsed = { contents: {}, contents_memo: new Map<string, unknown[]>([
      ['MusicCarouselShelf', [{ header: { title: { text: 'Albums et singles' } }, contents: [{ id: 'al' }] }]],
      ['Grid', [{ items: [{ id: 'VLRDCLAK_released' }] }]],
    ]) }
    expect(carouselsOf(parsed)).toEqual([{ title: '', items: [{ id: 'VLRDCLAK_released' }] }, { title: 'Albums et singles', items: [{ id: 'al' }] }])
  })
})
