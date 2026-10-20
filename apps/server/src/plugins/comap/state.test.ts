import { describe, expect, it } from 'vitest'
import { comapHistorySchema, EMPTY_HISTORY } from './state'

describe('comap state: persistence schema', () => {
  it('an empty history (never polled) reads back', () => {
    expect(comapHistorySchema.safeParse(EMPTY_HISTORY).success).toBe(true)
  })

  it('a well-formed file reads back with its points', () => {
    const parsed = comapHistorySchema.safeParse({
      hourly: [{ t: 1_000, litres: 4 }],
      daily: [{ t: 2_000, litres: 68 }],
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ hourly: [{ t: 1_000, litres: 4 }], daily: [{ t: 2_000, litres: 68 }] })
  })

  it('an unexpected shape is rejected cleanly (corrupted file or from another version)', () => {
    expect(comapHistorySchema.safeParse({}).success).toBe(false)          // hourly/daily required
    expect(comapHistorySchema.safeParse({ hourly: 'non', daily: [] }).success).toBe(false)
    expect(comapHistorySchema.safeParse({ hourly: [{ t: 1, litres: -1 }], daily: [] }).success).toBe(false) // never a negative volume
  })
})
