import { describe, expect, it } from 'vitest'
import { geoToLocal } from '@kasbah/shared'
import { offsetLocation } from './map'

// Le décalage d'une tondeuse s'écrit en mètres dans le repère de la MAISON (tourné du cap de
// l'origine) : c'est ce repère que l'utilisateur lit dans la scène, et c'est lui que la carte
// doit appliquer, pas des mètres plein nord.

describe('offsetLocation', () => {
  const origin = { lat: 47.3093430, lon: 5.0455910, alt: 180, heading: 6 }
  const raw = { lat: 47.3092765, lon: 5.0458869 }

  it('déplace le point du décalage demandé, mesuré dans le repère de la maison', () => {
    const before = geoToLocal(origin, raw)
    const after = geoToLocal(origin, offsetLocation(origin, raw, [-7.7, 10.4]))
    expect(after[0] - before[0]).toBeCloseTo(-7.7, 3)
    expect(after[1] - before[1]).toBeCloseTo(10.4, 3)
  })

  it('un décalage nul rend le point tel quel', () => {
    const same = offsetLocation(origin, raw, [0, 0])
    expect(same.lat).toBeCloseTo(raw.lat, 9)
    expect(same.lon).toBeCloseTo(raw.lon, 9)
  })
})
