import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ServerMessage } from '@kasbah/shared'

// Application update: the snapshot carries the identifier of the web build that the server serves.
// A screen left open on a replaced build (the wall tablet, for days on end) no longer finds
// its lazy views and talks to a more recent server: a banner offers to reload, and
// the screen does it by itself after a few minutes without being touched.

const IDLE_RELOAD_MS = 2 * 60_000
const ACTIVITY = ['pointerdown', 'keydown', 'wheel'] as const
/** Build for which we already reloaded by ourselves: if it still differs afterwards, no loop, the banner stays. */
const RELOADED_FOR_KEY = 'kasbah.reloadedForBuild'

export const useAppUpdateStore = defineStore('appUpdate', () => {
  const available = ref(false)
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  function reload() { window.location.reload() }

  function armIdle() {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(reload, IDLE_RELOAD_MS)
  }

  function autoReloadFor(build: string) {
    try {
      if (sessionStorage.getItem(RELOADED_FOR_KEY) === build) return
      sessionStorage.setItem(RELOADED_FOR_KEY, build)
    } catch { return } // without storage, no guard against the loop: the banner alone
    for (const ev of ACTIVITY) window.addEventListener(ev, armIdle, { passive: true })
    armIdle()
  }

  function apply(msg: ServerMessage) {
    // `__KASBAH_BUILD__` is empty in dev: Vite serves the up-to-date app, the server's build is not its own
    if (msg.type !== 'snapshot' || !msg.appBuild || !__KASBAH_BUILD__ || available.value) return
    if (msg.appBuild === __KASBAH_BUILD__) return
    available.value = true
    autoReloadFor(msg.appBuild)
  }

  return { available, reload, apply }
})
