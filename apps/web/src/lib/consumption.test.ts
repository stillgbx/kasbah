import { describe, expect, it } from 'vitest'
import { frenchAverageDailyLitres, frenchAverageReference } from './consumption'

// Repère de consommation moyenne française (SISPEA 2023, 145 L/personne/jour) : fonctions pures,
// couvertes indépendamment du graphique qui les affiche (voir WaterConsumptionChart.vue).

describe('frenchAverageDailyLitres', () => {
  it('multiplie 145 L par le nombre de personnes', () => {
    expect(frenchAverageDailyLitres(1)).toBe(145)
    expect(frenchAverageDailyLitres(3)).toBe(435)
    expect(frenchAverageDailyLitres(10)).toBe(1450)
  })
})

describe('frenchAverageReference', () => {
  it("jour : jamais de repère par barre — une heure ne consomme pas une part fixe du jour", () => {
    expect(frenchAverageReference('day', 3)).toBeNull()
  })

  it('semaine et mois : le même repère plat', () => {
    expect(frenchAverageReference('week', 3)).toBe(435)
    expect(frenchAverageReference('month', 3)).toBe(435)
    expect(frenchAverageReference('week', 3)).toBe(frenchAverageReference('month', 3))
  })

  it('année : une DROITE, N × 145 × 30,44 j (durée moyenne du mois) — février est un mois comme les autres, plus d\'escalier suivant le nombre de jours réel du mois', () => {
    expect(frenchAverageReference('year', 3)).toBeCloseTo(435 * 30.44, 5)
  })

  it('le repère grandit avec le foyer, jamais négatif ni nul pour un foyer déclaré', () => {
    expect(frenchAverageReference('month', 1)).toBeLessThan(frenchAverageReference('month', 5)!)
  })
})
