import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { getTransport } from '../api'
import type { AgendaCalendar } from '../api/transport'

// The house's calendars (`agenda` plugin): shared between the Calendar view and its Settings
// card, which adds, orders and removes them. Each write returns the up-to-date list, adopted as is.

export const useAgendaStore = defineStore('agenda', () => {
  const calendars = shallowRef<AgendaCalendar[]>([])
  const loaded = ref(false)

  async function load(): Promise<void> {
    try { calendars.value = (await getTransport().agendaCalendars()).calendars }
    finally { loaded.value = true }
  }
  async function add(body: { url: string; name?: string }): Promise<void> {
    calendars.value = (await getTransport().agendaAddCalendar(body)).calendars
  }
  async function update(id: string, patch: { name?: string; color?: string }): Promise<void> {
    calendars.value = (await getTransport().agendaUpdateCalendar(id, patch)).calendars
  }
  async function remove(id: string): Promise<void> {
    calendars.value = (await getTransport().agendaRemoveCalendar(id)).calendars
  }
  async function reorder(ids: string[]): Promise<void> {
    calendars.value = (await getTransport().agendaReorderCalendars(ids)).calendars
  }

  return { calendars, loaded, load, add, update, remove, reorder }
})
