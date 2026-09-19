import { z } from 'zod'

// Formes SOUPLES de ce qu'on lit chez Sonos. Le reste passe en `unknown().optional()` : un champ
// qu'on ne lit pas, trop contraint, ferait échouer toute la réponse (leçon MELCloud, zod 4).

export const PLUGIN_ID = 'sonos'

/** Ce qu'une enceinte a annoncé en SSDP, plus ce que `/status/zp` et la description ont confirmé. */
export interface SonosPlayer {
  /** Identifiant stable (`RINCON_…01400`), sans `:` — notre `externalId`. */
  uuid: string
  host: string
  name: string
  model?: string
  modelNumber?: string
  softwareVersion?: string
}

export const knownPlayerSchema = z.object({
  uuid: z.string().min(1),
  host: z.string().min(1),
  name: z.string().min(1),
  model: z.string().optional(),
  modelNumber: z.string().optional(),
  softwareVersion: z.string().optional(),
})

export const knownFileSchema = z.object({
  devices: z.array(knownPlayerSchema).default([]),
})

export interface ZoneMember {
  uuid: string
  host: string
  name: string
  coordinatorUuid: string
}

export interface TransportInfo {
  state: string
  status: string
}

export interface PositionInfo {
  durationS: number | undefined
  positionS: number | undefined
  trackUri: string
  didl: string
}

export interface TrackMeta {
  title: string
  artist?: string
  album?: string
  artUrl?: string
  live: boolean
  source?: string
}
