import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ServerMessage } from '@kasbah/shared'

// Mise à jour de l'application : le snapshot porte l'identifiant du build web que le serveur sert.
// Un écran resté ouvert sur un build remplacé (la tablette murale, des jours durant) ne trouve plus
// ses vues paresseuses et parle à un serveur plus récent : un bandeau propose de recharger, et
// l'écran le fait seul après quelques minutes sans qu'on le touche.

const IDLE_RELOAD_MS = 2 * 60_000
const ACTIVITY = ['pointerdown', 'keydown', 'wheel'] as const
/** Build pour lequel on a déjà rechargé seul : s'il diffère encore après, pas de boucle, le bandeau reste. */
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
    } catch { return } // sans stockage, pas de garde contre la boucle : le bandeau seul
    for (const ev of ACTIVITY) window.addEventListener(ev, armIdle, { passive: true })
    armIdle()
  }

  function apply(msg: ServerMessage) {
    // `__KASBAH_BUILD__` vide en dev : Vite sert l'app à jour, le build du serveur n'est pas le sien
    if (msg.type !== 'snapshot' || !msg.appBuild || !__KASBAH_BUILD__ || available.value) return
    if (msg.appBuild === __KASBAH_BUILD__) return
    available.value = true
    autoReloadFor(msg.appBuild)
  }

  return { available, reload, apply }
})
