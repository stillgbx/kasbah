import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AutomationRun } from '@kasbah/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRunsFile } from './runs'

describe('automation runs file', () => {
  let dir: string
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'kasbah-runs-')) })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('reads an absent file as empty, then round-trips', async () => {
    const path = join(dir, 'automation-runs.json')
    const store = createRunsFile(path)
    expect(await store.load()).toEqual({})
    const run: AutomationRun = { at: 1_000, by: 'manual', outcome: 'ok', errors: [] }
    await store.save({ r: run })
    expect(await store.load()).toEqual({ r: run })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ runs: { r: run } })
  })

  it('rejects an invalid file (the engine ignores it)', async () => {
    const path = join(dir, 'automation-runs.json')
    await writeFile(path, JSON.stringify({ runs: { r: { at: 'hier' } } }))
    await expect(createRunsFile(path).load()).rejects.toThrow()
  })
})
