import type { FastifyRequest } from 'fastify'
import type { ResolvedStream } from './proxy'

// Les sources musicales (plugins sans appareil : YouTube Music, Mixcloud…) s'inscrivent ici à leur
// démarrage. Le lecteur commun (`player.ts`) ne sait rien d'elles sinon ceci : se préparer, et dire
// où est le flux d'une piste. File, relais, transfert et écoute locale sont les mêmes pour toutes.
//
// Chaque appel dit POUR QUI (`user`) : le compte connecté (session sous l'adresse publique, jeton
// MCP), dont la source emploie les comptes à lui ; `null` = la maison, les comptes du plugin.

/** Le compte pour qui la source travaille ; `null` = la maison (comptes réglés dans le plugin). */
export type MusicUser = string | null

/** Le compte d'une requête : la session sous l'adresse publique, le jeton MCP ; sinon la maison. */
export const musicUserOf = (req: FastifyRequest): MusicUser => req.sessionUser ?? null

export interface MusicSource {
  /** Id du plugin, repris dans chaque piste (`{ source, id }`). */
  readonly id: string
  /** Nom lisible, pour les messages. */
  readonly label: string
  /**
   * Avant une résolution : lève une `PluginError` si la source ne peut pas servir (compte non relié,
   * générateur de jeton injoignable). Absent = toujours prête.
   */
  prepare?(user: MusicUser): Promise<void>
  /**
   * Où est le flux de la piste `id`. Lève une `PluginError` ; la source note elle-même ce que l'échec
   * lui apprend (cookie expiré…). Plusieurs secondes : le lecteur prépare la suivante d'avance.
   */
  resolve(id: string, user: MusicUser): Promise<ResolvedStream>
  /** La pochette à envoyer à l'enceinte, montée à la bonne taille (sinon celle du catalogue). */
  playArt?(url: string): string
  /**
   * Où en est une de ses pistes sur une enceinte, à chaque relevé (et `ended` à sa fin naturelle) :
   * de quoi retenir la position d'un mix de plusieurs heures pour le reprendre plus tard.
   */
  onProgress?(id: string, positionS: number, durationS: number | undefined, ended: boolean, user: MusicUser): void
}

const sources = new Map<string, MusicSource>()

/** Inscrit une source ; rend de quoi la retirer (au `stop()` du plugin). */
export function registerMusicSource(source: MusicSource): () => void {
  sources.set(source.id, source)
  return () => { if (sources.get(source.id) === source) sources.delete(source.id) }
}

export function getMusicSource(id: string): MusicSource | undefined {
  return sources.get(id)
}
