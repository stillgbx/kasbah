import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { grants, type Right, type ServerMessage } from '@kasbah/shared'
import { getTransport } from '../api'

// The account of this screen and its rights (`GET /api/session`): the app hides the views and
// settings the account may not use. The server refuses them anyway (`http/rights.ts`): this is
// only so that nothing shows that would answer "no right".

export const useSessionStore = defineStore('session', () => {
  /** The session's account, under the public address; `null` on the local network. */
  const user = ref<string | null>(null)
  /** The account's rights; `undefined` = all of them (local network, account without a list). */
  const rights = shallowRef<readonly Right[] | undefined>(undefined)

  async function refresh() {
    try {
      const s = await getTransport().session()
      user.value = s.user
      rights.value = s.rights
    } catch { /* kept as they were: the server still refuses what it must */ }
  }

  let first: Promise<void> | null = null
  /** Read once before the first view (`router`); later changes come with a snapshot. */
  const ready = () => (first ??= refresh())

  const may = (right: Right | null) => grants(rights.value, right)

  // The server sends a new snapshot when the account's rights change (`ws/hub.ts`). The first one
  // follows `ready()`, nothing to read again.
  let snapshots = 0
  function apply(msg: ServerMessage) {
    if (msg.type === 'snapshot' && snapshots++ > 0) void refresh()
  }

  return { user, rights, ready, may, apply }
})
