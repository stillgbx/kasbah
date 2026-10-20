import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { PluginHealth, PluginInfo } from '@kasbah/shared'
import MelcloudLinkCard from '../MelcloudLinkCard.vue'
import PluginSection from './PluginSection.vue'
import YtmusicLinkCard from '../YtmusicLinkCard.vue'

const plugin = (over: Partial<PluginInfo> = {}, health: Partial<PluginHealth> = {}): PluginInfo => ({
  id: 'tahoma', implemented: true, enabled: true, parts: [],
  health: { status: 'ok', detail: 'gateway-2060.local', keys: ['TAHOMA_HOST'], ...health },
  ...over,
})

/** Expanded or not: `v-show` leaves the panel in the DOM and hides it with its style. */
const body = (w: ReturnType<typeof mount>) => !(w.find('.plugin__body').attributes('style') ?? '').includes('display: none')

describe('PluginSection — what opens by itself', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('stays collapsed when the vendor is fine', () => {
    expect(body(mount(PluginSection, { props: { plugin: plugin() } }))).toBe(false)
  })

  it('opens by itself when the server DEMANDS something', () => {
    for (const status of ['needs_pairing', 'error'] as const) {
      expect(body(mount(PluginSection, { props: { plugin: plugin({}, { status }) } }))).toBe(true)
    }
  })

  /** A degraded vendor complains without asking for anything: its row says so, its panel stays closed. */
  it('does not open for a mere degraded state', () => {
    expect(body(mount(PluginSection, { props: { plugin: plugin({}, { status: 'degraded' }) } }))).toBe(false)
  })

  /** A turned-off plugin demands nothing: its status is no longer worth opening its panel. */
  it('does not open by itself for a turned-off plugin', () => {
    expect(body(mount(PluginSection, { props: { plugin: plugin({ enabled: false }, { status: 'needs_pairing' }) } }))).toBe(false)
  })

  it('leaves the last word to the user, both ways', async () => {
    const opened = mount(PluginSection, { props: { plugin: plugin({}, { status: 'needs_pairing' }) } })
    await opened.find('.plugin__toggle').trigger('click')
    expect(body(opened)).toBe(false)

    const closed = mount(PluginSection, { props: { plugin: plugin() } })
    await closed.find('.plugin__toggle').trigger('click')
    expect(body(closed)).toBe(true)
  })

  /**
   * A vendor linked by password brings ITS setup card: forgetting it in
   * `SETUP_CARDS` would leave a panel that opens onto nothing, with nothing to flag it.
   */
  it('mounts the linking card of the vendor that has one', () => {
    const w = mount(PluginSection, { props: { plugin: plugin({ id: 'melcloud' }, { status: 'needs_pairing', detail: 'no MELCloud account linked' }) } })
    expect(body(w)).toBe(true)
    expect(w.findComponent(MelcloudLinkCard).exists()).toBe(true)
  })

  it('mounts the YouTube Music card when a cookie is requested', () => {
    const w = mount(PluginSection, { props: { plugin: plugin({ id: 'ytmusic' }, { status: 'needs_pairing', detail: 'paste cookie' }) } })
    expect(body(w)).toBe(true)
    expect(w.findComponent(YtmusicLinkCard).exists()).toBe(true)
  })

  /** A skeleton has no detail, no key, no card: the chevron stays for alignment, inert. */
  it('does not expand when there is nothing under it', () => {
    const w = mount(PluginSection, { props: { plugin: plugin({ id: 'unobtanium', implemented: false, enabled: false }, { status: 'not_implemented', detail: undefined, keys: [] }) } })
    expect(w.find('.plugin__toggle').attributes('disabled')).toBeDefined()
    expect(w.find('.plugin__chev').attributes('data-on')).toBe('0')
  })
})
