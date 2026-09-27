import { ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { getTransport } from '../api'
import type { AgendaCalendar } from '../api/transport'

// Les agendas de la maison (plugin `agenda`) : partagés entre la vue Agenda et sa carte des
// Réglages, qui les ajoute et les retire. Chaque écriture rend la liste à jour, adoptée telle quelle.

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

  return { calendars, loaded, load, add, update, remove }
})
