import type { FastifyRequest } from 'fastify'
import type { ResolvedStream } from './proxy'

// Music sources (plugins without devices: YouTube Music, Mixcloud…) register here when they start.
// The shared player (`player.ts`) knows nothing about them except this: get ready, and say where a
// track's stream is. Queue, relay, transfer and local listening are the same for all of them.
//
// Each call says FOR WHOM (`user`): the signed-in account (session under the public address, MCP
// token), whose own accounts the source uses; `null` = the house, the plugin's accounts.

/** The account the source works for; `null` = the house (accounts set in the plugin). */
export type MusicUser = string | null

/** The account of a request: the session under the public address, the MCP token; otherwise the house. */
export const musicUserOf = (req: FastifyRequest): MusicUser => req.sessionUser ?? null

export interface MusicSource {
  /** Plugin id, carried in each track (`{ source, id }`). */
  readonly id: string
  /** Readable name, for messages. */
  readonly label: string
  /**
   * Before a resolution: throws a `PluginError` if the source cannot serve (account not linked,
   * token generator unreachable). Absent = always ready.
   */
  prepare?(user: MusicUser): Promise<void>
  /**
   * Where the stream of track `id` is. Throws a `PluginError`; the source itself records what the
   * failure tells it (expired cookie…). Several seconds: the player prepares the next one ahead.
   */
  resolve(id: string, user: MusicUser): Promise<ResolvedStream>
  /** The cover art to send to the speaker, scaled up to the right size (otherwise the catalog's). */
  playArt?(url: string): string
  /**
   * Where one of its tracks stands on a speaker, at each reading (and `ended` at its natural end):
   * enough to remember the position of a mix several hours long and resume it later.
   */
  onProgress?(id: string, positionS: number, durationS: number | undefined, ended: boolean, user: MusicUser): void
}

const sources = new Map<string, MusicSource>()

/** Registers a source; returns a way to remove it (at the plugin's `stop()`). */
export function registerMusicSource(source: MusicSource): () => void {
  sources.set(source.id, source)
  return () => { if (sources.get(source.id) === source) sources.delete(source.id) }
}

export function getMusicSource(id: string): MusicSource | undefined {
  return sources.get(id)
}
