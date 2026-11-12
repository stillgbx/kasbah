import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { Capability, DeviceDescriptor, StateFor } from '@kasbah/shared'
import WindowControl from './WindowControl.vue'
import fr from '../../i18n/locales/fr.json'

const descriptor = (capabilities: Capability[]): DeviceDescriptor => ({
  id: 'tahoma:w', pluginId: 'tahoma', externalId: 'w', kind: 'window', name: 'Velux', capabilities, meta: {},
})
const state = (over: Partial<StateFor<'window'>> = {}): StateFor<'window'> =>
  ({ kind: 'window', updatedAt: 0, available: true, position: 0, motion: 'stopped', ...over })

describe('WindowControl', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('speaks in OPENING and sends the window commands', async () => {
    const w = mount(WindowControl, { props: { descriptor: descriptor(['open_close', 'position', 'quiet']), state: state({ position: 30 }) } })
    expect(w.text()).toContain('30 %')
    const keys = w.findAll('button.key')
    // a Velux driven through its box declares no stop: no key that would do nothing
    expect(keys.map((k) => k.text())).toEqual([fr.window.actionOpen, fr.window.actionClose])
    await keys[0]!.trigger('click')
    await keys[1]!.trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'window.open' }], [{ type: 'window.close' }]])
  })

  it('offers stop when the device declares it, and reads a closed window as closed', () => {
    const w = mount(WindowControl, { props: { descriptor: descriptor(['open_close', 'position', 'stop']), state: state() } })
    expect(w.findAll('button.key').map((k) => k.text())).toContain(fr.common.stop)
    expect(w.text()).toContain(fr.window.closed)
  })
})
