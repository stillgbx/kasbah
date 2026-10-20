import { ref } from 'vue'
import { defineStore } from 'pinia'

export interface Notification { id: number; text: string; color: 'error' | 'warning' | 'success' | 'info'; timeout: number }

/** Toast queue (rendered by App.vue). A command error, a successful pairing, etc. */
export const useNotificationsStore = defineStore('notifications', () => {
  const queue = ref<Notification[]>([])
  let seq = 0
  function notify(text: string, color: Notification['color'] = 'info', timeout = 4000) {
    queue.value = [...queue.value, { id: ++seq, text, color, timeout }]
  }
  function dismiss(id: number) { queue.value = queue.value.filter((n) => n.id !== id) }
  return { queue, notify, dismiss, error: (t: string) => notify(t, 'error', 6000), success: (t: string) => notify(t, 'success') }
})
