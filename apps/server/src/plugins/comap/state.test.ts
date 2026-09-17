import { describe, expect, it } from 'vitest'
import { comapHistorySchema, EMPTY_HISTORY } from './state'

describe('comap state: schéma de persistance', () => {
  it('un historique vide (jamais sondé) se relit', () => {
    expect(comapHistorySchema.safeParse(EMPTY_HISTORY).success).toBe(true)
  })

  it('un fichier bien formé se relit avec ses points', () => {
    const parsed = comapHistorySchema.safeParse({
      hourly: [{ t: 1_000, litres: 4 }],
      daily: [{ t: 2_000, litres: 68 }],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ hourly: [{ t: 1_000, litres: 4 }], daily: [{ t: 2_000, litres: 68 }] })
  })

  it('une forme inattendue est rejetée proprement (fichier corrompu ou d\'une autre version)', () => {
    expect(comapHistorySchema.safeParse({}).success).toBe(false)          // hourly/daily obligatoires
    expect(comapHistorySchema.safeParse({ hourly: 'non', daily: [] }).success).toBe(false)
    expect(comapHistorySchema.safeParse({ hourly: [{ t: 1, litres: -1 }], daily: [] }).success).toBe(false) // jamais un volume négatif
  })
})
