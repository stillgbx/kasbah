import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ServerMessage } from '@kasbah/shared'
import { useAppUpdateStore } from './appUpdate'

// `__KASBAH_BUILD__` is 'test-build' under vitest (`vitest.config.ts`).
const snapshot = (appBuild?: string): ServerMessage => ({ type: 'snapshot', serverTime: 0, devices: [], scenes: [], automations: [], ...(appBuild ? { appBuild } : {}) })

describe('appUpdate store', () => {
  let reload: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    vi.useFakeTimers()
    reload = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload } as Location)
  })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('offers nothing when the server serves the same build, or announces none', () => {
    const update = useAppUpdateStore()
    update.apply(snapshot('test-build'))
    update.apply(snapshot())
    expect(update.available).toBe(false)
  })

  it('offers to reload on another build, and reloads by itself after two minutes without interaction', () => {
    const update = useAppUpdateStore()
    update.apply(snapshot('build-2'))
    expect(update.available).toBe(true)

    vi.advanceTimersByTime(90_000)
    window.dispatchEvent(new Event('pointerdown'))       // the screen is touched: the delay restarts
    vi.advanceTimersByTime(90_000)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('after an automatic reload that was not enough, keeps the banner without looping', () => {
    sessionStorage.setItem('kasbah.reloadedForBuild', 'build-2')
    const update = useAppUpdateStore()
    update.apply(snapshot('build-2'))
    expect(update.available).toBe(true)
    vi.advanceTimersByTime(10 * 60_000)
    expect(reload).not.toHaveBeenCalled()
  })
})
