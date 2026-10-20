import { z } from 'zod'

// LENIENT schemas of the messages received from a Cast receiver. Only the fields we read are typed;
// everything else goes through as `unknown` (a useless field constrained too tightly would get a
// whole message rejected, see 3_2_ecrire-un-plugin.md).

/** TXT record of the `_googlecast._tcp` mDNS service (keys observed on the real device set). */
export const castTxtSchema = z.looseObject({
  /** Stable device id (32 hex): our externalId. */
  id: z.string().min(1),
  /** Name given by the user in Google Home ("Cuisine", "Réveil parents"). */
  fn: z.string().min(1),
  /** Model ("Google Nest Hub", "Chromecast", "Lenovo CD-4N341Y"). */
  md: z.string().optional(),
  /** Capability mask: bit 0 = video output (screen), bit 2 = audio output. */
  ca: z.string().optional(),
})
export type CastTxt = z.infer<typeof castTxtSchema>

export interface CastService {
  host: string
  port: number
  txt: CastTxt
}

export const receiverVolumeSchema = z.looseObject({
  level: z.number().optional(),
  muted: z.boolean().optional(),
  /** `attenuation` or `master`: adjustable; `fixed`: the volume is set on the TV, not here. */
  controlType: z.string().optional(),
})

export const receiverApplicationSchema = z.looseObject({
  appId: z.string(),
  /**
   * The app's CANONICAL id, when it differs from `appId`: an Android TV launches its ecosystem's
   * variant (YouTube: `appId: 2C6A6E3D`, `universalAppId: 233637DE`). It is the one carrying the
   * visuals in the public registry (see `enrich/appIcon.ts`).
   */
  universalAppId: z.string().nullish(),
  displayName: z.string().optional(),
  sessionId: z.string(),
  /**
   * Address to talk to the app at (media namespace). ABSENT for a native app that opens no Cast channel
   * (observed: Netflix on a Chromecast, `appType: WEB`, neither `transportId` nor `namespaces`): we know
   * it is on screen, nothing more.
   */
  transportId: z.string().optional(),
  isIdleScreen: z.boolean().optional(),
  statusText: z.string().optional(),
  /** App icon, often empty (`""`); filled in by some (Radio France). Fallback cover. */
  iconUrl: z.string().nullish(),
  namespaces: z.unknown().optional(),
})
export type ReceiverApplication = z.infer<typeof receiverApplicationSchema>

export const receiverStatusSchema = z.looseObject({
  volume: receiverVolumeSchema.optional(),
  applications: z.array(z.unknown()).optional(),
})
export type ReceiverStatus = z.infer<typeof receiverStatusSchema>

// Everything we do not read strictly is `nullish`: a real receiver sends `null` where the reference
// announces a number (observed: `duration: null` on a live radio stream), and a single field that
// was too strict got the whole MEDIA_STATUS rejected — the speaker stayed "idle".
export const mediaMetadataSchema = z.looseObject({
  metadataType: z.number().nullish(),
  title: z.string().nullish(),
  subtitle: z.string().nullish(),
  artist: z.string().nullish(),
  albumArtist: z.string().nullish(),
  albumName: z.string().nullish(),
  images: z.array(z.looseObject({ url: z.string().nullish() })).nullish(),
})

export const mediaStatusSchema = z.looseObject({
  mediaSessionId: z.number(),
  /** PLAYING, PAUSED, BUFFERING, IDLE. */
  playerState: z.string(),
  currentTime: z.number().nullish(),
  media: z.looseObject({
    /** Empty (`""`) on a stream started by the Assistant: the URL is then in `contentUrl`. */
    contentId: z.string().nullish(),
    contentUrl: z.string().nullish(),
    /** `BUFFERED` (track), `LIVE` (live: radio, news channel), `NONE`. */
    streamType: z.string().nullish(),
    /** `null` on a live stream (radio), a number on a track. */
    duration: z.number().nullish(),
    metadata: mediaMetadataSchema.nullish(),
  }).nullish(),
})
export type MediaStatus = z.infer<typeof mediaStatusSchema>

/** Envelope of a received JSON message, whatever the namespace. */
export const inboundSchema = z.looseObject({
  type: z.string(),
  requestId: z.number().optional(),
  status: z.unknown().optional(),
  reason: z.string().optional(),
})
export type Inbound = z.infer<typeof inboundSchema>
