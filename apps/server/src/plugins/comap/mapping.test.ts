import { describe, expect, it } from 'vitest'
import { STATION_READ } from './__fixtures__/station'
import { modelOf, parseRead, readRequest, toDescriptor, toStatePatch } from './mapping'

describe('comap mapping', () => {
  it('builds the request with the mandatory msgId (a station without it answers null)', () => {
    expect(readRequest(5)).toEqual({ '1234567': { msgId: 5, read: ['status', 'about', 'alert', 'config', 'consumption', 'flow', 'lamp', 'rtc', 'wear'] } })
  })

  it('reads the `read` block regardless of the echoed root key (real capture)', () => {
    const read = parseRead(STATION_READ)
    expect(read).toBeDefined()
    expect(modelOf(read!)).toBe('Proteo V3')
  })

  it('ignores an unexpected shape instead of throwing', () => {
    expect(parseRead(null)).toBeUndefined()
    expect(parseRead({ foo: 'bar' })).toBeUndefined()
    expect(parseRead({ '1234567': { msgId: 5 } })).toBeUndefined()
  })

  it('declares one water device, no command, and no meta.model before the first read', () => {
    const d = toDescriptor()
    expect(d).toMatchObject({ id: 'comap:station', pluginId: 'comap', externalId: 'station', kind: 'water', capabilities: ['consumables', 'water_flow', 'water_usage', 'uv_lamp'], meta: { manufacturer: 'COMAP' } })
    expect(d.meta.model).toBeUndefined()
    expect(toDescriptor('Proteo V3').meta.model).toBe('Proteo V3')
  })

  it('maps the real capture to the water state, and never decodes the D001-D021 alert codes', () => {
    const patch = toStatePatch(parseRead(STATION_READ)!)
    expect(patch).toEqual({
      prefilterPct: 95, carbon1Pct: 95, carbon2Pct: 95, uvLampPct: 96,
      uvOn: true, flowLph: 0, todayL: 412, weekL: 1210, monthL: 6980,
      warning: false, defect: false,
    })
    // `alert` (D001-D021) and `consumption.year` never make it through to the published state
    expect(patch).not.toHaveProperty('alert')
    expect(patch).not.toHaveProperty('year')
  })

  it('never invents a value: a field the station omits stays absent, not zero', () => {
    const patch = toStatePatch({})
    expect(patch).toEqual({})
  })

  it('reads uvOn and warning/defect off zero/one flags', () => {
    expect(toStatePatch({ status: { uvc: 0, warning: 1, defect: 1 } })).toEqual({ uvOn: false, warning: true, defect: true })
  })
})
