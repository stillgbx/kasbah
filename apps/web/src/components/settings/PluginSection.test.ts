import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { PluginHealth, PluginInfo } from '@kasbah/shared'
import PluginSection from './PluginSection.vue'

const plugin = (over: Partial<PluginInfo> = {}, health: Partial<PluginHealth> = {}): PluginInfo => ({
  id: 'tahoma', implemented: true, enabled: true, parts: [],
  health: { status: 'ok', detail: 'gateway-2060.local', keys: ['TAHOMA_HOST'], ...health },
  ...over,
})

/** Déplié ou non : `v-show` laisse le panneau dans le DOM et le masque par son style. */
const body = (w: ReturnType<typeof mount>) => !(w.find('.plugin__body').attributes('style') ?? '').includes('display: none')

describe('PluginSection — ce qui s’ouvre tout seul', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('reste replié quand le fabricant va bien', () => {
    expect(body(mount(PluginSection, { props: { plugin: plugin() } }))).toBe(false)
  })

  it('s’ouvre de lui-même quand le serveur RÉCLAME quelque chose', () => {
    for (const status of ['needs_pairing', 'error'] as const) {
      expect(body(mount(PluginSection, { props: { plugin: plugin({}, { status }) } }))).toBe(true)
    }
  })

  /** Un fabricant dégradé se plaint sans rien demander : sa ligne le dit, son panneau reste fermé. */
  it('ne s’ouvre pas pour un simple dégradé', () => {
    expect(body(mount(PluginSection, { props: { plugin: plugin({}, { status: 'degraded' }) } }))).toBe(false)
  })

  /** Un plugin éteint ne réclame rien : son statut ne vaut plus qu'on lui ouvre son panneau. */
  it('ne s’ouvre pas tout seul pour un plugin éteint', () => {
    expect(body(mount(PluginSection, { props: { plugin: plugin({ enabled: false }, { status: 'needs_pairing' }) } }))).toBe(false)
  })

  it('laisse le dernier mot à l’utilisateur, dans les deux sens', async () => {
    const opened = mount(PluginSection, { props: { plugin: plugin({}, { status: 'needs_pairing' }) } })
    await opened.find('.plugin__toggle').trigger('click')
    expect(body(opened)).toBe(false)

    const closed = mount(PluginSection, { props: { plugin: plugin() } })
    await closed.find('.plugin__toggle').trigger('click')
    expect(body(closed)).toBe(true)
  })

  /** Un squelette n'a ni détail, ni clé, ni carte : le chevron reste là pour l'alignement, inerte. */
  it('ne se déplie pas quand il n’y a rien dessous', () => {
    const w = mount(PluginSection, { props: { plugin: plugin({ id: 'sonos', implemented: false, enabled: false }, { status: 'not_implemented', detail: undefined, keys: [] }) } })
    expect(w.find('.plugin__toggle').attributes('disabled')).toBeDefined()
    expect(w.find('.plugin__chev').attributes('data-on')).toBe('0')
  })
})
