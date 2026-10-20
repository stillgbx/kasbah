import { ref } from 'vue'
import { getTransport } from '../api'
import { ApiRequestError, type AssistantEvent } from '../api/transport'

// An instruction passed to the assistant (`claude -p` on the server, which acts through the MCP tools):
// what it does, as it goes, then its answer. One instruction at a time; the next one erases the
// previous, with no memory from one to the other.

export interface AssistantAction {
  id: string
  /** MCP tool, without prefix (`send_command`, `play_radio`…). */
  name: string
  input: unknown
  /** `undefined` until the tool has answered. */
  ok?: boolean
}

export type AssistantPhase = 'idle' | 'running' | 'done' | 'error'

export function useAssistant() {
  const phase = ref<AssistantPhase>('idle')
  /** The current instruction or the last one. */
  const asked = ref('')
  const actions = ref<AssistantAction[]>([])
  const answer = ref('')
  const error = ref<{ code: string; message: string } | null>(null)
  let abort: AbortController | null = null

  function apply(e: AssistantEvent) {
    if (e.type === 'text') answer.value = answer.value ? `${answer.value}\n${e.text}` : e.text
    else if (e.type === 'tool') actions.value.push({ id: e.id, name: e.name, input: e.input })
    else if (e.type === 'tool_result') {
      const a = actions.value.find((x) => x.id === e.id)
      if (a) a.ok = e.ok
    } else if (e.type === 'done') phase.value = 'done'
    else { error.value = { code: e.code, message: e.message }; phase.value = 'error' }
  }

  async function ask(text: string) {
    const instruction = text.trim()
    if (!instruction || phase.value === 'running') return
    reset()
    asked.value = instruction
    phase.value = 'running'
    const mine = (abort = new AbortController())
    try {
      await getTransport().assistantAsk(instruction, (e) => { if (abort === mine) apply(e) }, mine.signal)
      // a stream cut without a last word (server restarted…) does not stay "running"
      if (abort === mine && phase.value === 'running') {
        error.value = { code: 'NETWORK', message: 'connection closed' }
        phase.value = 'error'
      }
    } catch (err) {
      if (abort !== mine || mine.signal.aborted) return
      error.value = err instanceof ApiRequestError ? { code: err.code, message: err.message } : { code: 'NETWORK', message: (err as Error).message }
      phase.value = 'error'
    }
  }

  /** Forgets the instruction. The one in progress is abandoned: the server stops claude. */
  function reset() {
    abort?.abort()
    abort = null
    phase.value = 'idle'
    asked.value = ''
    actions.value = []
    answer.value = ''
    error.value = null
  }

  return { phase, asked, actions, answer, error, ask, reset }
}
