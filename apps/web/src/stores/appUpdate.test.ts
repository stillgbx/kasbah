import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ServerMessage } from '@kasbah/shared'
import { useAppUpdateStore } from './appUpdate'

// `__KASBAH_BUILD__` vaut 'test-build' sous vitest (`vitest.config.ts`).
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

  it('ne propose rien quand le serveur sert le même build, ou n en annonce aucun', () => {
    const update = useAppUpdateStore()
    update.apply(snapshot('test-build'))
    update.apply(snapshot())
    expect(update.available).toBe(false)
  })

  it('propose de recharger sur un autre build, et recharge seul après deux minutes sans interaction', () => {
    const update = useAppUpdateStore()
    update.apply(snapshot('build-2'))
    expect(update.available).toBe(true)

    vi.advanceTimersByTime(90_000)
    window.dispatchEvent(new Event('pointerdown'))       // on touche l'écran : le délai repart
    vi.advanceTimersByTime(90_000)
    expect(reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(30_000)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('après un rechargement automatique qui n a pas suffi, garde le bandeau sans boucler', () => {
    sessionStorage.setItem('kasbah.reloadedForBuild', 'build-2')
    const update = useAppUpdateStore()
    update.apply(snapshot('build-2'))
    expect(update.available).toBe(true)
    vi.advanceTimersByTime(10 * 60_000)
    expect(reload).not.toHaveBeenCalled()
  })
})
