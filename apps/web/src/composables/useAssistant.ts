import { ref } from 'vue'
import { getTransport } from '../api'
import { ApiRequestError, type AssistantEvent } from '../api/transport'

// Une instruction passée à l'assistant (`claude -p` sur le serveur, qui agit par les outils du MCP) :
// ce qu'il fait, au fil de l'eau, puis sa réponse. Une instruction à la fois ; la suivante efface la
// précédente, sans mémoire de l'une à l'autre.

export interface AssistantAction {
  id: string
  /** Outil MCP, sans préfixe (`send_command`, `play_radio`…). */
  name: string
  input: unknown
  /** `undefined` tant que l'outil n'a pas répondu. */
  ok?: boolean
}

export type AssistantPhase = 'idle' | 'running' | 'done' | 'error'

export function useAssistant() {
  const phase = ref<AssistantPhase>('idle')
  /** L'instruction en cours ou la dernière. */
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
      // un flux coupé sans dernier mot (serveur relancé…) ne reste pas « en cours »
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

  /** Oublie l'instruction. Celle en cours est abandonnée : le serveur arrête claude. */
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
