import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MusicItemRow from './MusicItemRow.vue'
import MusicTile from './MusicTile.vue'

// An album or an artist opens AND plays: the playback button set on the cover art must not open the
// detail in passing (the click would bubble up to the tile or the row).
describe('playback button set on the cover art', () => {
  it("plays an album from its tile without opening it, and opens it everywhere else", async () => {
    const w = mount(MusicTile, { props: { art: null, title: 'OK Computer', action: 'open', playable: true } })
    await w.find('.art-play').trigger('click')
    expect(w.emitted('play')).toHaveLength(1)
    expect(w.emitted('open')).toBeUndefined()
    await w.find('.tile__title').trigger('click')
    expect(w.emitted('open')).toHaveLength(1)
  })

  it("puts none on a tile that does not play", () => {
    const w = mount(MusicTile, { props: { art: null, title: 'Mix', action: 'open' } })
    expect(w.find('.art-play').exists()).toBe(false)
  })

  it("does the same on an artist row, and a track's button stays on its cover art", async () => {
    const row = mount(MusicItemRow, { props: { art: null, title: 'Radiohead', action: 'open', playable: true } })
    await row.find('.row__art .art-play').trigger('click')
    expect(row.emitted('play')).toHaveLength(1)
    expect(row.emitted('open')).toBeUndefined()
    const track = mount(MusicItemRow, { props: { art: null, title: 'Airbag', action: 'play' } })
    expect(track.find('.row__art .art-play').exists()).toBe(true)
  })
})

describe('explicit flag on tiles', () => {
  it('puts the "E" next to the title, only when the catalog says so', () => {
    const marked = mount(MusicTile, { props: { art: null, title: 'The W', action: 'open', explicit: true } })
    expect(marked.find('.tile__line1 .explicit').exists()).toBe(true)
    const clean = mount(MusicTile, { props: { art: null, title: 'Iron Flag', action: 'open' } })
    expect(clean.find('.explicit').exists()).toBe(false)
  })
})

describe("row without a thumbnail (tracks of an album)", () => {
  it('plays on touching the row, without cover art, and the number carries playback', async () => {
    const w = mount(MusicItemRow, { props: { art: null, title: 'Ride', action: 'play', artless: true, position: 1 } })
    expect(w.find('.row__art').exists()).toBe(false)
    expect(w.find('.pos__n').text()).toBe('#1')
    await w.find('.title').trigger('click')
    expect(w.emitted('play')).toHaveLength(1)
    // the queue buttons do not start the track in passing
    const q = mount(MusicItemRow, { props: { art: null, title: 'Ride', action: 'play', artless: true, queueable: true } })
    await q.find('.mini').trigger('click')
    expect(q.emitted('play')).toBeUndefined()
    expect(q.emitted('playNext')).toHaveLength(1)
  })

  it('plays nothing when no player can receive', async () => {
    const w = mount(MusicItemRow, { props: { art: null, title: 'Ride', action: 'play', artless: true, disabled: true } })
    await w.find('.title').trigger('click')
    expect(w.emitted('play')).toBeUndefined()
  })
})
