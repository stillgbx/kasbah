import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { getTransport } from '../api'
import type { SchoolData, SchoolFilters } from '../api/transport'

// L'école (plugin `toutemonannee`) : partagée entre la vue École et la carte de liaison des
// Réglages. Le serveur rend toujours l'ensemble à jour, adopté tel quel ; seuls les filtres et la
// case « fait » s'affichent avant sa réponse (et reviennent en arrière s'il refuse).

export const useSchoolStore = defineStore('school', () => {
  const data = shallowRef<SchoolData | null>(null)
  const loaded = ref(false)
  /** Le plugin ne répond pas (inactif, ou serveur injoignable). */
  const unavailable = ref(false)
  /** Devoirs dont la case attend la réponse du serveur (celle du site peut prendre une seconde). */
  const pending = ref<Set<number>>(new Set())

  const adopt = (d: SchoolData) => { data.value = d; unavailable.value = false }

  async function load(): Promise<void> {
    try { adopt(await getTransport().schoolData()) }
    catch { unavailable.value = true }
    finally { loaded.value = true }
  }
  async function login(username: string, password: string) { adopt(await getTransport().schoolLogin({ username, password })) }
  async function logout() { adopt(await getTransport().schoolLogout()) }
  async function refresh() { adopt(await getTransport().schoolRefresh()) }

  async function setDone(journalId: string, id: number, done: boolean): Promise<void> {
    const before = data.value
    if (!before || pending.value.has(id)) return
    data.value = { ...before, homework: before.homework.map((h) => (h.id === id ? { ...h, done } : h)) }
    pending.value = new Set([...pending.value, id])
    try { adopt(await getTransport().schoolSetDone(journalId, id, done)) }
    catch (err) { data.value = before; throw err }
    finally { pending.value = new Set([...pending.value].filter((x) => x !== id)) }
  }

  async function setFilters(filters: SchoolFilters): Promise<void> {
    const before = data.value
    if (!before) return
    data.value = { ...before, filters }
    try { adopt(await getTransport().schoolSetFilters(filters)) }
    catch (err) { data.value = before; throw err }
  }

  async function seenPosts(): Promise<void> {
    const top = Math.max(0, ...(data.value?.posts ?? []).map((p) => p.id))
    if (!data.value || top <= data.value.postsSeen) return
    adopt(await getTransport().schoolSeenPosts(top))
  }

  const linked = computed(() => data.value?.linked === true)

  return { data, loaded, unavailable, pending, linked, load, login, logout, refresh, setDone, setFilters, seenPosts }
})
