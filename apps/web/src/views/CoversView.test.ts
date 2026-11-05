import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Capability, DeviceEntry, StateFor } from '@kasbah/shared'
import { useDevicesStore } from '../stores/devices'
import CoversView from './CoversView.vue'

const shutter = (id: string, name: string, capabilities: Capability[]): DeviceEntry => ({
  descriptor: { id, pluginId: 'tahoma', externalId: id, kind: 'cover', name, capabilities, meta: { cover: { deviceClass: 'shutter' } } },
  state: { kind: 'cover', updatedAt: 1, available: true, position: 100, motion: 'stopped' } as StateFor<'cover'>,
})

describe('CoversView', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  // A calibratable shutter once lost its maneuver keys: its calibration button, slipped in between the
  // `v-if` of the opening selector and the `v-else` of the keys, had taken the `v-else` for itself.
  it('keeps the maneuver keys of a calibratable shutter, and puts the tools in the same place on every row', () => {
    useDevicesStore().setEntries([
      shutter('tahoma:a', 'Volet A', ['open_close', 'position', 'stop', 'calibration']),
      shutter('tahoma:b', 'Volet B', ['open_close', 'position', 'stop']),
    ])
    const w = mount(CoversView, { global: { stubs: { PageHeader: true } } })
    const rows = w.findAll('.row')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.find('.controls').exists()).toBe(true)
      expect(row.findAll('.controls .key').length).toBeGreaterThanOrEqual(3)        // open · stop · close
      // calibration (or its reserved place) first, the location pin last
      const tools = row.find('.row__end').element.children
      expect(tools).toHaveLength(2)
      expect(tools[0]!.classList.contains('tool')).toBe(true)
      expect(tools[1]!.classList.contains('badge')).toBe(true)
    }
    const [a, b] = rows
    expect(a!.find('.row__end .tool').element.tagName).toBe('BUTTON')
    expect(b!.find('.row__end .tool').classes()).toContain('tool--empty')
  })
})
