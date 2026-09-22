import { describe, expect, it } from 'vitest'
import { argbToHex, carouselsOf, parseMoodsPage } from './explore'

// Extrait au format RÉEL de `browse FEmusic_moods_and_genres` (sondé le 2026-09-22, session fr).
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

describe('ytmusic « Humeurs et genres »', () => {
  it('classe les grilles par position : la personnalisée, les ambiances, les genres', () => {
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

  it("se passe de « Pour vous » quand YouTube n'en donne pas", () => {
    const r = parseMoodsPage(page(grid('Moods', [button('Chill', 1, 'a')]), grid('Genres', [button('Jazz', 2, 'b')])))
    expect(r.forYou.categories).toEqual([])
    expect(r.moods.categories[0]!.title).toBe('Chill')
    expect(r.genres.categories[0]!.title).toBe('Jazz')
  })

  it('garde le RVB de la couleur ARGB, rien sans couleur', () => {
    expect(argbToHex(4278227647)).toBe('#0092bf')
    expect(argbToHex(undefined)).toBeNull()
  })

  it("trouve les rangées d'une page analysée, où qu'elles soient", () => {
    const parsed = {
      contents: { type: 'SingleColumnBrowseResults', tabs: [{ type: 'Tab', content: { type: 'SectionList', contents: [
        { type: 'MusicCarouselShelf', header: { title: { text: 'Au calme' } }, contents: [{ id: 'x' }] },
        { type: 'MusicCarouselShelf', header: { title: { text: 'Albums' } }, contents: [] },
      ] } }] },
    }
    expect(carouselsOf(parsed)).toEqual([{ title: 'Au calme', items: [{ id: 'x' }] }, { title: 'Albums', items: [] }])
  })

  it("prend les rangées dans l'index de youtubei.js quand il existe (vraie réponse)", () => {
    const parsed = { contents: {}, contents_memo: new Map([['MusicCarouselShelf', [{ header: { title: { text: 'Titres' } }, contents: [{ id: 'a' }] }]]]) }
    expect(carouselsOf(parsed)).toEqual([{ title: 'Titres', items: [{ id: 'a' }] }])
  })
})
