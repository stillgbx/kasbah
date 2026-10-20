import { z } from 'zod'

// LOOSE shapes of what we read from Sonos. The rest goes as `unknown().optional()`: a field we do
// not read, too constrained, would make the whole response fail (MELCloud lesson, zod 4).

export const PLUGIN_ID = 'sonos'

/** What a speaker announced over SSDP, plus what `/status/zp` and the description confirmed. */
export interface SonosPlayer {
  /** Stable id (`RINCON_…01400`), without `:` — our `externalId`. */
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
