import { describe, expect, it } from 'vitest'
import { mergeResults, photonLabel } from './geocode'

// Recherche d'adresse : l'IGN devant, Photon en complément, un lieu une seule fois.

describe('geocode', () => {
  it('un libellé Photon lisible, sans répétition', () => {
    expect(photonLabel({ housenumber: '10', street: 'Downing Street', postcode: 'SW1A 2AA', city: 'London', country: 'Royaume-Uni' }))
      .toBe('10 Downing Street, SW1A 2AA London, Royaume-Uni')
    expect(photonLabel({ name: 'Plaza Mayor', street: 'Plaza Mayor', city: 'Madrid', country: 'Espagne' })).toBe('Plaza Mayor, Madrid, Espagne')
    expect(photonLabel({ name: 'Parc', city: 'Lyon' })).toBe('Parc, Lyon')
  })

  it('l’IGN passe devant, Photon complète sans redonner un lieu déjà là (30 m), six au plus', () => {
    const ign = [{ label: 'Place A (IGN)', lat: 48.8656, lon: 2.3212 }]
    const photon = [
      { label: 'Place A (OSM)', lat: 48.8657, lon: 2.3213 },          // ~13 m : le même lieu
      ...Array.from({ length: 7 }, (_, i) => ({ label: `Ailleurs ${i}`, lat: 40 + i, lon: 3 })),
    ]
    const out = mergeResults(ign, photon)
    expect(out[0]!.label).toBe('Place A (IGN)')
    expect(out.some((r) => r.label === 'Place A (OSM)')).toBe(false)
    expect(out).toHaveLength(6)
    expect(mergeResults([], photon.slice(1, 3)).map((r) => r.label)).toEqual(['Ailleurs 0', 'Ailleurs 1'])
  })

  it('l’IGN fait foi en France : les résultats français de Photon s’effacent, pas ceux d’ailleurs', () => {
    const ign = [{ label: 'Place B 75008 Paris', lat: 48.8656, lon: 2.3212 }]
    const photon = [
      { label: 'Place B, 75008 Paris, France', lat: 48.8662, lon: 2.3226, countryCode: 'FR' },   // ~120 m, même place
      { label: 'Place B, Bruxelles, Belgique', lat: 50.84, lon: 4.35, countryCode: 'BE' },
    ]
    expect(mergeResults(ign, photon).map((r) => r.label)).toEqual(['Place B 75008 Paris', 'Place B, Bruxelles, Belgique'])
    expect(mergeResults([], photon.slice(0, 1)).map((r) => r.label)).toEqual(['Place B, 75008 Paris, France'])   // IGN muet : Photon suffit
  })
})
