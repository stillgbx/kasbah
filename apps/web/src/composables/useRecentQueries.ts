import { useLocalStorage } from '@vueuse/core'
import { computed } from 'vue'

// The recent searches of one music source (YouTube Music, Mixcloud, Radios, Podcasts), remembered in
// this browser — each source has its own list, under `kasbah.<source>.recentQueries` (the key
// YouTube Music already used: its history is kept). The newest first, without duplicates (the case
// is ignored), `max` at most. Shown by `ChipRow` under the source's search.

export function useRecentQueries(source: string, max = 10) {
  const queries = useLocalStorage<string[]>(`kasbah.${source}.recentQueries`, [])

  /** A search was launched: it goes (back) to the front of the list. */
  function remember(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    const key = trimmed.toLowerCase()
    const cur = queries.value
    const idx = cur.findIndex((x) => x.toLowerCase() === key)
    if (idx === 0) return
    if (idx > 0) {
      const copy = [...cur]
      const [hit] = copy.splice(idx, 1)
      queries.value = [hit!, ...copy]
      return
    }
    queries.value = [trimmed, ...cur].slice(0, max)
  }
  function remove(q: string) { queries.value = queries.value.filter((x) => x !== q) }

  /** The list as `ChipRow` takes it. */
  const items = computed(() => queries.value.map((q) => ({ key: q, label: q })))

  return { queries, items, remember, remove }
}
