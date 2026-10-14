import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import type { Capability, DeviceDescriptor, StateFor } from '@kasbah/shared'
import MowerControl from './MowerControl.vue'

const descriptor = (capabilities: Capability[]): DeviceDescriptor => ({
  id: 'automower:m', pluginId: 'automower', externalId: 'm', kind: 'mower', name: 'Tondeuse', capabilities, meta: {},
})
const state = (over: Partial<StateFor<'mower'>> = {}): StateFor<'mower'> =>
  ({ kind: 'mower', updatedAt: 0, available: true, activity: 'paused', battery: 80, ...over })

const ALL: Capability[] = ['mow', 'park', 'battery', 'schedule', 'confirm_error']
const ERROR = { activity: 'error' as const, errorCode: 18, errorMessage: 'Collision sensor problem, rear' }
const button = (w: ReturnType<typeof mount>, label: string) => w.findAll('button').find((b) => b.text().includes(label))

describe('MowerControl', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('« Reprendre le programme » envoie un départ SANS durée ; absent sans planning', async () => {
    const w = mount(MowerControl, { props: { descriptor: descriptor(ALL), state: state() } })
    await button(w, 'Reprendre le programme')!.trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'mower.start' }]])
    expect(button(mount(MowerControl, { props: { descriptor: descriptor(['mow', 'park', 'battery']), state: state() } }), 'Reprendre le programme')).toBeUndefined()
  })

  it("« Effacer l'erreur » seulement pour une erreur que le fabricant lève à distance", async () => {
    expect(button(mount(MowerControl, { props: { descriptor: descriptor(ALL), state: state({ ...ERROR, errorConfirmable: false }) } }), "Effacer l'erreur")).toBeUndefined()
    expect(button(mount(MowerControl, { props: { descriptor: descriptor(['mow', 'park', 'battery', 'schedule']), state: state({ ...ERROR, errorConfirmable: true }) } }), "Effacer l'erreur")).toBeUndefined()
    const w = mount(MowerControl, { props: { descriptor: descriptor(ALL), state: state({ ...ERROR, errorConfirmable: true }) } })
    await button(w, "Effacer l'erreur")!.trigger('click')
    expect(w.emitted('command')).toEqual([[{ type: 'mower.confirm_error' }]])
  })
})
