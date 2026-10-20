import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Logger } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import {
  MONTHLY_CREDIT_USD, billableKind, countCall, createStateFile, currentCycle, cycleCostUsd, cycleKey, cycleStart, emptyState, teslaStateSchema,
} from './state'

// What the plugin keeps between two startups: the vehicles' last state, and the billing cycle's
// usage. The cycle follows the CALENDAR month, like the vendor's billing.

const SEPT = Date.UTC(2026, 8, 14, 10)
const OCT = Date.UTC(2026, 9, 1, 0, 5)

describe('billing cycle', () => {
  it('the key is the calendar month, in UTC', () => {
    expect(cycleKey(SEPT)).toBe('2026-09')
    expect(cycleKey(OCT)).toBe('2026-10')
    expect(cycleKey(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12')
  })

  it('a new cycle counts nothing', () => {
    const s = emptyState()
    expect(currentCycle(s, SEPT)).toEqual({ month: '2026-09', data: 0, wakes: 0, commands: 0 })
    countCall(s, 'data', SEPT)
    expect(s.cycle).toMatchObject({ month: '2026-09', data: 1 })
  })

  it('the cycle starts on the 1st of the month, not on the account linking day', () => {
    expect(cycleStart('2026-09')).toBe(Date.UTC(2026, 8, 1))
    expect(cycleStart(cycleKey(SEPT))).toBe(Date.UTC(2026, 8, 1))
    expect(cycleStart(cycleKey(OCT))).toBe(Date.UTC(2026, 9, 1))
  })

  it('the month changes: we start again from zero, without touching the past month', () => {
    const s = emptyState()
    countCall(s, 'data', SEPT)
    countCall(s, 'wake', SEPT)
    expect(s.cycle).toMatchObject({ data: 1, wakes: 1 })
    countCall(s, 'data', OCT)
    expect(s.cycle).toEqual({ month: '2026-10', data: 1, wakes: 0, commands: 0 })
  })
})

describe('estimated cost', () => {
  it('the vendor three rates: a read 0.2 ¢, a wake-up 2 ¢, a command 0.1 ¢', () => {
    const s = emptyState()
    for (let i = 0; i < 100; i++) countCall(s, 'data', SEPT)
    expect(cycleCostUsd(s.cycle)).toBeCloseTo(0.2, 3)
    countCall(s, 'wake', SEPT)
    expect(cycleCostUsd(s.cycle)).toBeCloseTo(0.22, 3)
    countCall(s, 'command', SEPT)
    expect(cycleCostUsd(s.cycle)).toBeCloseTo(0.221, 3)
  })

  it('an empty cycle costs nothing, and the monthly credit is the vendor one', () => {
    expect(cycleCostUsd(undefined)).toBe(0)
    expect(MONTHLY_CREDIT_USD).toBe(10)
    // 5000 reads exactly use up the credit: that's the order of magnitude to keep in mind
    const s = emptyState()
    s.cycle = { month: '2026-09', data: 5000, wakes: 0, commands: 0 }
    expect(cycleCostUsd(s.cycle)).toBe(MONTHLY_CREDIT_USD)
  })
})

describe('what is billable', () => {
  it('the vehicle LIST costs nothing: observed on the vendor console', () => {
    // 144 lists per day left only 3 "Data" requests in its billing: polling the sleep state is free,
    // and that's what makes the ten-minute rate sustainable
    expect(billableKind('/api/1/vehicles')).toBeNull()
    expect(billableKind('/api/1/vehicles?page=2')).toBeNull()
  })
  it('the full read is billed, and its path starts like the list one', () => {
    expect(billableKind('/api/1/vehicles/5YJ/vehicle_data?endpoints=charge_state')).toBe('data')
  })
  it('release notes cost nothing: observed on the vendor console', () => {
    expect(billableKind('/api/1/vehicles/5YJ/release_notes?language=fr')).toBeNull()
    expect(billableKind('/api/1/vehicles/5YJ/release_notes?staged=true&language=fr')).toBeNull()
  })
  it('wake-up and commands have their own rate; partner routes touch no vehicle', () => {
    expect(billableKind('/api/1/vehicles/5YJ/wake_up')).toBe('wake')
    expect(billableKind('/api/1/vehicles/5YJ/command/door_lock')).toBe('command')
    expect(billableKind('/api/1/partner_accounts')).toBeNull()
    expect(billableKind('/api/1/users/region')).toBeNull()
  })
})

describe('state file', () => {
  it('a file written by a PREVIOUS version reads back: the vehicle states are lenient', () => {
    const parsed = teslaStateSchema.safeParse({
      cycle: { month: '2026-09', data: 3, since: SEPT },              // `wakes`/`commands` missing, `since` from a previous version
      vehicles: { '5YJ': { soc: 54, champInconnu: 'venu du futur' } },
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data!.cycle).toMatchObject({ wakes: 0, commands: 0 })
    expect(parsed.data!.vehicles['5YJ']).toMatchObject({ soc: 54 })
    expect(parsed.data!.paints).toEqual({})
  })
  it('a file with paints reads back; a file without paints (older version) starts with an empty object', () => {
    const withPaint = teslaStateSchema.safeParse({
      paints: { '5YJ': { color: '#285ac8', finish: 'matte' } },
    })
    expect(withPaint.success).toBe(true)
    expect(withPaint.data!.paints['5YJ']).toEqual({ color: '#285ac8', finish: 'matte' })
    expect(teslaStateSchema.safeParse({ vehicles: {} }).data!.paints).toEqual({})
  })
  it('release notes of ANOTHER shape are forgotten on their own: the month counter and the states survive', () => {
    const file = {
      cycle: { month: '2026-10', data: 81, wakes: 2, commands: 22 },
      vehicles: { VIN1: { soc: 54 } },
      // shape of the first version: one entry per VIN, without language
      releaseNotes: { VIN1: { key: '2026.32.7|2026.38', fetchedAt: 1, history: {} } },
      releaseNotesLangs: 'fr',
    }
    const parsed = teslaStateSchema.parse(file)
    expect(parsed.cycle).toEqual(file.cycle)
    expect(parsed.vehicles).toEqual(file.vehicles)
    expect(parsed.releaseNotes).toEqual({})
    expect(parsed.releaseNotesLangs).toEqual([])
  })

  it('an empty file or one of another shape is rejected cleanly', () => {
    expect(teslaStateSchema.safeParse({}).success).toBe(true)          // no cycle, no vehicle: fresh state
    expect(teslaStateSchema.safeParse({ vehicles: 'non' }).success).toBe(false)
  })
})

describe('state file', () => {
  it('close writes do not trip over each other, and the last one wins', async () => {
    // Seen at startup on 2026-10-01: two `persist()` calls without waiting shared the same `.tmp`,
    // the second `rename` failed with ENOENT. The race depends on the disk: two writes don't
    // reliably trigger it here (0 out of 20), ten do (20 out of 20).
    const path = join(await mkdtemp(join(tmpdir(), 'kasbah-tesla-')), 'tesla-state.json')
    const warn = vi.fn()
    const store = createStateFile(path, { warn } as unknown as Logger)
    const states = Array.from({ length: 10 }, (_, i) => {
      const s = emptyState()
      for (let n = 0; n <= i; n++) countCall(s, 'data', SEPT)
      return s
    })
    await Promise.all(states.map((s) => store.save(s)))
    expect(warn).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(states.at(-1))
  })
})
