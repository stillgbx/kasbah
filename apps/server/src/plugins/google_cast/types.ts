import { z } from 'zod'

// Schémas SOUPLES des messages reçus d'un récepteur Cast. Seuls les champs qu'on lit sont typés ;
// tout le reste passe en `unknown` (un champ inutile contraint trop fort ferait rejeter un message
// entier, voir 3_2_ecrire-un-plugin.md).

/** Enregistrement TXT du service mDNS `_googlecast._tcp` (clés relevées sur le parc réel). */
export const castTxtSchema = z.looseObject({
  /** Identifiant stable de l'appareil (32 hex) : notre externalId. */
  id: z.string().min(1),
  /** Nom donné par l'utilisateur dans Google Home (« Cuisine », « Réveil parents »). */
  fn: z.string().min(1),
  /** Modèle (« Google Nest Hub », « Chromecast », « Lenovo CD-4N341Y »). */
  md: z.string().optional(),
  /** Masque de capacités : bit 0 = sortie vidéo (écran), bit 2 = sortie audio. */
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
  /** `attenuation` ou `master` : réglable ; `fixed` : le volume se règle sur la TV, pas ici. */
  controlType: z.string().optional(),
})

export const receiverApplicationSchema = z.looseObject({
  appId: z.string(),
  displayName: z.string().optional(),
  sessionId: z.string(),
  /** Adresse à laquelle parler à l'appli (namespace media). */
  transportId: z.string(),
  isIdleScreen: z.boolean().optional(),
  statusText: z.string().optional(),
  namespaces: z.unknown().optional(),
})
export type ReceiverApplication = z.infer<typeof receiverApplicationSchema>

export const receiverStatusSchema = z.looseObject({
  volume: receiverVolumeSchema.optional(),
  applications: z.array(z.unknown()).optional(),
})
export type ReceiverStatus = z.infer<typeof receiverStatusSchema>

export const mediaMetadataSchema = z.looseObject({
  metadataType: z.number().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  artist: z.string().optional(),
  albumArtist: z.string().optional(),
  albumName: z.string().optional(),
  images: z.array(z.looseObject({ url: z.string() })).optional(),
})

export const mediaStatusSchema = z.looseObject({
  mediaSessionId: z.number(),
  /** PLAYING, PAUSED, BUFFERING, IDLE. */
  playerState: z.string(),
  currentTime: z.number().optional(),
  media: z.looseObject({
    contentId: z.string().optional(),
    duration: z.number().optional(),
    metadata: mediaMetadataSchema.optional(),
  }).optional(),
})
export type MediaStatus = z.infer<typeof mediaStatusSchema>

/** Enveloppe d'un message JSON reçu, quel que soit le namespace. */
export const inboundSchema = z.looseObject({
  type: z.string(),
  requestId: z.number().optional(),
  status: z.unknown().optional(),
  reason: z.string().optional(),
})
export type Inbound = z.infer<typeof inboundSchema>
