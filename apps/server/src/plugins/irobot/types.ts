import { z } from 'zod'

// Schémas SOUPLES des réponses iRobot. Règle du projet (`3_2_ecrire-un-plugin.md`) : ne jamais
// contraindre le type d'un champ qu'on ne lit pas — en zod 4, `z.unknown()` seul ne rend PAS une
// clé facultative, il faut `z.unknown().optional()`, faute de quoi un champ ignoré fait échouer la
// réponse entière (leçon MELCloud du 17/09).

/**
 * Réponse du robot à la diffusion UDP/5678. Capturée sur le vrai parc le 19/09/2026 : un Roomba
 * Combo `stingray` annonce `robotid`, les anciens ne mettaient que `hostname` (`Roomba-<blid>`) —
 * d'où les deux chemins vers le BLID dans `discovery.ts`.
 */
export const discoveryPayloadSchema = z.looseObject({
  ver: z.unknown().optional(),
  hostname: z.string().optional(),
  robotname: z.string().optional(),
  robotid: z.string().optional(),
  ip: z.string().optional(),
  mac: z.unknown().optional(),
  sw: z.string().optional(),
  sku: z.string().optional(),
  /** `mqtt` = courtier local. Un robot qui annoncerait autre chose n'est pas pilotable en local. */
  proto: z.string().optional(),
  /**
   * Table de capacités du fabricant. Deux clés nous ont servi tout de suite : `scrub` (serpillière,
   * donc un Combo) et surtout `pw` — à `0`, le robot NE REND PLUS son mot de passe en local, ce que
   * 115 tentatives de datagramme magique ont confirmé avant qu'on lise cette clé.
   */
  cap: z.record(z.string(), z.unknown()).optional(),
  cloudConnState: z.unknown().optional(),
})
export type DiscoveryPayload = z.infer<typeof discoveryPayloadSchema>

/** `GET /v1/discover/endpoints?country_code=XX` — public, aucun identifiant. */
export const endpointDiscoverySchema = z.looseObject({
  current_deployment: z.string().optional(),
  deployments: z.record(z.string(), z.looseObject({
    httpBase: z.string(),
    httpBaseAuth: z.unknown().optional(),
    awsRegion: z.unknown().optional(),
    svcDeplId: z.unknown().optional(),
  })),
  gigya: z.looseObject({
    api_key: z.string(),
    datacenter_domain: z.string(),
  }),
})

/**
 * `POST /accounts.login` chez Gigya. Même piège que Renault : **HTTP 200 même en cas de refus**,
 * l'échec est dans `errorCode`. Le cadre est donc lu avant le contenu.
 */
export const gigyaResponseSchema = z.looseObject({
  errorCode: z.number(),
  errorMessage: z.string().optional(),
  errorDetails: z.string().optional(),
})

export const gigyaLoginSchema = z.looseObject({
  UID: z.string(),
  UIDSignature: z.string(),
  signatureTimestamp: z.union([z.string(), z.number()]),
})

/**
 * `POST {httpBase}/v2/login` — l'échange qui compte : il rend, pour chaque robot du compte, son
 * MOT DE PASSE LOCAL. C'est le seul secret que le plugin garde ; celui du compte ne survit pas à
 * la requête.
 */
export const cloudLoginSchema = z.looseObject({
  robots: z.record(z.string(), z.looseObject({
    password: z.string(),
    name: z.string().optional(),
    sku: z.string().optional(),
    softwareVer: z.string().optional(),
  })),
})

/** Identifiants locaux d'un robot, tels qu'ils vivent dans le fichier de session. */
export const storedRobotSchema = z.object({
  blid: z.string().min(1),
  password: z.string().min(1),
  name: z.string().nullable().default(null),
  sku: z.string().nullable().default(null),
})
export type StoredRobot = z.infer<typeof storedRobotSchema>

export const storedSessionSchema = z.object({
  robots: z.array(storedRobotSchema),
  linkedAt: z.number().optional(),
})
export type StoredSession = z.infer<typeof storedSessionSchema>
