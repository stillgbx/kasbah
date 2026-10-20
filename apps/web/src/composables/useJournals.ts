import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import type { JournalEntry } from '@kasbah/shared'
import { getTransport } from '../api'

/**
 * The LOGS of the requested devices (`journal` capability), served on demand by the server
 * (`GET /api/devices/:id/journal`), which keeps them up to date itself through the vendor's stream:
 * re-requesting them every half minute only costs a local request. A failure keeps the previous log;
 * a device that leaves the list keeps its own in memory, without being re-requested.
 *
 * Two surfaces use them: the Robots view (one log per robot) and the selected device's
 * panel (just one).
 */
export function useJournals(ids: Ref<readonly string[]>) {
  const journals = ref<Record<string, JournalEntry[]>>({})
  let timer: ReturnType<typeof setInterval> | null = null

  async function reload(): Promise<void> {
    for (const id of ids.value) {
      try { journals.value = { ...journals.value, [id]: (await getTransport().getJournal(id)).entries } }
      catch { /* the previous log stays displayed */ }
    }
  }

  onMounted(() => {
    void reload()
    timer = setInterval(() => { void reload() }, 30_000)
  })
  onBeforeUnmount(() => { if (timer) clearInterval(timer) })
  // the list changes (a robot arrives, the selected device changes): we read right away
  watch(() => ids.value.join('|'), () => { void reload() })

  return { journals, reload }
}
