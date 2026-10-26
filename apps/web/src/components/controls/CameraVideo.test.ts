import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setTransport } from '../../api'
import type { Transport } from '../../api/transport'
import CameraVideo from './CameraVideo.vue'

// While a live stream connects, the last thumbnail stays on screen with its age, instead of a black
// player: the detail card reads its date from the server, the Cameras view passes it. The stream
// itself never opens here (MediaSource never fires `sourceopen`): the player stays "connecting".

const AGO_MS = 12_000

function fake(at: number | undefined) {
  const cameraSnapshots = vi.fn(async () => (at === undefined ? {} : { cam1: { at, live: false } }))
  setTransport({
    cameraStreamUrl: () => 'ws://server/stream',
    cameraSnapshots,
    cameraSnapshotUrl: (deviceId: string, t: number) => `/snap/${deviceId}?t=${t}`,
  } as unknown as Transport)
  return cameraSnapshots
}

describe('CameraVideo', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaSource', class { readyState = 'closed'; addEventListener() { /* never opens */ } })
    URL.createObjectURL = vi.fn(() => 'blob:stream')
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => { setTransport(null); vi.unstubAllGlobals() })

  it('detail card: shows the last thumbnail and its age while the live stream connects', async () => {
    const at = Date.now() - AGO_MS
    const cameraSnapshots = fake(at)
    const w = mount(CameraVideo, { props: { deviceId: 'nest:cam1' } })
    await flushPromises()
    expect(cameraSnapshots).toHaveBeenCalledWith('nest', false)    // reads the date without keeping the thumbnail sessions alive
    expect(w.find('img.cam__snapshot').attributes('src')).toBe(`/snap/nest:cam1?t=${at}`)
    expect(w.find('.cam__overlay').text()).toContain('Connexion au flux…')
    expect(w.find('.cam__msg--age').text()).toBe('il y a 12 s')
  })

  it('detail card without a thumbnail: the player connects as before', async () => {
    fake(undefined)
    const w = mount(CameraVideo, { props: { deviceId: 'nest:cam1' } })
    await flushPromises()
    expect(w.find('img.cam__snapshot').exists()).toBe(false)
    expect(w.find('.cam__msg--age').exists()).toBe(false)
    expect(w.find('.cam__overlay').text()).toBe('Connexion au flux…')
  })

  it('tile: the thumbnail stays up when going live, until the video plays', async () => {
    const cameraSnapshots = fake(undefined)
    const at = Date.now() - AGO_MS
    const w = mount(CameraVideo, { props: { deviceId: 'nest:cam1', autoplay: false, snapshotAt: at } })
    expect(w.find('img.cam__snapshot').exists()).toBe(true)
    await w.findAll('.seg__btn')[2]!.trigger('click')                // Live
    await flushPromises()
    expect(w.find('.cam__overlay').text()).toContain('Connexion au flux…')
    expect(w.find('img.cam__snapshot').attributes('src')).toBe(`/snap/nest:cam1?t=${at}`)
    expect(cameraSnapshots).not.toHaveBeenCalled()                   // the view already gives the date
  })
})
