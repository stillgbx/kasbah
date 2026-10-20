import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useLocalPluginsStore } from '../stores/localPlugins'
import { useTensStore, CHECK_SETTLE_MS } from '../stores/tens'
import { FakeTens, fakeBluetooth } from '../lib/tens/fakeTens'
import { CMD } from '../lib/tens/protocol'
import TensView from './TensView.vue'

// What the page must hold: only exist on the device that has activated the plugin, let nothing
// be started as long as the TENS is not connected, start a favorite in one click, and keep stop
// pressable as soon as it is connected.

let dev: FakeTens
const tens = () => useTensStore()

function setup() {
  const w = mount(TensView, { global: { stubs: { PageHeader: true, RouterLink: RouterLinkStub } } })
  const button = (label: string) => w.findAll('button').find((b) => b.text().includes(label))
  return { w, button }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  setActivePinia(createPinia())
  dev = new FakeTens()
  Object.defineProperty(navigator, 'bluetooth', { value: fakeBluetooth(dev), configurable: true })
})
afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'bluetooth')
})

describe('TensView', () => {
  it('points to the settings when the plugin is off on this device', () => {
    const { w } = setup()
    expect(w.text()).toContain("Le TENS n'est pas activé sur ce poste")
    expect(w.find('.session').exists()).toBe(false)
  })

  it('says so when the browser has no Bluetooth', () => {
    Reflect.deleteProperty(navigator, 'bluetooth')
    useLocalPluginsStore().setEnabled('tens', true)
    const { w } = setup()
    expect(w.text()).toContain('Chrome ou Edge')
  })

  it('keeps every launch and drive control disabled until connected', () => {
    useLocalPluginsStore().setEnabled('tens', true)
    const { w, button } = setup()
    expect(button('Démarrer')!.attributes('disabled')).toBeDefined()
    expect(button('Arrêter')!.attributes('disabled')).toBeDefined()
    expect(w.findAll('.favorite__go').every((b) => b.attributes('disabled') !== undefined)).toBe(true)
    expect(w.findAll('.channel__btn').every((b) => b.attributes('disabled') !== undefined)).toBe(true)
  })

  it('launches a favorite in one click once connected', async () => {
    useLocalPluginsStore().setEnabled('tens', true)
    const { w, button } = setup()
    await button('Connecter')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('89 %')
    expect(button('Arrêter')!.attributes('disabled')).toBeDefined()   // connected, but nothing is running
    await w.findAll('.favorite__go')[0]!.trigger('click')        // P6 · Stimulation HAN · 60 min
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100)
    await flushPromises()
    expect(dev.frames(CMD.program)).toHaveLength(2)
    expect(dev.frames(CMD.start)[0]!.slice(4, 6)).toEqual(Uint8Array.of(0x10, 0x0e)) // 3600 s
    expect(useTensStore().running).toBe(true)
    expect(w.find('.session__program').text()).toContain('Stimulation HAN')
    expect(w.find('.session__time').text()).toBe('1:00:00')
    expect(button('Arrêter')!.attributes('disabled')).toBeUndefined()
    // the running program is marked in the list
    const p6 = w.findAll('.program').find((p) => p.text().includes('P6'))!
    expect(p6.attributes('data-current')).toBe('1')
    expect(p6.attributes('data-on')).toBe('1')                        // chosen by default: it is the one running
    expect(p6.find('.pulse').attributes('data-on')).toBe('1')          // and its dot pulses
  })

  it('selects nothing by default: Start waits for a program to be picked', async () => {
    useLocalPluginsStore().setEnabled('tens', true)
    const { w, button } = setup()
    await button('Connecter')!.trigger('click')
    await flushPromises()
    expect(w.findAll('.program[data-on="1"]')).toHaveLength(0)
    expect(button('Démarrer')!.attributes('disabled')).toBeDefined()
    await w.findAll('.program__pick')[2]!.trigger('click')        // P3
    expect(button('Démarrer')!.attributes('disabled')).toBeUndefined()
  })

  it('saves the intensities with the favorite, and the favorite ramps to them in one click', async () => {
    useLocalPluginsStore().setEnabled('tens', true)
    const { w, button } = setup()
    await button('Connecter')!.trigger('click')
    await flushPromises()
    const [c1, c2] = w.findAllComponents({ name: 'VSlider' }).slice(-2)
    c1!.vm.$emit('update:modelValue', 15)
    c2!.vm.$emit('update:modelValue', 10)
    await flushPromises()
    const p1 = w.findAll('.program').find((p) => p.text().includes('P1'))!
    await p1.find('.program__star').trigger('click')
    expect(tens().favorites[2]).toEqual({ program: 'p1', minutes: 30, channels: 3, ch1: 15, ch2: 10 })
    expect(w.findAll('.favorite')[2]!.text()).toContain('30 min · 1,5 / 1,0 mA')
    await w.findAll('.favorite__go')[2]!.trigger('click')
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100 + 300 * 6)
    await flushPromises()
    expect(tens().acquiredOf(1)).toBe(15)
    expect(tens().acquiredOf(2)).toBe(10)
  })

  it('keeps several favorites of the same program when their settings differ', async () => {
    useLocalPluginsStore().setEnabled('tens', true)
    const { w, button } = setup()
    const p6 = () => w.findAll('.program').find((p) => p.text().includes('P6'))!
    expect(p6().find('.program__star').attributes('data-on')).toBe('other')   // P6 favorite at 60 min, not at 30
    await p6().find('.program__star').trigger('click')                         // P6 at 30 min as well
    expect(w.findAll('.favorite').map((f) => f.text()).filter((t) => t.includes('P6'))).toHaveLength(2)
    expect(p6().find('.program__star').attributes('data-on')).toBe('1')
    // start the second: only its tile is marked as running
    await button('Connecter')!.trigger('click')
    await flushPromises()
    await w.findAll('.favorite__go')[2]!.trigger('click')
    await vi.advanceTimersByTimeAsync(CHECK_SETTLE_MS + 100)
    await flushPromises()
    expect(w.findAll('.favorite').map((f) => f.attributes('data-current'))).toEqual(['0', '0', '1'])
    // the star only removes the favorite for the current settings: the 60 min one stays
    await p6().find('.program__star').trigger('click')
    expect(tens().favorites.filter((f) => f.program === 'p6').map((f) => f.minutes)).toEqual([60])
  })

  it('adds and removes favorites with the star, kept on this device', async () => {
    useLocalPluginsStore().setEnabled('tens', true)
    const { w } = setup()
    expect(w.findAll('.favorite')).toHaveLength(2)                 // P6 and P3 at the start
    const p1 = () => w.findAll('.program').find((p) => p.text().includes('P1'))!
    await p1().find('.program__star').trigger('click')
    expect(w.findAll('.favorite')).toHaveLength(3)
    expect(w.findAll('.favorite')[2]!.text()).toContain('30 min')  // duration set at the time of adding
    expect(JSON.parse(localStorage.getItem('kasbah.tens.favorites')!)).toHaveLength(3)
    await w.findAll('.favorite__remove')[0]!.trigger('click')     // retire P6
    expect(w.findAll('.favorite').map((f) => f.text()).join()).not.toContain('P6')
  })
})
