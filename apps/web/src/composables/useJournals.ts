import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { JournalEntry } from '@kasbah/shared'
import { getTransport } from '../api'

/**
 * Les JOURNAUX des appareils demandés (capacité `journal`), servis à la demande par le serveur
 * (`GET /api/devices/:id/journal`), qui les tient à jour lui-même par le flux du fabricant : les
 * redemander à chaque demi-minute ne coûte qu'une requête locale. Un échec garde le journal d'avant ;
 * un appareil qui quitte la liste garde le sien en mémoire, sans être redemandé.
 *
 * Deux surfaces s'en servent : la vue Robots (un journal par robot) et le panneau de l'appareil
 * sélectionné (un seul).
 */
export function useJournals(ids: Ref<readonly string[]>) {
  const journals = ref<Record<string, JournalEntry[]>>({})
  let timer: ReturnType<typeof setInterval> | null = null

  async function reload(): Promise<void> {
    for (const id of ids.value) {
      try { journals.value = { ...journals.value, [id]: (await getTransport().getJournal(id)).entries } }
      catch { /* le journal d'avant reste affiché */ }
    }
  }

  onMounted(() => {
    void reload()
    timer = setInterval(() => { void reload() }, 30_000)
  })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  // la liste change (un robot arrive, l'appareil sélectionné change) : on lit tout de suite
  watch(() => ids.value.join('|'), () => { void reload() })

  return { journals, reload }
}
