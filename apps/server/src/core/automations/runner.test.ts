import type { Automation, PushMessage } from '@kasbah/shared'
import { describe, expect, it } from 'vitest'
import type { EvalContext } from './context'
import { runActions, type RunnerDeps } from './runner'

const rule = (message: string): Automation => ({
  id: 'gate', name: 'Portail resté ouvert', enabled: true, unless: [],
  trigger: { type: 'time', at: { kind: 'clock', time: '22:00' } },
  actions: [{ type: 'notify', message }],
})
const ctx = { now: 1000 } as EvalContext
const base: Omit<RunnerDeps, 'push'> = {
  host: { execute: async () => {}, recallScene: async () => {} },
  scenes: { get: () => undefined },
}

describe('runActions — notify', () => {
  it('sends the message to the automations category, titled with the rule', async () => {
    const sent: { category: string; message: PushMessage }[] = []
    const push = { send: async (category: 'automations', render: (lang: 'fr') => PushMessage) => { sent.push({ category, message: render('fr') }); return { sent: 0, failed: 0 } } }
    const { run } = await runActions(rule('Le portail est encore ouvert'), 'time', ctx, { ...base, push } as RunnerDeps)
    // nobody subscribed is not a failure
    expect(run.outcome).toBe('ok')
    expect(sent).toEqual([{ category: 'automations', message: { title: 'Portail resté ouvert', body: 'Le portail est encore ouvert', tag: 'automation|gate', url: '/' } }])
  })

  it('fails when no screen received it', async () => {
    const push = { send: async () => ({ sent: 0, failed: 2 }) }
    const { run } = await runActions(rule('x'), 'manual', ctx, { ...base, push })
    expect(run).toMatchObject({ outcome: 'failed', errors: [{ action: 0, code: 'UPSTREAM_ERROR' }] })
  })
})
