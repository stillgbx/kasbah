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

  it('tile of a camera known to be off: its last image stays, dimmed, under the inactive message', async () => {
    fake(undefined)
    const at = Date.now() - AGO_MS
    const w = mount(CameraVideo, { props: { deviceId: 'nest:cam1', autoplay: false, snapshotAt: at, inactive: true } })
    expect(w.find('img.cam__snapshot').classes()).toContain('cam__snapshot--off')
    expect(w.find('.cam__overlay').text()).toContain('Caméra inactive : pas de flux')
    expect(w.find('.cam__msg--age').text()).toBe('il y a 12 s')
    // an active camera's image speaks for itself: no message, not dimmed
    await w.setProps({ inactive: false })
    expect(w.find('img.cam__snapshot').classes()).not.toContain('cam__snapshot--off')
    expect(w.find('.cam__overlay').text()).toBe('il y a 12 s')
  })

  it('a live stream that fails says why in words, over the dimmed image, and Preview clears it', async () => {
    // this time the stream opens: MediaSource fires `sourceopen`, the WebSocket is a fake we drive
    const sockets: { onmessage: ((ev: { data: unknown }) => void) | null; close: () => void }[] = []
    vi.stubGlobal('MediaSource', class { readyState = 'open'; addEventListener(_: string, cb: () => void) { queueMicrotask(cb) } endOfStream() { /* closed */ } })
    vi.stubGlobal('WebSocket', class { onmessage = null; onerror = null; onclose = null; binaryType = ''; constructor() { sockets.push(this) } close() { /* closed */ } })
    fake(undefined)
    const at = Date.now() - AGO_MS
    const w = mount(CameraVideo, { props: { deviceId: 'nest:cam1', autoplay: false, snapshotAt: at } })
    await w.findAll('.seg__btn')[2]!.trigger('click')                // Live
    await flushPromises()
    sockets[0]!.onmessage!({ data: JSON.stringify({ type: 'ended', reason: 'ffmpeg exited (3419392776): Error opening input files: Server returned 404 Not Found' }) })
    await flushPromises()
    const overlay = w.find('.cam__overlay').text()
    expect(overlay).toContain('La caméra ne diffuse pas : éteinte ou hors réseau')
    expect(overlay).not.toMatch(/ffmpeg|404/)
    expect(w.find('img.cam__snapshot').classes()).toContain('cam__snapshot--off')
    // the bar shows Preview (the stream is over): pressing it goes back to the plain thumbnail
    await w.findAll('.seg__btn')[1]!.trigger('click')
    expect(w.find('.cam__overlay').text()).toBe('il y a 12 s')
    expect(w.find('img.cam__snapshot').classes()).not.toContain('cam__snapshot--off')
  })

  it('an unexplained end keeps the plain label, never the raw reason', async () => {
    const sockets: { onmessage: ((ev: { data: unknown }) => void) | null }[] = []
    vi.stubGlobal('MediaSource', class { readyState = 'open'; addEventListener(_: string, cb: () => void) { queueMicrotask(cb) } endOfStream() { /* closed */ } })
    vi.stubGlobal('WebSocket', class { onmessage = null; onerror = null; onclose = null; binaryType = ''; constructor() { sockets.push(this) } close() { /* closed */ } })
    fake(undefined)
    const w = mount(CameraVideo, { props: { deviceId: 'nest:cam1' } })
    await flushPromises()
    sockets[0]!.onmessage!({ data: JSON.stringify({ type: 'ended', reason: 'relay ended: bad MP4 stream: invalid box' }) })
    await flushPromises()
    expect(w.find('.cam__overlay').text()).toBe('Flux terminé')
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
