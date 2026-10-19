import { z } from 'zod'

// Formes des réponses Renault. Deux APIs très différentes se succèdent :
//
//  - GIGYA (SAP Customer Data Cloud), l'authentification. Elle répond TOUJOURS en HTTP 200, même
//    pour un mot de passe faux : c'est `errorCode` dans le corps qui dit l'échec. Un client qui ne
//    regarde que le statut HTTP croit toujours avoir réussi.
//  - KAMEREON, les données véhicule. Enveloppe JSON:API (`{ data: { id, type, attributes } }`) et
//    erreurs dans `errors[]` avec un code maison (`err.func.wired.forbidden`…).
//
// Les schémas d'ATTRIBUTS (batterie, cockpit, position…) ne sont volontairement PAS ici : ils
// seront écrits d'après la capture du vrai compte, pas d'après la documentation. Deux plugins de
// cette maison ont déjà payé cette leçon (cf. `doc/3_plugins/3_2_ecrire-un-plugin.md`).

// ---- Gigya -------------------------------------------------------------------------------------

/** Toute réponse Gigya porte ce cadre ; `errorCode: 0` est le seul succès. */
export const gigyaResponseSchema = z.looseObject({
  errorCode: z.number(),
  errorMessage: z.string().optional(),
  errorDetails: z.string().optional(),
})
export type GigyaResponse = z.infer<typeof gigyaResponseSchema>

/** `accounts.login` : le jeton durable est `sessionInfo.cookieValue`, et rien d'autre. */
export const gigyaLoginSchema = z.looseObject({
  sessionInfo: z.looseObject({ cookieValue: z.string().min(1) }),
})

/** `accounts.getAccountInfo` : donne le `personId`, clé d'entrée de Kamereon. */
export const gigyaAccountInfoSchema = z.looseObject({
  data: z.looseObject({ personId: z.string().min(1) }),
})

/** `accounts.getJWT` : le jeton court (15 min) que Kamereon accepte. */
export const gigyaJwtSchema = z.looseObject({ id_token: z.string().min(1) })

// ---- Kamereon ----------------------------------------------------------------------------------

/**
 * `/persons/{personId}` : les comptes Kamereon de la personne. Un foyer en a souvent plusieurs
 * (`MYRENAULT`, `MYDACIA`, parfois un compte résilié) — d'où le choix explicite côté plugin.
 */
export const personSchema = z.looseObject({
  accounts: z.array(z.unknown()).default([]),
})
export const personAccountSchema = z.looseObject({
  accountId: z.string().min(1),
  accountType: z.string().optional(),
  accountStatus: z.string().optional(),
})
export type PersonAccount = z.infer<typeof personAccountSchema>

/**
 * `/accounts/{accountId}/vehicles` : un lien par véhicule. `z.unknown()` sur les éléments, validés
 * un par un ensuite : un véhicule à la forme inattendue ne doit pas priver le foyer des autres.
 */
export const vehiclesSchema = z.looseObject({
  vehicleLinks: z.array(z.unknown()).default([]),
})

/**
 * Un lien véhicule. Seul le VIN est exigé — c'est l'identifiant stable, donc l'`externalId`. Le
 * reste sert à nommer l'appareil, et tout y est facultatif : `vehicleDetails` manque sur un
 * véhicule dont le contrat de services a expiré.
 */
export const vehicleLinkSchema = z.looseObject({
  vin: z.string().min(1),
  status: z.string().optional(),
  vehicleDetails: z.looseObject({
    vin: z.string().optional(),
    registrationNumber: z.string().optional(),
    brand: z.looseObject({ label: z.string().optional() }).optional(),
    model: z.looseObject({ code: z.string().optional(), label: z.string().optional() }).optional(),
    energy: z.looseObject({ code: z.string().optional(), label: z.string().optional() }).optional(),
    /**
     * Les rendus du véhicule DANS SA CONFIGURATION (`3dv.renault.com`), sept points de vue. Seule
     * source de la teinte : l'URL porte la référence d'usine, et Renault ne la nomme nulle part
     * ailleurs. Voir `bodyColor`.
     */
    assets: z.array(z.looseObject({
      assetType: z.string().optional(),
      renditions: z.array(z.looseObject({ url: z.string().optional() })).default([]),
    })).optional(),
  }).optional(),
})
export type VehicleLink = z.infer<typeof vehicleLinkSchema>

/**
 * Enveloppe JSON:API des lectures véhicule. Les `attributes` restent `unknown` tant que la capture
 * du vrai compte n'a pas dicté leur forme : les lire au jugé serait exactement l'erreur que ce
 * projet a déjà commise deux fois.
 */
export const kamereonDataSchema = z.looseObject({
  data: z.looseObject({
    id: z.string().optional(),
    type: z.string().optional(),
    attributes: z.unknown().optional(),
  }).optional(),
})

/** Erreur Kamereon : `errors[].errorCode` porte le vrai motif (`err.func.wired.forbidden`…). */
export const kamereonErrorsSchema = z.looseObject({
  errors: z.array(z.looseObject({
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  })).default([]),
})

/**
 * Un contrat du véhicule (`GET .../vehicles/{vin}/contracts`) : garanties, services connectés,
 * entretien. Forme lue sur la capture du vrai compte (2026-10-19) : la réponse est un TABLEAU nu, et
 * `conditions` un tableau dont la première entrée porte le plafond (`maximumMileage`, en `km`).
 * Aucun contrat de financement n'y figure — LOA et LLD vivent chez Mobilize, sans API connue.
 */
export const vehicleContractSchema = z.looseObject({
  type: z.string().optional(),
  description: z.string().optional(),
  status: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  durationMonths: z.number().optional(),
  conditions: z.array(z.looseObject({
    maximumMileage: z.number().optional(),
    unlimitedMileage: z.boolean().optional(),
    mileageUnit: z.string().optional(),
  })).optional(),
})
