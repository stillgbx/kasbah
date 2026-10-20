import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

// A plugin built with its default configuration writes into `apps/server/.state` — including
// under vitest: a test that calls `plugin.init()` without a store stub LOADS the real state, adds
// its fixtures to it and writes it back (seen on 2026-09-18 on `comap-consumption.json` and
// `melcloud-history.json`). This file, loaded before each test file, moves the folder.
const dir = join(tmpdir(), 'kasbah-test-state', String(process.pid))
process.env.KASBAH_STATE_DIR = dir

// Plugin saves are "fire and forget": a write may still be in flight here, and its `rename`
// would fail into the void — that is exactly what left `.tmp` files behind, now in a throwaway
// folder.
afterAll(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }) })
