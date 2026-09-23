import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MusicItemRow from './MusicItemRow.vue'
import MusicTile from './MusicTile.vue'

// Un album ou un artiste s'ouvre ET se joue : la lecture posée sur la pochette ne doit pas ouvrir le
// détail au passage (le clic remonterait jusqu'à la tuile ou la ligne).
describe('lecture posée sur la pochette', () => {
  it("joue un album depuis sa tuile sans l'ouvrir, et l'ouvre partout ailleurs", async () => {
    const w = mount(MusicTile, { props: { art: null, title: 'OK Computer', action: 'open', playable: true } })
    await w.find('.art-play').trigger('click')
    expect(w.emitted('play')).toHaveLength(1)
    expect(w.emitted('open')).toBeUndefined()
    await w.find('.tile__title').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })

  it("n'en met pas sur une tuile qui ne se joue pas", () => {
    const w = mount(MusicTile, { props: { art: null, title: 'Mix', action: 'open' } })
    expect(w.find('.art-play').exists()).toBe(false)
  })

  it("fait de même sur une ligne d'artiste, et la touche d'un titre reste sur sa pochette", async () => {
    const row = mount(MusicItemRow, { props: { art: null, title: 'Radiohead', action: 'open', playable: true } })
    await row.find('.row__art .art-play').trigger('click')
    expect(row.emitted('play')).toHaveLength(1)
    expect(row.emitted('open')).toBeUndefined()
    const track = mount(MusicItemRow, { props: { art: null, title: 'Airbag', action: 'play' } })
    expect(track.find('.row__art .art-play').exists()).toBe(true)
  })
})

describe('marquage explicit sur les tuiles', () => {
  it('pose le « E » à côté du titre, seulement quand le catalogue le dit', () => {
    const marked = mount(MusicTile, { props: { art: null, title: 'The W', action: 'open', explicit: true } })
    expect(marked.find('.tile__line1 .explicit').exists()).toBe(true)
    const clean = mount(MusicTile, { props: { art: null, title: 'Iron Flag', action: 'open' } })
    expect(clean.find('.explicit').exists()).toBe(false)
  })
})

describe("ligne sans vignette (titres d'un album)", () => {
  it('se joue en touchant la ligne, sans pochette, et le numéro porte la lecture', async () => {
    const w = mount(MusicItemRow, { props: { art: null, title: 'Ride', action: 'play', artless: true, position: 1 } })
    expect(w.find('.row__art').exists()).toBe(false)
    expect(w.find('.pos__n').text()).toBe('#1')
    await w.find('.title').trigger('click')
    expect(w.emitted('play')).toHaveLength(1)
    // les touches de file ne lancent pas le titre au passage
    const q = mount(MusicItemRow, { props: { art: null, title: 'Ride', action: 'play', artless: true, queueable: true } })
    await q.find('.mini').trigger('click')
    expect(q.emitted('play')).toBeUndefined()
    expect(q.emitted('playNext')).toHaveLength(1)
  })

  it('ne joue rien quand aucun lecteur ne peut recevoir', async () => {
    const w = mount(MusicItemRow, { props: { art: null, title: 'Ride', action: 'play', artless: true, disabled: true } })
    await w.find('.title').trigger('click')
    expect(w.emitted('play')).toBeUndefined()
  })
})
