import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { House } from '@kasbah/shared'
import SceneLoader from './SceneLoader.vue'

// Two rooms touching on the ground floor: eight edges, one of them shared.
const house = {
  levels: [{ id: 'rdc', name: 'Rez-de-chaussée', shortName: 'RDC', elevation: 0 }, { id: 'etage', name: 'Étage', elevation: 2.8 }],
  rooms: [
    { id: 'a', levelId: 'rdc', name: 'A', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] },
    { id: 'b', levelId: 'rdc', name: 'B', polygon: [[4, 0], [8, 0], [8, 3], [4, 3]] },
  ],
} as unknown as House

describe('3D view loading veil', () => {
  /** A wall between two rooms is only drawn once: two superimposed strokes would read as bold. */
  it('draws each wall only once, and skips a level without rooms', () => {
    const w = mount(SceneLoader, { props: { house, stage: 'shaders', progress: null } })
    expect(w.findAll('.loader__wall')).toHaveLength(7)
    expect(w.findAll('.loader__floor')).toHaveLength(2)
    expect(w.findAll('.loader__leader')).toHaveLength(0)            // a single level drawn: nothing to link
    w.unmount()
  })

  /** The animation is discovered in full once; afterwards, a reload no longer makes one sit through it. */
  it('only holds the veil the first time on this workstation', async () => {
    vi.useFakeTimers()
    localStorage.removeItem('kasbah.sceneLoaderSeen')
    const settled = (w: ReturnType<typeof mount>) => w.emitted<[boolean]>('settled')?.at(-1)?.[0]
    const first = mount(SceneLoader, { props: { house, stage: 'shaders', progress: null } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(settled(first)).toBeUndefined()                          // the house may be ready: we watch the drawing
    await vi.advanceTimersByTimeAsync(10_000)
    expect(settled(first)).toBe(true)
    first.unmount()
    const again = mount(SceneLoader, { props: { house, stage: 'shaders', progress: null } })
    await vi.advanceTimersByTimeAsync(1)
    expect(settled(again)).toBe(true)
    again.unmount()
    localStorage.removeItem('kasbah.sceneLoaderSeen')
    vi.useRealTimers()
  })

  it('states the current step, with the material count when it is known', () => {
    const w = mount(SceneLoader, { props: { house: null, stage: 'materials', progress: { done: 3, total: 10 } } })
    expect(w.find('.loader__step').text()).toBe('Matières · 3 / 10')
    expect(w.findAll('.loader__wall').length).toBeGreaterThan(0)   // the generic house, while waiting for the real one
    expect(w.findAll('.loader__leader')).toHaveLength(4)            // two levels: four leader lines
    w.unmount()
  })
})
