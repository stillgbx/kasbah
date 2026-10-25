import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { setTransport } from '../api'
import type { EnphaseTokenStatus, Transport } from '../api/transport'
import { useDevicesStore } from '../stores/devices'
import EnphasePairingCard from './EnphasePairingCard.vue'

// The production history at the foot of the Enphase card: where it stands, and "Resync", which
// only works with the account linked (a pasted token does not open the cloud).

const base: EnphaseTokenStatus = {
  paired: true, host: 'envoy.local', stage: 'ok', renewUnderDays: 30, tokenFile: '.state/enphase-token.json',
  cloudLinked: true, cloudFile: '.state/enphase-cloud.json',
  history: { syncedAt: null, since: null, days: 0, syncing: false, error: null },
}

function fake(status: EnphaseTokenStatus) {
  const synced: EnphaseTokenStatus = { ...status, history: { syncedAt: Date.UTC(2026, 9, 25, 10), since: Date.UTC(2025, 5, 1), days: 300, syncing: false, error: null } }
  // after a resync the server serves the synced state: the card reads it again to follow the inverters
  let current = status
  const syncEnphaseHistory = vi.fn(async () => { current = synced; return synced })
  setTransport({ enphaseTokenStatus: async () => current, syncEnphaseHistory } as unknown as Transport)
  return syncEnphaseHistory
}

async function card() {
  useDevicesStore().health = { plugins: { enphase: { status: 'ok' } } } as unknown as ReturnType<typeof useDevicesStore>['health']
  const w = mount(EnphasePairingCard)
  await flushPromises()
  return w
}

const resync = (w: Awaited<ReturnType<typeof card>>) => w.findAll('button').find((b) => b.text() === 'Resynchroniser')!

describe('EnphasePairingCard — history', () => {
  beforeEach(() => { setActivePinia(createPinia()) })
  afterEach(() => { setTransport(null) })

  it('says the history was never fetched, and Resync fetches it', async () => {
    const sync = fake(base)
    const w = await card()
    expect(w.find('.enp__history').text()).toContain("L'historique d'Enphase n'a pas encore été récupéré")
    await resync(w).trigger('click')
    await flushPromises()
    expect(sync).toHaveBeenCalledOnce()
    expect(w.find('.enp__history').text()).toContain('300 jours depuis le')
  })

  it('without the account, the button is greyed and the card says why', async () => {
    fake({ ...base, cloudLinked: false })
    const w = await card()
    expect(resync(w).attributes('disabled')).toBeDefined()
    expect(w.find('.enp__history').text()).toContain('un jeton collé n\'ouvre pas le cloud')
  })

  it('draws a cell per day and takes again only the incomplete ones, or every one with "Tout reprendre"', async () => {
    const sync = fake({ ...base, history: { ...base.history, syncedAt: 1, coverage: { from: new Date(2026, 9, 29).getTime(), days: 'ccpm' } } })
    const w = await card()
    expect(w.findAll('.strip__days .strip__day').map((c) => c.attributes('data-s'))).toEqual(['c', 'c', 'p', 'm'])
    expect(w.findAll('.strip__row')).toHaveLength(2)   // 29-31 October, then 1 November
    expect(w.find('.enp__history').text()).toContain('Reprendra 2 jours incomplets.')
    await w.find('.enp__force input').setValue(true)
    expect(w.find('.enp__history').text()).toContain('Reprendra les 4 jours.')
    await resync(w).trigger('click')
    await flushPromises()
    expect(sync).toHaveBeenCalledWith(true)
  })

  it('every day complete: nothing to take again, unless forced', async () => {
    fake({ ...base, history: { ...base.history, syncedAt: 1, coverage: { from: new Date(2026, 9, 1).getTime(), days: 'ccc' } } })
    const w = await card()
    expect(w.find('.enp__history').text()).toContain('Tous les jours sont complets')
    expect(resync(w).attributes('disabled')).toBeDefined()
    await w.find('.enp__force input').setValue(true)
    expect(resync(w).attributes('disabled')).toBeUndefined()
  })

  it('a failed attempt is told on its reserved line', async () => {
    fake({ ...base, history: { ...base.history, error: 'Enlighten unreachable' } })
    const w = await card()
    const warn = w.find('.enp__history .enp__warn')
    expect(warn.attributes('data-on')).toBe('1')
    expect(warn.text()).toContain('Enlighten unreachable')
  })
})
