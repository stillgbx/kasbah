// Les moteurs de l'assistant (plugins sans appareil : Claude aujourd'hui, d'autres CLI demain)
// s'inscrivent ici à leur démarrage, comme les sources musicales auprès du lecteur commun. Le cœur
// (`assistant.ts`) ne sait d'eux que ceci : lancer une instruction et rendre ce qui se passe.
//
// Ce que le cœur garde pour tous : la route, le jeton de course MCP au nom du compte, le prompt
// système, le délai, le journal, l'affichage. Ce que le moteur garde : son binaire, ses arguments,
// son compte chez le fournisseur (par compte Kasbah), la traduction de sa sortie.

/** Ce que la route `/ask` écrit, une ligne JSON par événement. */
export type AssistantEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean }
  | { type: 'done'; ms: number }
  | { type: 'error'; code: string; message: string }

export interface AssistantRun {
  /** Le compte qui demande (ses comptes chez le fournisseur) ; `null` = la maison. */
  user: string | null
  text: string
  systemPrompt: string
  /** Le MCP de Kasbah, et un jeton de course au nom du compte, révoqué par le cœur à la fin. */
  mcp: { url: string; token: string }
  /** Outils sans préfixe (`send_command`), texte, puis UN dernier mot : `done` ou `error`. */
  emit(e: AssistantEvent): void
  /**
   * Annulé quand le client s'en va ou que le délai passe : tout arrêter et rendre la main, SANS
   * dernier mot — c'est le cœur qui dit pourquoi.
   */
  signal: AbortSignal
}

export interface AssistantEngine {
  /** Id du plugin. */
  readonly id: string
  /** Nom lisible, pour les messages. */
  readonly label: string
  run(run: AssistantRun): Promise<void>
}

const engines = new Map<string, AssistantEngine>()

/** Inscrit un moteur ; rend de quoi le retirer (au `stop()` du plugin). */
export function registerAssistantEngine(engine: AssistantEngine): () => void {
  engines.set(engine.id, engine)
  return () => { if (engines.get(engine.id) === engine) engines.delete(engine.id) }
}

/**
 * Le moteur qui répond. Un seul existe aujourd'hui : choisir entre plusieurs (par compte, pour la
 * maison) se décidera quand un deuxième arrivera. En attendant, le premier inscrit.
 */
export function currentAssistantEngine(): AssistantEngine | undefined {
  return engines.values().next().value
}
