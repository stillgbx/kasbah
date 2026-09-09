import { z } from 'zod'

// Formes de l'API Google Smart Device Management (SDM), `https://smartdevicemanagement.googleapis.com/v1`.
// Schémas VOLONTAIREMENT souples (`looseObject`, `z.unknown()` sur les traits) : Google ajoute des
// traits à chaque génération d'appareil, et contraindre un champ qu'on ne lit pas suffirait à faire
// échouer la liste entière (leçon du plugin TaHoma, cf. `doc/3_plugins/3_2_ecrire-un-plugin.md`).

/**
 * Un appareil SDM. `name` est le chemin de ressource `enterprises/<projet>/devices/<id>` ; l'id
 * est opaque et stable. `traits` est un dictionnaire `sdm.devices.traits.<Nom>` → valeurs, lu
 * trait par trait avec `readTrait` pour ne rien imposer sur ceux qu'on ignore.
 */
export const sdmDeviceSchema = z.looseObject({
  name: z.string(),
  /** `sdm.devices.types.DOORBELL`, `…CAMERA`, `…DISPLAY`, `…THERMOSTAT`. */
  type: z.string().optional(),
  traits: z.record(z.string(), z.unknown()).default({}),
  /** La pièce (structure Google Home) qui contient l'appareil : `displayName` est son nom. */
  parentRelations: z.array(z.looseObject({
    parent: z.string().optional(),
    displayName: z.string().optional(),
  })).default([]),
})
export type SdmDevice = z.infer<typeof sdmDeviceSchema>

/** `GET /enterprises/<projet>/devices`. Chaque élément est validé séparément par le client. */
export const sdmDevicesResponseSchema = z.looseObject({
  devices: z.array(z.unknown()).default([]),
})

/** Corps d'erreur Google (`{ error: { code, message, status } }`) — diagnostique, sans secret. */
export const sdmErrorSchema = z.looseObject({
  error: z.looseObject({
    code: z.number().optional(),
    message: z.string().optional(),
    status: z.string().optional(),
  }).optional(),
})

/** Réponse de `https://oauth2.googleapis.com/token` (échange de code et rafraîchissement). */
export const oauthTokenResponseSchema = z.looseObject({
  access_token: z.string(),
  /** Secondes de validité (3600 en pratique). */
  expires_in: z.number().optional(),
  /** Présent à l'échange du code seulement (avec `access_type=offline` + `prompt=consent`). */
  refresh_token: z.string().optional(),
})
export type OAuthTokenResponse = z.infer<typeof oauthTokenResponseSchema>

/** Corps d'erreur OAuth (`invalid_grant` = jeton de rafraîchissement révoqué ou code déjà consommé). */
export const oauthErrorSchema = z.looseObject({
  error: z.string().optional(),
  error_description: z.string().optional(),
})

/** Trait de l'appareil sous forme d'objet, ou `undefined` s'il est absent ou n'est pas un objet. */
export function readTrait(device: SdmDevice, name: string): Record<string, unknown> | undefined {
  const t = device.traits[`sdm.devices.traits.${name}`]
  return t !== null && typeof t === 'object' && !Array.isArray(t) ? (t as Record<string, unknown>) : undefined
}

/**
 * `results` de `CameraLiveStream.GenerateRtspStream` : l'URL `rtsps://…?auth=<streamToken>` vaut
 * cinq minutes, prolongeables par `ExtendRtspStream` avec `streamExtensionToken`. Forme d'après la
 * documentation, à confirmer sur la première capture (le plugin journalise la réponse en debug).
 */
export const sdmRtspStreamSchema = z.looseObject({
  streamUrls: z.looseObject({ rtspUrl: z.string() }),
  streamExtensionToken: z.string(),
  streamToken: z.string().optional(),
  expiresAt: z.string().optional(),
})
export type SdmRtspStream = z.infer<typeof sdmRtspStreamSchema>

/** `results` de `ExtendRtspStream` : un nouveau jeton de prolongation, l'URL ne change pas. */
export const sdmExtendStreamSchema = z.looseObject({
  streamExtensionToken: z.string(),
  streamToken: z.string().optional(),
  expiresAt: z.string().optional(),
})

/** Enveloppe de `:executeCommand` : `results` est absent pour les commandes sans réponse. */
export const sdmCommandResponseSchema = z.looseObject({ results: z.unknown().optional() })
