import { describe, expect, it } from 'vitest'
import { geoToLocal } from '@kasbah/shared'
import { offsetLocation } from './map'

// A mower's offset is written in meters in the HOUSE frame (rotated by the heading of
// the origin): it is this frame that the user reads in the scene, and it is what the map
// must apply, not due-north meters.

describe('offsetLocation', () => {
  const origin = { lat: 47.3093430, lon: 5.0455910, alt: 180, heading: 6 }
  const raw = { lat: 47.3092765, lon: 5.0458869 }

  it('moves the point by the requested offset, measured in the house frame', () => {
    const before = geoToLocal(origin, raw)
    const after = geoToLocal(origin, offsetLocation(origin, raw, [-7.7, 10.4]))
    expect(after[0] - before[0]).toBeCloseTo(-7.7, 3)
    expect(after[1] - before[1]).toBeCloseTo(10.4, 3)
  })

  it('a zero offset returns the point as is', () => {
    const same = offsetLocation(origin, raw, [0, 0])
    expect(same.lat).toBeCloseTo(raw.lat, 9)
    expect(same.lon).toBeCloseTo(raw.lon, 9)
  })
})
