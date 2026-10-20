// Assistant engines (plugins without devices: Claude today, other CLIs tomorrow) register here when
// they start, like music sources with the shared player. The core (`assistant.ts`) knows only this
// about them: run an instruction and report what happens.
//
// What the core keeps for all of them: the route, the per-run MCP token in the account's name, the
// system prompt, the timeout, the log, the display. What the engine keeps: its binary, its
// arguments, its account at the provider (per Kasbah account), the translation of its output.

/**
 * What an instruction consumed, when the engine knows it. `costUsd` is computed at the API list
 * price: with a subscription (Claude), nobody pays it, it is what an API key would cost.
 */
export interface AssistantUsage {
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** What the `/ask` route writes, one JSON line per event. */
export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean }
  | { type: 'done'; ms: number; usage?: AssistantUsage }
  | { type: 'error'; code: string; message: string; usage?: AssistantUsage }

export interface AssistantRun {
  /** The requesting account (its accounts at the provider); `null` = the house. */
  user: string | null
  text: string
  systemPrompt: string
  /** Kasbah's MCP, and a per-run token in the account's name, revoked by the core at the end. */
  mcp: { url: string; token: string }
  /** Unprefixed tools (`send_command`), text, then ONE last word: `done` or `error`. */
  emit(e: AssistantEvent): void
  /**
   * Aborted when the client leaves or the timeout passes: stop everything and hand back, WITHOUT a
   * last word — the core says why.
   */
  signal: AbortSignal
}

export interface AssistantEngine {
  /** Plugin id. */
  readonly id: string
  /** Readable name, for messages. */
  readonly label: string
  run(run: AssistantRun): Promise<void>
}

const engines = new Map<string, AssistantEngine>()

/** Registers an engine; returns a way to remove it (at the plugin's `stop()`). */
export function registerAssistantEngine(engine: AssistantEngine): () => void {
  engines.set(engine.id, engine)
  return () => { if (engines.get(engine.id) === engine) engines.delete(engine.id) }
}

/**
 * The engine that answers. Only one exists today: choosing among several (per account, for the
 * house) will be decided when a second one arrives. Meanwhile, the first registered.
 */
export function currentAssistantEngine(): AssistantEngine | undefined {
  return engines.values().next().value
}
